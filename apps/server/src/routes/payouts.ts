/**
 * Public enterprise gateway: POST /api/v1/payouts/bulk.
 *
 * Secured by a scoped x-api-key. Validates the payload with Zod, binds it to the
 * authenticated tenant, and runs the hybrid payout engine.
 */

import { Hono } from "hono";
import { ArcaneError, BulkPayoutSchema } from "@arcane/shared";
import type { Store } from "../db/store.js";
import { authenticate } from "../auth/apiKeys.js";
import { processBulkPayout } from "../services/payoutEngine.js";

export function payoutRoutes(store: Store): Hono {
  const app = new Hono();

  app.post("/bulk", async (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "payouts:write");

      const body = await c.req.json().catch(() => null);
      const parsed = BulkPayoutSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { code: "VALIDATION_FAILED", message: "Invalid payout payload", issues: parsed.error.issues },
          400,
        );
      }

      // The key's tenant is authoritative — reject cross-tenant submissions.
      if (parsed.data.tenantId !== auth.tenant.id) {
        return c.json(
          { code: "UNAUTHORIZED", message: "tenantId does not match API key" },
          403,
        );
      }

      const result = await processBulkPayout(store, auth.tenant, parsed.data);
      return c.json({ ok: true, ...result }, 200);
    } catch (err) {
      if (err instanceof ArcaneError) {
        return c.json(
          { code: err.code, message: err.message, details: err.details ?? null },
          err.status as 400,
        );
      }
      return c.json(
        { code: "INTERNAL", message: err instanceof Error ? err.message : "Internal error" },
        500,
      );
    }
  });

  return app;
}
