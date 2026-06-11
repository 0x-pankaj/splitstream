/**
 * Whale rail — native Circle CCTP V2 (App Kit Bridge).
 *
 * For large/high-assurance transfers the engine bypasses the solver mesh and
 * settles directly through CCTP: burn USDC on Arc (domain 26) → Circle
 * attestation → mint on the destination chain. Slower than Gateway (~1–15 min)
 * but cryptographically guaranteed by Circle end-to-end — the right tradeoff
 * for a CFO moving a $200k supplier payment.
 */

import type { TargetChain } from "@arcane/shared";
import { ARC_TESTNET, CCTP_V2, formatUsdc6 } from "@arcane/shared";
import { simTxHash, type SettlementReceipt } from "./rails.js";
import { config } from "../config.js";
import { bridgeSupported, bridgeUsdcFromArc } from "./bridgeCctp.js";

export interface WhaleSettlementInput {
  intentId: string;
  recipient: string;
  destinationChain: TargetChain;
  amount6: bigint;
}

/** Representative CCTP latency by destination (ms) for the simulated path. */
const CCTP_LATENCY_MS: Record<TargetChain, number> = {
  base: 90_000,
  arbitrum: 120_000,
  ethereum: 900_000, // ~15 min to Ethereum mainnet-class finality
  solana: 150_000,
};

export async function settleWhale(
  input: WhaleSettlementInput,
): Promise<SettlementReceipt> {
  const started = Date.now();

  // Real CCTP V2: burn on Arc (domain 26, TokenMessengerV2 CCTP_V2.tokenMessenger)
  // → Forwarding Service mints native USDC on the destination chain.
  if (config.liveBridge && bridgeSupported(input.destinationChain)) {
    let burnTxHash: string | undefined;
    let mintTxHash: string | undefined;
    try {
      ({ burnTxHash, mintTxHash } = await bridgeUsdcFromArc({
        amountHuman: formatUsdc6(input.amount6),
        recipient: input.recipient,
        destChain: input.destinationChain,
      }));
    } catch (err) {
      // Live mode must fail loudly — never silently downgrade to a simulated
      // receipt, which would misrepresent an unsettled payout as settled.
      throw new Error(
        `live CCTP bridge to ${input.destinationChain} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {
      rail: "cctp",
      destinationChain: input.destinationChain,
      recipient: input.recipient,
      amount6: input.amount6,
      destinationTxHash: mintTxHash ?? burnTxHash ?? simTxHash("cctp", input.intentId),
      sourceTxHash: burnTxHash,
      latencyMs: Date.now() - started,
      mode: "live",
    };
  }

  void CCTP_V2;
  void ARC_TESTNET.cctpDomain;
  return {
    rail: "cctp",
    destinationChain: input.destinationChain,
    recipient: input.recipient,
    amount6: input.amount6,
    destinationTxHash: simTxHash("cctp", input.intentId, input.amount6),
    latencyMs: CCTP_LATENCY_MS[input.destinationChain],
    mode: "simulated",
  };
}
