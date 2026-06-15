/**
 * SplitStream content + monetization routes.
 *
 *   POST /api/v1/pieces           — publisher registers a piece (x-api-key)
 *   GET  /api/v1/pieces           — public: browse the storefront catalog
 *   GET  /api/v1/pieces/:id       — public: one piece's detail + stats
 *   POST /api/v1/pieces/:id/pay   — public: a reader/agent unlocks (pays) a piece
 *
 * Creation is authenticated (only a publisher can list their content). Reading
 * and paying are public — readers don't hold API keys; they just pay. This is
 * what lets a shared link generate real traction.
 */

import { Hono } from "hono";
import {
  ArcaneError,
  CallPieceSchema,
  CreatePieceSchema,
  PayPieceSchema,
  formatUsdc6,
  parseUsdc6,
  type Piece,
} from "@arcane/shared";
import type { Store } from "../db/store.js";
import { authenticate } from "../auth/apiKeys.js";
import { callPaidService, payForPiece, whitelistContributors } from "../services/splitEngine.js";

/** Serialize a piece for JSON responses (bigint → human USDC string). */
function pieceView(piece: Piece) {
  return {
    id: piece.id,
    publisherTenantId: piece.publisherTenantId,
    title: piece.title,
    kind: piece.kind,
    priceUSDC: formatUsdc6(piece.price6),
    contributors: piece.contributors,
    endpoint: piece.endpoint ?? null,
    httpMethod: piece.httpMethod ?? null,
    createdAt: piece.createdAt,
    unlocks: piece.unlocks,
    totalPaidUSDC: formatUsdc6(piece.totalPaid6),
  };
}

function errorResponse(err: unknown) {
  if (err instanceof ArcaneError) {
    return {
      body: { code: err.code, message: err.message, details: err.details ?? null },
      status: err.status as 400,
    };
  }
  return {
    body: { code: "INTERNAL", message: err instanceof Error ? err.message : "Internal error" },
    status: 500 as const,
  };
}

export function pieceRoutes(store: Store): Hono {
  const app = new Hono();

  // Publisher registers a monetizable piece.
  app.post("/", async (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "payouts:write");

      const body = await c.req.json().catch(() => null);
      const parsed = CreatePieceSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { code: "VALIDATION_FAILED", message: "Invalid piece payload", issues: parsed.error.issues },
          400,
        );
      }

      const piece = store.createPiece({
        publisherTenantId: auth.tenant.id,
        title: parsed.data.title,
        kind: parsed.data.kind,
        price6: parseUsdc6(parsed.data.priceUSDC),
        contributors: parsed.data.contributors,
        endpoint: parsed.data.endpoint,
        httpMethod: parsed.data.httpMethod,
      });
      // Vet contributors up front so the unlock path's compliance check passes.
      whitelistContributors(store, piece);

      return c.json({ ok: true, piece: pieceView(piece) }, 201);
    } catch (err) {
      const { body, status } = errorResponse(err);
      return c.json(body, status);
    }
  });

  // Public storefront catalog. Optional ?tenantId= to scope to one publisher.
  app.get("/", (c) => {
    const tenantId = c.req.query("tenantId");
    const pieces = store.listPieces(tenantId).map(pieceView);
    return c.json({ ok: true, pieces });
  });

  // Public piece detail.
  app.get("/:id", (c) => {
    const piece = store.getPiece(c.req.param("id"));
    if (!piece) {
      return c.json({ code: "NOT_FOUND", message: "No such piece" }, 404);
    }
    return c.json({ ok: true, piece: pieceView(piece) });
  });

  // Public unlock: a reader (or agent) pays and the price fans out to contributors.
  app.post("/:id/pay", async (c) => {
    try {
      const piece = store.getPiece(c.req.param("id"));
      if (!piece) {
        return c.json({ code: "NOT_FOUND", message: "No such piece" }, 404);
      }

      const body = await c.req.json().catch(() => ({}));
      const parsed = PayPieceSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return c.json(
          { code: "VALIDATION_FAILED", message: "Invalid unlock payload", issues: parsed.error.issues },
          400,
        );
      }

      const result = await payForPiece(store, piece, parsed.data);
      return c.json({ ok: true, unlock: result }, 200);
    } catch (err) {
      const { body, status } = errorResponse(err);
      return c.json(body, status);
    }
  });

  // Public pay-per-call: pay for one call to an "api" piece and get the upstream
  // response. This is the x402 flow an AI agent uses to pay for your API.
  app.post("/:id/call", async (c) => {
    try {
      const piece = store.getPiece(c.req.param("id"));
      if (!piece) {
        return c.json({ code: "NOT_FOUND", message: "No such piece" }, 404);
      }
      if (piece.kind !== "api") {
        return c.json({ code: "NOT_CALLABLE", message: "Piece is not an API service" }, 400);
      }

      const body = await c.req.json().catch(() => ({}));
      const parsed = CallPieceSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return c.json(
          { code: "VALIDATION_FAILED", message: "Invalid call payload", issues: parsed.error.issues },
          400,
        );
      }

      const result = await callPaidService(store, piece, parsed.data);
      return c.json({ ok: true, ...result }, 200);
    } catch (err) {
      const { body, status } = errorResponse(err);
      return c.json(body, status);
    }
  });

  return app;
}
