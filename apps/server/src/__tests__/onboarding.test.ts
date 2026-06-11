import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import { signupTenant } from "../services/onboarding.js";
import { addTenantRecipient, removeTenantRecipient } from "../services/recipients.js";
import { processBulkPayout } from "../services/payoutEngine.js";
import { tenantRoutes } from "../routes/tenants.js";
import { resetCursors } from "../services/solverMesh.js";

const WALLET = "0x8984EF18c6d128C47463405fdd01f833f4D7154c";
const PAYEE = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  resetCursors();
});

describe("self-serve onboarding", () => {
  it("creates a tenant, sets a limit, and issues a usable scoped key", async () => {
    const store = new Store();
    const { tenant, apiKey } = await signupTenant(store, {
      name: "Globex Payments",
      onchainAddress: WALLET,
    });

    expect(tenant.id).toMatch(/[0-9a-f-]{36}/);
    expect(tenant.onchainAddress).toBe(WALLET);
    expect(apiKey.key).toMatch(/^arc_(test|live)_sk_/);
    expect(apiKey.scopes.has("payouts:write")).toBe(true);
    // The issued key resolves back to the new tenant.
    expect(store.tenantForApiKey(apiKey.key)?.tenant.id).toBe(tenant.id);
    expect(store.dailyVolumeLimit6.get(tenant.id)).toBe(parseUsdc6("500000"));
  });

  it("blocks a payout until the payee is allowlisted, then permits it", async () => {
    const store = new Store();
    const { tenant } = await signupTenant(store, { name: "Globex", onchainAddress: WALLET });
    store.creditBalance(tenant.id, parseUsdc6("10000"));

    // A whale payout ($6k ≥ $5k threshold) settles via the CCTP rail, which
    // debits on-chain via executeIntent (mirror ledger in tests) and needs no
    // solver mesh — exactly the v1 rail. No payees yet → compliance rejects.
    const whale = { recipientAddress: PAYEE, targetChain: "base", amountUSDC: "6000", currencyCode: "USD" } as const;
    await expect(
      processBulkPayout(store, tenant, {
        tenantId: tenant.id,
        idempotencyKey: "onboard-noallow-1",
        payouts: [whale],
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_WHITELISTED" });

    // Vet the payee, then the same payout settles and debits the balance.
    const { record } = await addTenantRecipient(store, tenant, {
      address: PAYEE,
      targetChain: "base",
      label: "Creator #1",
    });
    expect(store.isRecipientWhitelisted(tenant.id, record.recipientKey)).toBe(true);

    const before = store.balanceOf(tenant.id);
    const result = await processBulkPayout(store, tenant, {
      tenantId: tenant.id,
      idempotencyKey: "onboard-ok-1",
      payouts: [whale],
    });
    expect(result.accepted).toBe(1);
    expect(result.whaleCount).toBe(1);
    expect(store.balanceOf(tenant.id)).toBe(before - BigInt(result.totalDebited6));
    expect(store.listRecipients(tenant.id)).toHaveLength(1);
  });

  it("revokes a payee so subsequent payouts are blocked again", async () => {
    const store = new Store();
    const { tenant } = await signupTenant(store, { name: "Globex", onchainAddress: WALLET });
    const { record } = await addTenantRecipient(store, tenant, { address: PAYEE, targetChain: "base" });

    const { removed } = await removeTenantRecipient(store, tenant, record.recipientKey as `0x${string}`);
    expect(removed).toBe(true);
    expect(store.isRecipientWhitelisted(tenant.id, record.recipientKey)).toBe(false);
    expect(store.listRecipients(tenant.id)).toHaveLength(0);
  });
});

describe("REST onboarding gateway", () => {
  function app() {
    const store = new Store();
    const a = new Hono();
    a.route("/api/v1", tenantRoutes(store));
    return { a, store };
  }

  it("POST /tenants/signup returns 201 with a one-time api key", async () => {
    const { a } = app();
    const res = await a.request("/api/v1/tenants/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Initech", onchainAddress: WALLET }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; apiKey: string; tenantId: string };
    expect(json.ok).toBe(true);
    expect(json.apiKey).toMatch(/^arc_(test|live)_sk_/);
    expect(json.tenantId).toMatch(/[0-9a-f-]{36}/);
  });

  it("rejects an invalid wallet address with 400", async () => {
    const { a } = app();
    const res = await a.request("/api/v1/tenants/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Initech", onchainAddress: "not-an-address" }),
    });
    expect(res.status).toBe(400);
  });

  it("manages payees over REST with the issued key", async () => {
    const { a, store } = app();
    const signup = await a.request("/api/v1/tenants/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Initech", onchainAddress: WALLET }),
    });
    const { apiKey } = (await signup.json()) as { apiKey: string };

    const add = await a.request("/api/v1/recipients", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ address: PAYEE, targetChain: "base", label: "Vendor" }),
    });
    expect(add.status).toBe(201);

    const list = await a.request("/api/v1/recipients", { headers: { "x-api-key": apiKey } });
    const listed = (await list.json()) as { recipients: unknown[] };
    expect(listed.recipients).toHaveLength(1);
    void store;
  });
});
