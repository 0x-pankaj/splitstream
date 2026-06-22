import { describe, it, expect } from "vitest";
import { parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import { computeRealTractionMetrics } from "../services/tractionMetrics.js";

/** Helper: record a real on-chain settlement with the given per-creator payouts. */
function settle(store: Store, price: string, payouts: Array<{ role: string; address: string; share: string }>) {
  store.recordOnchainSettlement({
    pieceId: "p",
    title: "Demo piece",
    kind: "article",
    price6: parseUsdc6(price),
    payer: "0xpayer",
    paymentTx: "0xtx",
    payouts: payouts.map((p) => ({ role: p.role, address: p.address, share6: parseUsdc6(p.share), txHash: "0xpo" })),
    at: "2026-06-22T00:00:00.000Z",
  });
}

describe("computeRealTractionMetrics (RFB-06, real-only)", () => {
  it("aggregates creator earnings by address, ranked desc, summing real payouts", () => {
    const store = new Store();
    settle(store, "0.05", [
      { role: "writer", address: "0xAAA", share: "0.03" },
      { role: "editor", address: "0xBBB", share: "0.02" },
    ]);
    settle(store, "0.05", [
      { role: "writer", address: "0xaaa", share: "0.03" }, // same writer, different case
      { role: "editor", address: "0xBBB", share: "0.02" },
    ]);

    const m = computeRealTractionMetrics(store);
    // Two distinct creators; writer earned more so ranks first.
    expect(m.topCreators).toHaveLength(2);
    expect(m.topCreators[0]!.earnedUSDC).toBe("0.06"); // 0.03 + 0.03
    expect(m.topCreators[0]!.payouts).toBe(2);
    expect(m.topCreators[1]!.earnedUSDC).toBe("0.04"); // 0.02 + 0.02
    // Average payment per piece = mean gross price over the 2 settlements.
    expect(m.avgPaymentPerPiece).toBe("0.05");
  });

  it("computes reader-to-payer conversion from real buyers / visitors", () => {
    const store = new Store();
    store.recordVisitor("v1");
    store.recordVisitor("v2");
    store.recordVisitor("v3");
    store.recordVisitor("v4");
    store.recordRealBuyer("v1"); // real buyer is also a visitor (subset)
    store.recordRealBuyer("v5"); // a brand-new real buyer also counts as a visitor

    const m = computeRealTractionMetrics(store);
    // visitors: v1..v4 + v5 (added by recordRealBuyer) = 5; real buyers: v1, v5 = 2.
    expect(m.uniqueVisitors).toBe(5);
    expect(m.realBuyerCount).toBe(2);
    expect(m.readerToPayerConversion).toBe(40); // 2/5 = 40.0%
  });

  it("returns safe zeros with no settlements or visitors", () => {
    const store = new Store();
    const m = computeRealTractionMetrics(store);
    expect(m.topCreators).toHaveLength(0);
    expect(m.avgPaymentPerPiece).toBe("0.00");
    expect(m.readerToPayerConversion).toBe(0);
  });
});
