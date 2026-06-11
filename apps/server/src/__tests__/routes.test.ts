import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_TENANT_ID, DEMO_API_KEY, DEMO_RECIPIENTS } from "../db/seed.js";
import { payoutRoutes } from "../routes/payouts.js";
import { resetCursors } from "../services/solverMesh.js";
import { resetAgentWindows } from "../services/agentTreasury.js";

function appWithStore() {
  const store = new Store();
  seedDemo(store);
  const app = new Hono();
  app.route("/api/v1/payouts", payoutRoutes(store));
  return { app, store };
}

const validBody = {
  tenantId: DEMO_TENANT_ID,
  idempotencyKey: "route-test-0001",
  payouts: [
    { recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "250", currencyCode: "USD" },
  ],
};

beforeEach(() => {
  resetCursors();
  resetAgentWindows();
});

describe("POST /api/v1/payouts/bulk", () => {
  it("settles a valid batch with a scoped api key", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/v1/payouts/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": DEMO_API_KEY },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; accepted: number };
    expect(json.ok).toBe(true);
    expect(json.accepted).toBe(1);
  });

  it("rejects a missing api key with 401", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/v1/payouts/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid payload with 400", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/v1/payouts/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": DEMO_API_KEY },
      body: JSON.stringify({ tenantId: DEMO_TENANT_ID, payouts: [] }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a cross-tenant submission with 403", async () => {
    const { app } = appWithStore();
    const res = await app.request("/api/v1/payouts/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": DEMO_API_KEY },
      body: JSON.stringify({ ...validBody, tenantId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(403);
  });
});
