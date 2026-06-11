/**
 * The Solver Mesh — instant-path orchestration.
 *
 * Models a pool of institutional market-makers ("solvers") that front payouts
 * to recipients from their cross-chain hot-wallet reserves and are reimbursed
 * on Arc L1. Solver selection is deterministic ROUND-ROBIN, never random: Arc's
 * PREVRANDAO is always 0, so on-chain randomness is unsafe — we make the same
 * choice deterministic off-chain for reproducibility and auditability.
 *
 * Flow per payout:
 *   1. select an online solver with sufficient reserves on the destination chain
 *   2. solver fronts the payout (Gateway unified-balance spend) → receipt
 *   3. verify the destination-chain receipt
 *   4. debit the solver's reserve (reimbursed later on Arc via executeIntent)
 */

import { errors, type Solver, type TargetChain } from "@arcane/shared";
import type { Store } from "../db/store.js";
import { settleInstant } from "./gateway.js";
import type { SettlementReceipt } from "./rails.js";

/** Per-chain round-robin cursors. Reset via {@link resetCursors} in tests. */
const cursors = new Map<TargetChain, number>();

export function resetCursors(): void {
  cursors.clear();
}

export interface MeshSettlement {
  solver: Solver;
  receipt: SettlementReceipt;
  verified: boolean;
}

/** Pick the next eligible solver for a chain/amount using round-robin. */
export function selectSolver(
  store: Store,
  chain: TargetChain,
  amount6: bigint,
): Solver {
  const eligible = store
    .solversForChain(chain)
    .filter((s) => s.reserves6[chain] >= amount6);
  if (eligible.length === 0) {
    throw errors.solverUnavailable({ chain, amount6: amount6.toString() });
  }
  const cursor = cursors.get(chain) ?? 0;
  const solver = eligible[cursor % eligible.length]!;
  cursors.set(chain, cursor + 1);
  return solver;
}

/** Settle one payout through the mesh on the instant path. */
export async function settleThroughMesh(
  store: Store,
  input: {
    intentId: string;
    recipient: string;
    destinationChain: TargetChain;
    amount6: bigint;
  },
): Promise<MeshSettlement> {
  const solver = selectSolver(store, input.destinationChain, input.amount6);

  const receipt = await settleInstant({
    intentId: input.intentId,
    recipient: input.recipient,
    destinationChain: input.destinationChain,
    amount6: input.amount6,
  });

  const verified = verifyReceipt(receipt);
  if (!verified) {
    throw errors.solverUnavailable({ reason: "receipt verification failed" });
  }

  // Solver fronted the funds; debit its hot-wallet reserve until reimbursed.
  solver.reserves6[input.destinationChain] -= input.amount6;

  return { solver, receipt, verified };
}

/**
 * Verify a destination-chain settlement receipt. In live mode this would query
 * an independent RPC node on the target chain to confirm the transfer landed;
 * for simulated receipts the deterministic hash is self-consistent.
 */
export function verifyReceipt(receipt: SettlementReceipt): boolean {
  return Boolean(receipt.destinationTxHash) && receipt.amount6 > 0n;
}

/**
 * Replenish a solver's reserve on a chain — represents the completed background
 * CCTP burn-on-Arc → mint-on-target loop that rebalances solver hot wallets
 * over time. Called after Arc reimbursement to restore mesh capacity.
 */
export function rebalanceSolverReserve(
  solver: Solver,
  chain: TargetChain,
  amount6: bigint,
): void {
  solver.reserves6[chain] += amount6;
}
