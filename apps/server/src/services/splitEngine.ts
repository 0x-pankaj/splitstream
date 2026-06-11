/**
 * SplitStream's per-piece payment orchestrator.
 *
 * A reader (human or agent) unlocks a piece; this fans that single payment out
 * to every contributor on the chain they want, instantly. It does so by mapping
 * the piece onto the reused bulk-payout engine: contributors become recipients,
 * their basis-point shares become per-recipient amounts. The engine then handles
 * routing (instant vs whale), compliance, cross-chain settlement, Arc L1
 * reimbursement, and the audit log — SplitStream adds only the split math and
 * the content/traction bookkeeping.
 *
 * Fee model (v1): the engine assesses network + convenience fees ON TOP of each
 * contributor's gross share. So we credit the publisher's vault for
 * (sum of shares = price) + (sum of fees) before settling — modelling the
 * reader's funds plus operational cost landing in the vault. Contributors split
 * the full price. v2 will net the platform fee out of the reader's price instead
 * (see SPLITSTREAM_PLAN.md "Fee model").
 */

import {
  computeSplit,
  deriveRecipientKey,
  formatUsdc6,
  planPayout,
  totalDebit6,
  errors,
  type BulkPayoutInput,
  type Piece,
  type TargetChain,
} from "@arcane/shared";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import { processBulkPayout, type BulkPayoutResult, type PayoutResult } from "./payoutEngine.js";

/** Per-contributor view of how a single unlock was split and settled. */
export interface ContributorSettlement {
  role: string;
  recipientAddress: string;
  targetChain: TargetChain;
  splitBps: number;
  /** This contributor's share of the unlock price, 6dp string. */
  share6: string;
  /** Settlement detail from the engine (tx hashes, path, latency). */
  settlement: PayoutResult;
}

/** The receipt returned to a reader after unlocking a piece. */
export interface PieceUnlockResult {
  pieceId: string;
  title: string;
  payer: string | null;
  /** Price the reader paid to unlock, 6dp string. */
  price6: string;
  /** Number of contributors paid in this unlock. */
  contributorCount: number;
  /** Distinct chains funds landed on for this unlock. */
  chains: TargetChain[];
  contributors: ContributorSettlement[];
  /** The underlying bulk-payout batch (engine's authoritative result). */
  batch: BulkPayoutResult;
  /** Running piece stats after this unlock. */
  pieceUnlocks: number;
  pieceTotalPaid6: string;
}

/**
 * Ensure every contributor address is on the publisher tenant's allowlist so the
 * engine's compliance precheck passes. Idempotent — safe to call at creation and
 * again at pay time.
 */
export function whitelistContributors(store: Store, piece: Piece): void {
  for (const c of piece.contributors) {
    store.addRecipient(piece.publisherTenantId, {
      recipientKey: deriveRecipientKey(c.address),
      address: c.address,
      targetChain: c.targetChain,
      label: `${piece.title} — ${c.role}`,
    });
  }
}

/**
 * Pay for (unlock) a piece: split the price across contributors and settle each
 * on their chain via the reused payout engine.
 */
export async function payForPiece(
  store: Store,
  piece: Piece,
  opts: { payer?: string; agentId?: string } = {},
  now = Date.now(),
): Promise<PieceUnlockResult> {
  const tenant = store.tenants.get(piece.publisherTenantId);
  if (!tenant) {
    throw errors.tenantNotFound(piece.publisherTenantId);
  }

  // Make sure contributors are vetted (compliance precheck depends on this).
  whitelistContributors(store, piece);

  // 1) Split the price into exact per-contributor shares.
  const shares6 = computeSplit(piece.price6, piece.contributors);

  // 2) Build the bulk-payout items (contributors → recipients).
  const payouts = piece.contributors.map((c, i) => ({
    recipientAddress: c.address,
    targetChain: c.targetChain,
    amountUSDC: formatUsdc6(shares6[i]!),
    currencyCode: "USD" as const,
  }));

  // 3) Credit the vault for the reader's payment + operational fees so the
  //    engine's funding check always clears (v1 fee-on-top model).
  let fees6 = 0n;
  for (const item of payouts) {
    const planned = planPayout({
      item,
      threshold6: config.instantThreshold6,
      policy: config.feePolicy,
    });
    fees6 += totalDebit6(planned.fees) - planned.amount6;
  }
  store.creditBalance(tenant.id, piece.price6 + fees6);

  // 4) Settle the split through the reused engine.
  const input: BulkPayoutInput = {
    tenantId: tenant.id,
    idempotencyKey: `unlock-${piece.id}-${now.toString(36)}`,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    payouts,
  };
  const batch = await processBulkPayout(store, tenant, input, now);

  // 5) Record the unlock for the traction counter.
  store.recordUnlock(piece.id, piece.price6);
  const updated = store.getPiece(piece.id)!;

  // 6) Assemble the reader-facing receipt, aligning settlements to contributors.
  const contributors: ContributorSettlement[] = piece.contributors.map((c, i) => ({
    role: c.role,
    recipientAddress: c.address,
    targetChain: c.targetChain,
    splitBps: c.splitBps,
    share6: shares6[i]!.toString(),
    settlement: batch.results[i]!,
  }));

  const chains = [...new Set(piece.contributors.map((c) => c.targetChain))];

  return {
    pieceId: piece.id,
    title: piece.title,
    payer: opts.payer ?? null,
    price6: piece.price6.toString(),
    contributorCount: piece.contributors.length,
    chains,
    contributors,
    batch,
    pieceUnlocks: updated.unlocks,
    pieceTotalPaid6: updated.totalPaid6.toString(),
  };
}
