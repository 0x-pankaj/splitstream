/**
 * Pure, deterministic hybrid split-routing + fee logic.
 *
 * This is the heart of the product and the part most worth unit-testing in
 * isolation, so it lives here with no I/O. The backend wires the side effects
 * (Gateway spend, CCTP burn, executeIntent) around these decisions.
 *
 *   amount <  threshold  -> "instant" path (Solver Mesh, settled via Gateway)
 *   amount >= threshold  -> "whale"   path (native CCTP V2 burn/mint)
 */

import { keccak256, encodePacked, toHex } from "viem";
import type { FeeBreakdown, PayoutItem, RoutePath, TargetChain } from "./types.js";
import { parseUsdc6 } from "./decimals.js";

/**
 * Chain-agnostic recipient key used by ArcaneComplianceGuard's on-chain
 * allowlist: keccak256 of the UTF-8 recipient address string. Works uniformly
 * for EVM (0x…) and Solana (base58) recipients. Must match the Solidity side:
 * keccak256(bytes(recipientString)).
 */
export function deriveRecipientKey(recipientAddress: string): `0x${string}` {
  return keccak256(toHex(recipientAddress));
}

/** Default instant/whale boundary: $5,000 (6dp base units). */
export const DEFAULT_INSTANT_THRESHOLD_6 = 5_000n * 1_000_000n;

/** Fee policy, expressed in basis points + flat components (6dp USDC). */
export interface FeePolicy {
  /** SaaS convenience fee, in basis points of gross (100 bps = 1%). */
  convenienceBps: bigint;
  /** Flat network/relayer fee reserved per payout (6dp USDC). */
  networkFlat6: bigint;
}

export const DEFAULT_FEE_POLICY: FeePolicy = {
  convenienceBps: 50n, // 0.50%
  networkFlat6: 10_000n, // $0.01 — covers Arc's ~$0.01 stable gas cost
};

/** Decide which rail a given 6dp amount takes. */
export function selectPath(amount6: bigint, threshold6: bigint): RoutePath {
  return amount6 < threshold6 ? "instant" : "whale";
}

/**
 * Compute the fee split for a payout. The convenience fee and network fee are
 * charged ON TOP of the gross amount the recipient receives, so the tenant is
 * debited `gross + network + convenience` (matching the vault's executeIntent).
 */
export function computeFees(grossAmount6: bigint, policy: FeePolicy): FeeBreakdown {
  const convenienceFee6 = (grossAmount6 * policy.convenienceBps) / 10_000n;
  return {
    grossAmount6,
    networkFee6: policy.networkFlat6,
    convenienceFee6,
  };
}

/** Total debited from the tenant for a payout (gross + both fees). */
export function totalDebit6(fees: FeeBreakdown): bigint {
  return fees.grossAmount6 + fees.networkFee6 + fees.convenienceFee6;
}

/**
 * Derive the deterministic on-chain intent id (bytes32). Stable for a given
 * (tenant, recipient, chain, amount, nonce) tuple so retries are idempotent and
 * the vault can reject duplicates.
 */
export function deriveIntentId(params: {
  tenantId: string;
  recipientAddress: string;
  targetChain: TargetChain;
  amount6: bigint;
  nonce: string;
}): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "string", "string", "uint256", "string"],
      [
        params.tenantId,
        params.recipientAddress,
        params.targetChain,
        params.amount6,
        params.nonce,
      ],
    ),
  );
}

/** Parse + route + price a payout item in one pass. */
export function planPayout(params: {
  item: PayoutItem;
  threshold6: bigint;
  policy: FeePolicy;
}): { amount6: bigint; path: RoutePath; fees: FeeBreakdown } {
  const amount6 = parseUsdc6(params.item.amountUSDC);
  const path = selectPath(amount6, params.threshold6);
  const fees = computeFees(amount6, params.policy);
  return { amount6, path, fees };
}
