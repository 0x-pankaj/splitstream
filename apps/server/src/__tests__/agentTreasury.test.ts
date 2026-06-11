import { describe, it, expect, beforeEach } from "vitest";
import { parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import {
  createAgentWallet,
  authorizeAgentSpend,
  authorizeAgentBatch,
  setAgentEnabled,
  resetAgentWindows,
} from "../services/agentTreasury.js";

const TENANT = "00000000-0000-4000-8000-000000000099";

function withAgent() {
  const store = new Store();
  const t0 = 1_000_000_000_000; // fixed epoch ms for deterministic windows
  createAgentWallet(
    store,
    {
      agentId: "agent-1",
      tenantId: TENANT,
      label: "Test Agent",
      policy: { perTransaction: "2500", daily: "50000", weekly: "250000", monthly: "750000" },
    },
    t0,
  );
  return { store, t0 };
}

beforeEach(() => resetAgentWindows());

describe("agent velocity policy", () => {
  it("rejects a spend above the per-transaction cap", () => {
    const { store, t0 } = withAgent();
    expect(() => authorizeAgentSpend(store, "agent-1", parseUsdc6("3000"), t0)).toThrow();
  });

  it("accumulates daily spend and rejects once the daily cap is hit", () => {
    const { store, t0 } = withAgent();
    for (let i = 0; i < 20; i++) {
      authorizeAgentSpend(store, "agent-1", parseUsdc6("2500"), t0); // 20 * 2500 = 50,000
    }
    expect(store.agent("agent-1")!.spend.daily6).toBe(parseUsdc6("50000"));
    expect(() => authorizeAgentSpend(store, "agent-1", parseUsdc6("1"), t0)).toThrow();
  });

  it("resets the daily window after 24h", () => {
    const { store, t0 } = withAgent();
    // Fill the daily cap ($50k) via per-tx-sized spends, then the next is rejected.
    for (let i = 0; i < 20; i++) {
      authorizeAgentSpend(store, "agent-1", parseUsdc6("2500"), t0);
    }
    expect(() => authorizeAgentSpend(store, "agent-1", parseUsdc6("1"), t0)).toThrow();

    const nextDay = t0 + 24 * 60 * 60 * 1000 + 1;
    authorizeAgentSpend(store, "agent-1", parseUsdc6("2500"), nextDay);
    expect(store.agent("agent-1")!.spend.daily6).toBe(parseUsdc6("2500"));
  });

  it("authorizes a batch atomically (rejected batch records nothing)", () => {
    const { store, t0 } = withAgent();
    // One item over per-tx cap → whole batch rejected, no spend recorded.
    expect(() =>
      authorizeAgentBatch(store, "agent-1", [parseUsdc6("2000"), parseUsdc6("3000")], t0),
    ).toThrow();
    expect(store.agent("agent-1")!.spend.daily6).toBe(0n);
  });

  it("rejects spend from a disabled agent", () => {
    const { store, t0 } = withAgent();
    setAgentEnabled(store, "agent-1", false);
    expect(() => authorizeAgentSpend(store, "agent-1", parseUsdc6("1"), t0)).toThrow();
  });
});
