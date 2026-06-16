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
  computeSplit,
  formatUsdc6,
  parseUsdc6,
  type Piece,
} from "@arcane/shared";
import type { Store } from "../db/store.js";
import { config } from "../config.js";
import { authenticate } from "../auth/apiKeys.js";
import { callPaidService, payForPiece, proxyUpstream, whitelistContributors } from "../services/splitEngine.js";
import { payContributorsOnArc } from "../services/x402Settle.js";
import {
  issueChallenge,
  decodePaymentHeader,
  verifyPayment,
  encodePaymentResponse,
  X402_NETWORK,
} from "../services/x402.js";

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
    authenticated: Boolean(piece.auth),
    authType: piece.auth?.type ?? null,
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
        auth: parsed.data.auth,
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

  // Pay-per-call via the x402 challenge-response flow — the standard way an AI
  // agent pays for an API in USDC (no API key, no KYC):
  //   1. POST with no `X-PAYMENT` header  → 402 Payment Required + requirements.
  //   2. Pay the USDC amount on Arc, then retry with a base64 `X-PAYMENT` header.
  //   3. We verify, settle the split to the API's owners, proxy the upstream
  //      call, and return 200 + an `X-PAYMENT-RESPONSE` header.
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

      // Step 1 — no payment yet: issue the 402 challenge.
      const paymentHeader = c.req.header("x-payment");
      const payload = decodePaymentHeader(paymentHeader);
      if (!payload) {
        return c.json(issueChallenge(store, piece), 402);
      }

      // Step 2 — verify the presented payment (single-use nonce + on-chain seam).
      const verified = await verifyPayment(store, piece, payload);
      if (!verified.ok) {
        return c.json(
          { ...issueChallenge(store, piece), error: verified.reason ?? "payment verification failed" },
          402,
        );
      }

      c.header(
        "x-payment-response",
        encodePaymentResponse({
          success: true,
          transaction: verified.transaction,
          network: X402_NETWORK,
          payer: verified.payer,
        }),
      );

      // Step 3 — settle the split to the API's owners and proxy the upstream call.
      if (config.liveX402) {
        // REAL on-chain settlement: pay each contributor real USDC on Arc, then
        // proxy. The agent's payment was already verified on-chain in step 2.
        const shares6 = computeSplit(piece.price6, piece.contributors);
        const payments = await payContributorsOnArc(piece.contributors, shares6);
        store.recordUnlock(piece.id, piece.price6);
        const upstream = await proxyUpstream(piece, parsed.data.input);
        const updated = store.getPiece(piece.id)!;
        return c.json(
          {
            ok: true,
            paid: true,
            mode: "live-arc",
            settlementTx: verified.transaction,
            payer: verified.payer,
            payments,
            upstream,
            pieceUnlocks: updated.unlocks,
            pieceTotalPaid: formatUsdc6(updated.totalPaid6),
          },
          200,
        );
      }

      const result = await callPaidService(store, piece, {
        payer: verified.payer ?? parsed.data.payer,
        agentId: parsed.data.agentId,
        input: parsed.data.input,
      });
      return c.json({ ok: true, paid: true, mode: "mirror", ...result }, 200);
    } catch (err) {
      const { body, status } = errorResponse(err);
      return c.json(body, status);
    }
  });

  return app;
}
