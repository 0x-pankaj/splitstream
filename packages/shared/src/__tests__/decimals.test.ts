import { describe, it, expect } from "vitest";
import {
  parseUsdc6,
  formatUsdc6,
  to18,
  to6,
  DUALITY_SCALE,
} from "../decimals.js";

describe("parseUsdc6 / formatUsdc6", () => {
  it("round-trips whole and fractional amounts", () => {
    expect(parseUsdc6("250")).toBe(250_000_000n);
    expect(parseUsdc6("250.50")).toBe(250_500_000n);
    expect(parseUsdc6("0.000001")).toBe(1n);
    expect(formatUsdc6(250_000_000n)).toBe("250");
    expect(formatUsdc6(250_500_000n)).toBe("250.5");
    expect(formatUsdc6(1n)).toBe("0.000001");
  });

  it("rejects more than 6 decimal places rather than truncating money", () => {
    expect(() => parseUsdc6("1.1234567")).toThrow(/decimal places/);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseUsdc6("abc")).toThrow(/Invalid USDC amount/);
    expect(() => parseUsdc6("")).toThrow();
  });
});

describe("Arc precision duality (6dp <-> 18dp)", () => {
  it("to18 is exact and lossless", () => {
    expect(to18(1n)).toBe(DUALITY_SCALE);
    expect(to18(250_000_000n)).toBe(250_000_000n * DUALITY_SCALE);
  });

  it("to6 floors and reports dropped dust below 1e-6 USDC", () => {
    const { amount6, dust18 } = to6(DUALITY_SCALE + 5n);
    expect(amount6).toBe(1n);
    expect(dust18).toBe(5n);
  });

  it("native->erc20->native is identity when there is no sub-1e-6 dust", () => {
    const base6 = 1_234_567n;
    const back = to6(to18(base6));
    expect(back.amount6).toBe(base6);
    expect(back.dust18).toBe(0n);
  });
});
