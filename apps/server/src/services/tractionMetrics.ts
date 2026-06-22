/**
 * RFB-06 traction metrics, computed ONLY from the real on-chain settlement ledger
 * (never simulated counters). These render the judged phrases verbatim:
 *   - "creators earning"            → topCreators (real USDC per contributor)
 *   - "average payment per piece"   → avgPaymentPerPiece
 *   - "reader-to-payer conversion"  → readerToPayerConversion
 */

import { formatUsdc6 } from "@arcane/shared";
import type { Store } from "../db/store.js";

/** One creator's real earnings, rolled up across every on-chain payout to them. */
export interface CreatorEarning {
  address: string;
  earnedUSDC: string;
  payouts: number;
  roles: string[];
  lastTitle: string;
}

export interface RealTractionMetrics {
  /** "Creators earning" — ranked by real USDC earned on Arc, desc. */
  topCreators: CreatorEarning[];
  /** Real gross price averaged over real unlocks ("average payment per piece"). */
  avgPaymentPerPiece: string;
  uniqueVisitors: number;
  realBuyerCount: number;
  /** realBuyers / uniqueVisitors, as a percentage rounded to 0.1. */
  readerToPayerConversion: number;
}

/** Compute all real-only RFB-06 metrics from the store's settlement ledger. */
export function computeRealTractionMetrics(store: Store, topN = 12): RealTractionMetrics {
  const settlements = store.onchainSettlements;

  // Roll real payouts up by contributor address.
  const byCreator = new Map<
    string,
    { address: string; earned6: bigint; payouts: number; roles: Set<string>; lastTitle: string }
  >();
  let gross6 = 0n;
  for (const s of settlements) {
    gross6 += s.price6;
    for (const p of s.payouts) {
      const key = p.address.toLowerCase();
      const e =
        byCreator.get(key) ??
        { address: p.address, earned6: 0n, payouts: 0, roles: new Set<string>(), lastTitle: "" };
      e.earned6 += p.share6;
      e.payouts += 1;
      e.roles.add(p.role);
      e.lastTitle = s.title;
      byCreator.set(key, e);
    }
  }

  const topCreators = [...byCreator.values()]
    .sort((a, b) => (a.earned6 < b.earned6 ? 1 : a.earned6 > b.earned6 ? -1 : 0))
    .slice(0, topN)
    .map((e) => ({
      address: e.address,
      earnedUSDC: formatUsdc6(e.earned6),
      payouts: e.payouts,
      roles: [...e.roles],
      lastTitle: e.lastTitle,
    }));

  const avgPaymentPerPiece =
    settlements.length > 0 ? formatUsdc6(gross6 / BigInt(settlements.length)) : "0.00";

  const uniqueVisitors = store.visitors.size;
  const realBuyerCount = store.realBuyers.size;
  const readerToPayerConversion =
    uniqueVisitors > 0 ? Math.round((realBuyerCount / uniqueVisitors) * 1000) / 10 : 0;

  return { topCreators, avgPaymentPerPiece, uniqueVisitors, realBuyerCount, readerToPayerConversion };
}
