/**
 * Instant rail — Circle Gateway unified balance (sub-500ms).
 *
 * Gateway is Arc's native instant cross-chain primitive: a unified USDC balance
 * the platform funds once on Arc and spends on any supported chain without
 * per-chain bridging or destination liquidity. The solver mesh fronts payouts
 * via this rail and is reimbursed on Arc L1 (executeIntent).
 *
 * When LIVE_GATEWAY=true and a relayer key is present, settlement is a REAL
 * `unifiedBalance.spend` through App Kit; any failure surfaces loudly. Otherwise
 * we return a deterministic sub-500ms simulated receipt so the engine stays
 * demoable without a funded Gateway float.
 */

import type { TargetChain } from "@arcane/shared";
import { formatUsdc6 } from "@arcane/shared";
import { simTxHash, type SettlementReceipt } from "./rails.js";
import { config } from "../config.js";
import { gatewaySupported, spendViaGateway } from "./gatewayUnifiedBalance.js";

export interface InstantSettlementInput {
  intentId: string;
  recipient: string;
  destinationChain: TargetChain;
  amount6: bigint;
}

/**
 * Settle a payout instantly to the recipient on the destination chain via the
 * Gateway unified balance. Uses the real rail when live; otherwise a
 * deterministic sub-500ms simulation.
 */
export async function settleInstant(
  input: InstantSettlementInput,
): Promise<SettlementReceipt> {
  const started = Date.now();

  // Real Circle Gateway spend: burn from the Arc unified-balance float →
  // Forwarding Service mints native USDC to the recipient on the destination.
  if (config.liveGateway && gatewaySupported(input.destinationChain)) {
    let txHash: string | undefined;
    try {
      ({ txHash } = await spendViaGateway({
        amountHuman: formatUsdc6(input.amount6),
        recipient: input.recipient,
        destChain: input.destinationChain,
      }));
    } catch (err) {
      // Live mode must fail loudly — never silently downgrade to a simulated
      // receipt, which would misrepresent an unsettled payout as settled.
      throw new Error(
        `live Gateway settlement to ${input.destinationChain} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {
      rail: "gateway",
      destinationChain: input.destinationChain,
      recipient: input.recipient,
      amount6: input.amount6,
      destinationTxHash: txHash ?? simTxHash("gateway", input.intentId, input.amount6),
      latencyMs: Date.now() - started,
      mode: "live",
    };
  }

  // Simulated Gateway settlement: sub-500ms, deterministic receipt.
  return {
    rail: "gateway",
    destinationChain: input.destinationChain,
    recipient: input.recipient,
    amount6: input.amount6,
    destinationTxHash: simTxHash("gateway", input.intentId, input.amount6),
    latencyMs: 180 + Number(BigInt(simTxHash("lat", input.intentId)) % 270n),
    mode: "simulated",
  };
}
