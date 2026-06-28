/**
 * A single creator's real earnings, rolled up from the on-chain settlement ledger
 * by their payout address. Powers the creator dashboard — the self-serve view of
 * "creators earning" that makes the RFB-06 traction metric tangible per person.
 *
 * Sourced ONLY from real Arc settlements (never simulated counters), consistent
 * with the public leaderboard in tractionMetrics.ts.
 */

import { formatUsdc6 } from "@arcane/shared";
import type { Store } from "../db/store.js";

export interface CreatorEarningPiece {
  pieceId: string;
  title: string;
  earnedUSDC: string;
  payouts: number;
}

export interface CreatorRecentPayout {
  title: string;
  role: string;
  shareUSDC: string;
  txHash: string;
  at: string;
}

export interface CreatorEarnings {
  address: string | null;
  totalEarnedUSDC: string;
  payoutCount: number;
  /** Per-piece breakdown, highest-earning first. */
  pieces: CreatorEarningPiece[];
  /** Most recent real payouts to this address, newest first (max 12). */
  recent: CreatorRecentPayout[];
}

/** Roll up every real on-chain payout to `address` (case-insensitive). */
export function creatorEarnings(store: Store, address: string | null): CreatorEarnings {
  const empty: CreatorEarnings = {
    address,
    totalEarnedUSDC: "0.00",
    payoutCount: 0,
    pieces: [],
    recent: [],
  };
  if (!address) return empty;

  const wanted = address.toLowerCase();
  let total6 = 0n;
  let payoutCount = 0;
  const byPiece = new Map<string, { pieceId: string; title: string; earned6: bigint; payouts: number }>();
  const recent: CreatorRecentPayout[] = [];

  for (const s of store.onchainSettlements) {
    for (const p of s.payouts) {
      if (p.address.toLowerCase() !== wanted) continue;
      total6 += p.share6;
      payoutCount += 1;
      const e =
        byPiece.get(s.pieceId) ?? { pieceId: s.pieceId, title: s.title, earned6: 0n, payouts: 0 };
      e.earned6 += p.share6;
      e.payouts += 1;
      byPiece.set(s.pieceId, e);
      recent.push({
        title: s.title,
        role: p.role,
        shareUSDC: formatUsdc6(p.share6),
        txHash: p.txHash,
        at: s.at,
      });
    }
  }

  const pieces = [...byPiece.values()]
    .sort((a, b) => (a.earned6 < b.earned6 ? 1 : a.earned6 > b.earned6 ? -1 : 0))
    .map((e) => ({
      pieceId: e.pieceId,
      title: e.title,
      earnedUSDC: formatUsdc6(e.earned6),
      payouts: e.payouts,
    }));

  return {
    address,
    totalEarnedUSDC: formatUsdc6(total6),
    payoutCount,
    pieces,
    recent: recent.reverse().slice(0, 12),
  };
}
