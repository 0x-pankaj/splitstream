import { describe, it, expect } from "vitest";
import {
  selectPath,
  computeFees,
  totalDebit6,
  deriveIntentId,
  planPayout,
  DEFAULT_INSTANT_THRESHOLD_6,
  DEFAULT_FEE_POLICY,
} from "../routing.js";
import { parseUsdc6 } from "../decimals.js";

describe("hybrid split-routing", () => {
  it("routes below the threshold to the instant path", () => {
    expect(selectPath(parseUsdc6("20"), DEFAULT_INSTANT_THRESHOLD_6)).toBe("instant");
    expect(selectPath(parseUsdc6("4999.999999"), DEFAULT_INSTANT_THRESHOLD_6)).toBe(
      "instant",
    );
  });

  it("routes at/above the threshold to the whale path", () => {
    expect(selectPath(parseUsdc6("5000"), DEFAULT_INSTANT_THRESHOLD_6)).toBe("whale");
    expect(selectPath(parseUsdc6("200000"), DEFAULT_INSTANT_THRESHOLD_6)).toBe("whale");
  });
});

describe("fee model", () => {
  it("computes a 0.5% convenience fee plus the flat network fee", () => {
    const fees = computeFees(parseUsdc6("1000"), DEFAULT_FEE_POLICY);
    expect(fees.grossAmount6).toBe(1_000_000_000n);
    expect(fees.convenienceFee6).toBe(5_000_000n); // 0.5% of $1000 = $5
    expect(fees.networkFee6).toBe(10_000n); // $0.01
    expect(totalDebit6(fees)).toBe(1_005_010_000n);
  });
});

describe("intent id derivation", () => {
  const base = {
    tenantId: "11111111-1111-1111-1111-111111111111",
    recipientAddress: "0x1111111111111111111111111111111111111111",
    targetChain: "base" as const,
    amount6: parseUsdc6("250"),
    nonce: "0",
  };

  it("is deterministic for identical inputs (idempotency)", () => {
    expect(deriveIntentId(base)).toBe(deriveIntentId(base));
  });

  it("changes when any field changes", () => {
    expect(deriveIntentId(base)).not.toBe(
      deriveIntentId({ ...base, nonce: "1" }),
    );
    expect(deriveIntentId(base)).not.toBe(
      deriveIntentId({ ...base, amount6: parseUsdc6("251") }),
    );
  });
});

describe("planPayout end-to-end", () => {
  it("parses, routes, and prices in one pass", () => {
    const plan = planPayout({
      item: {
        recipientAddress: "0x1111111111111111111111111111111111111111",
        targetChain: "base",
        amountUSDC: "250.00",
        currencyCode: "USD",
      },
      threshold6: DEFAULT_INSTANT_THRESHOLD_6,
      policy: DEFAULT_FEE_POLICY,
    });
    expect(plan.amount6).toBe(250_000_000n);
    expect(plan.path).toBe("instant");
    expect(plan.fees.convenienceFee6).toBe(1_250_000n); // 0.5% of $250
  });
});
