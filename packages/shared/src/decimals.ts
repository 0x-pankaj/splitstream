/**
 * The Arc Precision Duality — the single most dangerous footgun in this product.
 *
 * USDC on Arc is ONE balance with TWO interfaces:
 *   - Native coin (gas accounting): 18 decimals, like ETH/wei.
 *   - ERC-20 interface (0x3600…):    6 decimals, the standard USDC representation.
 *
 * Rule for this codebase: ALL value/accounting math uses 6-decimal "base units"
 * (bigint). We only ever cross into 18 decimals when a viem/native-value API
 * demands it, and we do that conversion explicitly through these helpers. Never
 * mix the two precisions implicitly.
 */

/** USDC ERC-20 interface decimals. */
export const USDC_DECIMALS = 6;
/** Arc native-coin (gas) decimals. */
export const NATIVE_DECIMALS = 18;
/** Scale factor between the 6dp ERC-20 view and the 18dp native view. */
export const DUALITY_SCALE = 10n ** BigInt(NATIVE_DECIMALS - USDC_DECIMALS); // 1e12

const SIX = 10n ** 6n;

/**
 * Parse a human USDC string ("1234.56") into 6-decimal base units (bigint).
 * Rejects more than 6 fractional digits rather than silently truncating money.
 */
export function parseUsdc6(human: string): bigint {
  const trimmed = human.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${human}"`);
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > USDC_DECIMALS) {
    throw new Error(
      `USDC amount "${human}" has more than ${USDC_DECIMALS} decimal places`,
    );
  }
  const padded = frac.padEnd(USDC_DECIMALS, "0");
  return BigInt(whole) * SIX + BigInt(padded || "0");
}

/** Format 6-decimal base units (bigint) back into a human USDC string. */
export function formatUsdc6(base6: bigint): string {
  const neg = base6 < 0n;
  const abs = neg ? -base6 : base6;
  const whole = abs / SIX;
  const frac = (abs % SIX).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

/**
 * Convert 6dp ERC-20 base units up to the 18dp native representation.
 * Exact and lossless (multiplication).
 */
export function to18(base6: bigint): bigint {
  return base6 * DUALITY_SCALE;
}

/**
 * Convert 18dp native units down to the 6dp ERC-20 representation.
 *
 * Lossy by construction: amounts below 1e-6 USDC cannot be represented in the
 * ERC-20 view. We FLOOR (round toward zero) and surface the dropped dust so
 * callers can assert on it when correctness matters. Per Arc docs, sub-1e-6
 * USDC amounts simply cannot move through the ERC-20 interface.
 */
export function to6(base18: bigint): { amount6: bigint; dust18: bigint } {
  const amount6 = base18 / DUALITY_SCALE;
  const dust18 = base18 - amount6 * DUALITY_SCALE;
  return { amount6, dust18 };
}

/** Convenience: format 6dp base units as a USD display string with the $ sign. */
export function formatUsd(base6: bigint): string {
  return `$${formatUsdc6(base6)}`;
}
