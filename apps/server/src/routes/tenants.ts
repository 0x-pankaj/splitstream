/**
 * Onboarding + account-management REST gateway.
 *
 *   POST   /api/v1/tenants/signup        (public)  — open a treasury account
 *   GET    /api/v1/recipients            (auth)    — list vetted payees
 *   POST   /api/v1/recipients            (auth)    — vet/allowlist a payee
 *   DELETE /api/v1/recipients/:key       (auth)    — revoke a payee
 *   GET    /api/v1/treasury/deposit-info (auth)    — how + where to fund the vault
 *
 * The signup route is intentionally unauthenticated — it is the front door. All
 * others require the tenant's scoped x-api-key.
 */

import { Hono } from "hono";
import {
  ArcaneError,
  RecipientInputSchema,
  SignupSchema,
  formatUsdc6,
} from "@arcane/shared";
import type { Store } from "../db/store.js";
import { authenticate } from "../auth/apiKeys.js";
import { config } from "../config.js";
import { signupTenant } from "../services/onboarding.js";
import { addTenantRecipient, removeTenantRecipient } from "../services/recipients.js";
import { readTenantBalance6 } from "../services/vault.js";

/** Arc L1 native USDC system contract (6dp ERC-20 view). */
const ARC_USDC = "0x3600000000000000000000000000000000000000";

function handleError(err: unknown) {
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

export function tenantRoutes(store: Store): Hono {
  const app = new Hono();

  // ── Onboarding ────────────────────────────────────────────────────────────
  app.post("/tenants/signup", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { code: "VALIDATION_FAILED", message: "Invalid signup payload", issues: parsed.error.issues },
        400,
      );
    }
    try {
      const { tenant, apiKey, limitTxHash } = await signupTenant(store, parsed.data);
      return c.json(
        {
          ok: true,
          tenantId: tenant.id,
          name: tenant.name,
          onchainAddress: tenant.onchainAddress,
          // Shown exactly once — the client must store it.
          apiKey: apiKey.key,
          scopes: [...apiKey.scopes],
          vaultAddress: config.vaultAddress ?? null,
          usdcAddress: ARC_USDC,
          limitTxHash,
        },
        201,
      );
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  // ── Account ───────────────────────────────────────────────────────────────
  app.get("/tenants/me", (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"));
      return c.json(
        {
          ok: true,
          tenantId: auth.tenant.id,
          name: auth.tenant.name,
          onchainAddress: auth.tenant.onchainAddress,
          scopes: [...auth.apiKey.scopes],
        },
        200,
      );
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  // ── Payees ────────────────────────────────────────────────────────────────
  app.get("/recipients", (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "treasury:read");
      return c.json({ ok: true, recipients: store.listRecipients(auth.tenant.id) }, 200);
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  app.post("/recipients", async (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "payouts:write");
      const body = await c.req.json().catch(() => null);
      const parsed = RecipientInputSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { code: "VALIDATION_FAILED", message: "Invalid recipient payload", issues: parsed.error.issues },
          400,
        );
      }
      const { record, onchainTxHash } = await addTenantRecipient(store, auth.tenant, parsed.data);
      return c.json({ ok: true, recipient: record, onchainTxHash }, 201);
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  app.delete("/recipients/:key", async (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "payouts:write");
      const key = c.req.param("key") as `0x${string}`;
      const { removed, onchainTxHash } = await removeTenantRecipient(store, auth.tenant, key);
      return c.json({ ok: true, removed, onchainTxHash }, 200);
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  // ── Funding ───────────────────────────────────────────────────────────────
  app.get("/treasury/deposit-info", async (c) => {
    try {
      const auth = authenticate(store, c.req.header("x-api-key"), "treasury:read");
      const balance6 = await readTenantBalance6(store, auth.tenant);
      return c.json(
        {
          ok: true,
          onchainEnabled: config.onchainEnabled,
          vaultAddress: config.vaultAddress ?? null,
          usdcAddress: ARC_USDC,
          tenantAddress: auth.tenant.onchainAddress,
          balance: formatUsdc6(balance6),
          // The two-step funding flow the tenant runs from its own Arc wallet.
          instructions: config.vaultAddress
            ? [
                `Approve the vault to pull USDC: ${ARC_USDC}.approve(${config.vaultAddress}, amount)`,
                `Deposit into your treasury: ${config.vaultAddress}.depositUSDC(amount)`,
                "Amounts are 6-decimal USDC (e.g. 1 USDC = 1000000).",
              ]
            : ["Vault not deployed in this environment — running in mirror mode."],
        },
        200,
      );
    } catch (err) {
      const { body: b, status } = handleError(err);
      return c.json(b, status);
    }
  });

  return app;
}
