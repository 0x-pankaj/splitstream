import { describe, it, expect, vi } from "vitest";
import { ArcaneClient, ArcaneApiError } from "../index.js";

/** Build a fake fetch that responds based on (method, path). */
function fakeFetch(
  routes: Record<string, { status?: number; body: unknown }>,
): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof url === "string" ? url : url.toString());
    const key = `${init?.method ?? "GET"} ${u.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const BASE = "https://api.test";

describe("ArcaneClient", () => {
  it("signs up and returns a one-time api key", async () => {
    const fetch = fakeFetch({
      "POST /api/v1/tenants/signup": {
        status: 201,
        body: { ok: true, tenantId: "t-1", name: "Globex", onchainAddress: "0xabc", apiKey: "arc_live_sk_x", scopes: ["payouts:write"] },
      },
    });
    const acct = await ArcaneClient.signup({ baseUrl: BASE, fetch, name: "Globex", onchainAddress: "0xabc" });
    expect(acct.apiKey).toBe("arc_live_sk_x");
    expect(acct.tenantId).toBe("t-1");
  });

  it("adds a payee and lists payees", async () => {
    const fetch = fakeFetch({
      "POST /api/v1/recipients": {
        status: 201,
        body: { ok: true, recipient: { recipientKey: "0xk", address: "0x1", targetChain: "base", addedAt: "now" } },
      },
      "GET /api/v1/recipients": {
        body: { ok: true, recipients: [{ recipientKey: "0xk", address: "0x1", targetChain: "base", addedAt: "now" }] },
      },
    });
    const arcane = new ArcaneClient({ apiKey: "arc_live_sk_x", baseUrl: BASE, fetch });
    const added = await arcane.recipients.add({ address: "0x1", targetChain: "base" });
    expect(added.recipientKey).toBe("0xk");
    const list = await arcane.recipients.list();
    expect(list).toHaveLength(1);
  });

  it("resolves tenantId via /tenants/me before creating a payout", async () => {
    const fetch = fakeFetch({
      "GET /api/v1/tenants/me": {
        body: { ok: true, tenantId: "t-9", name: "Globex", onchainAddress: "0xabc", scopes: ["payouts:write"] },
      },
      "POST /api/v1/payouts/bulk": {
        body: { ok: true, batchId: "b1", tenantId: "t-9", accepted: 1, totalDebited6: "250000000", instantCount: 0, whaleCount: 1, results: [] },
      },
    });
    const arcane = new ArcaneClient({ apiKey: "arc_live_sk_x", baseUrl: BASE, fetch });
    const res = await arcane.payouts.create({
      idempotencyKey: "payroll-123",
      payouts: [{ recipientAddress: "0x1", targetChain: "base", amountUSDC: "250" }],
    });
    expect(res.tenantId).toBe("t-9");
    expect(res.accepted).toBe(1);
  });

  it("throws a structured ArcaneApiError on a non-2xx response", async () => {
    const fetch = fakeFetch({
      "POST /api/v1/payouts/bulk": {
        status: 403,
        body: { code: "RECIPIENT_NOT_WHITELISTED", message: "not vetted", details: { recipient: "0x1" } },
      },
    });
    const arcane = new ArcaneClient({ apiKey: "k", baseUrl: BASE, fetch, tenantId: "t-1" });
    await expect(
      arcane.payouts.create({ payouts: [{ recipientAddress: "0x1", targetChain: "base", amountUSDC: "1" }] }),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_WHITELISTED", status: 403 });

    await expect(
      arcane.payouts.create({ payouts: [{ recipientAddress: "0x1", targetChain: "base", amountUSDC: "1" }] }),
    ).rejects.toBeInstanceOf(ArcaneApiError);
  });
});
