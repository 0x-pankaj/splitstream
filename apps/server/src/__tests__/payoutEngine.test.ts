import { describe, it, expect, beforeEach } from "vitest";
import { parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import {
  seedDemo,
  DEMO_TENANT_ID,
  DEMO_RECIPIENTS,
  DEMO_AGENT_ID,
} from "../db/seed.js";
import { processBulkPayout } from "../services/payoutEngine.js";
import { resetCursors } from "../services/solverMesh.js";
import { resetAgentWindows } from "../services/agentTreasury.js";

function freshStore(): Store {
  const store = new Store();
  seedDemo(store);
  return store;
}

function tenantOf(store: Store) {
  return store.tenants.get(DEMO_TENANT_ID)!;
}

beforeEach(() => {
  resetCursors();
  resetAgentWindows();
});

describe("hybrid payout engine", () => {
  it("routes a mixed batch and records the audit log", async () => {
    const store = freshStore();
    const tenant = tenantOf(store);
    const before = store.balanceOf(DEMO_TENANT_ID);

    const result = await processBulkPayout(store, tenant, {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "test-batch-0001",
      payouts: [
        { recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "250.00", currencyCode: "USD" },
        { recipientAddress: DEMO_RECIPIENTS[2]!.address, targetChain: "ethereum", amountUSDC: "50000", currencyCode: "USD" },
        { recipientAddress: DEMO_RECIPIENTS[3]!.address, targetChain: "solana", amountUSDC: "100", currencyCode: "EUR" },
      ],
    });

    expect(result.accepted).toBe(3);
    expect(result.instantCount).toBe(2); // $250 and €100
    expect(result.whaleCount).toBe(1); // $50,000
    expect(store.auditForTenant(DEMO_TENANT_ID)).toHaveLength(3);

    // Balance debited by gross + fees of the whole batch.
    expect(BigInt(result.totalDebited6)).toBeGreaterThan(0n);
    expect(store.balanceOf(DEMO_TENANT_ID)).toBe(before - BigInt(result.totalDebited6));
  });

  it("converts EUR payouts to EURC with a locked FX rate", async () => {
    const store = freshStore();
    const result = await processBulkPayout(store, tenantOf(store), {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "test-eur-0001",
      payouts: [
        { recipientAddress: DEMO_RECIPIENTS[3]!.address, targetChain: "solana", amountUSDC: "100", currencyCode: "EUR" },
      ],
    });
    const r = result.results[0]!;
    expect(r.payoutCurrency).toBe("EURC");
    expect(r.fxRate6).toBe("920000");
    expect(r.payoutAmount).toBe("92000000"); // 100 USDC -> 92 EURC (6dp)
    expect(r.settlementMode).toBe("simulated");
    expect(r.solverId).not.toBeNull();
  });

  it("assigns deterministic intent ids for an idempotency-keyed batch", async () => {
    const a = await processBulkPayout(freshStore(), tenantOf(freshStore()), {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "stable-key-123",
      payouts: [{ recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "250", currencyCode: "USD" }],
    });
    const b = await processBulkPayout(freshStore(), tenantOf(freshStore()), {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "stable-key-123",
      payouts: [{ recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "250", currencyCode: "USD" }],
    });
    expect(a.results[0]!.intentId).toBe(b.results[0]!.intentId);
  });

  it("rejects a non-whitelisted recipient", async () => {
    const store = freshStore();
    await expect(
      processBulkPayout(store, tenantOf(store), {
        tenantId: DEMO_TENANT_ID,
        idempotencyKey: "bad-recipient-1",
        payouts: [{ recipientAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", targetChain: "base", amountUSDC: "10", currencyCode: "USD" }],
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_WHITELISTED" });
  });

  it("rejects a batch that breaches the rolling velocity cap", async () => {
    const store = freshStore();
    store.setDailyLimit(DEMO_TENANT_ID, parseUsdc6("1000")); // tighten cap to $1,000
    await expect(
      processBulkPayout(store, tenantOf(store), {
        tenantId: DEMO_TENANT_ID,
        idempotencyKey: "velocity-1",
        payouts: [{ recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "1500", currencyCode: "USD" }],
      }),
    ).rejects.toMatchObject({ code: "VELOCITY_LIMIT_EXCEEDED" });
  });

  it("rejects a batch exceeding the tenant's vault balance", async () => {
    const store = new Store();
    seedDemo(store, { initialBalance6: parseUsdc6("100"), dailyLimit6: parseUsdc6("1000000") });
    await expect(
      processBulkPayout(store, tenantOf(store), {
        tenantId: DEMO_TENANT_ID,
        idempotencyKey: "broke-1",
        payouts: [{ recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "500", currencyCode: "USD" }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_VAULT_BALANCE" });
  });

  it("round-robins solver selection across instant payouts", async () => {
    const store = freshStore();
    const result = await processBulkPayout(store, tenantOf(store), {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "rr-1",
      payouts: [
        { recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "10", currencyCode: "USD" },
        { recipientAddress: DEMO_RECIPIENTS[4]!.address, targetChain: "base", amountUSDC: "10", currencyCode: "USD" },
      ],
    });
    // base is supported by all three solvers; round-robin picks different ones.
    expect(result.results[0]!.solverId).not.toBe(result.results[1]!.solverId);
  });

  it("enforces the agent velocity policy when an agent initiates the batch", async () => {
    const store = freshStore();
    // perTransaction cap is $2,500; a single $3,000 payout must be rejected.
    await expect(
      processBulkPayout(store, tenantOf(store), {
        tenantId: DEMO_TENANT_ID,
        idempotencyKey: "agent-overcap-1",
        agentId: DEMO_AGENT_ID,
        payouts: [{ recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "3000", currencyCode: "USD" }],
      }),
    ).rejects.toMatchObject({ code: "AGENT_POLICY_EXCEEDED" });
  });

  it("allows an agent-initiated batch within policy and tracks spend", async () => {
    const store = freshStore();
    await processBulkPayout(store, tenantOf(store), {
      tenantId: DEMO_TENANT_ID,
      idempotencyKey: "agent-ok-1",
      agentId: DEMO_AGENT_ID,
      payouts: [{ recipientAddress: DEMO_RECIPIENTS[1]!.address, targetChain: "arbitrum", amountUSDC: "2000", currencyCode: "USD" }],
    });
    expect(store.agent(DEMO_AGENT_ID)!.spend.daily6).toBe(parseUsdc6("2000"));
  });
});
