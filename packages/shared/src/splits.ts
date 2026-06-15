/**
 * SplitStream domain — a unit of monetizable content ("piece") and the
 * revenue-split math that fans a single reader payment out to every contributor.
 *
 * This is the product layer that sits on top of the reused payout engine. A
 * piece's contributors become the recipients of a bulk payout; their basis-point
 * shares become the per-recipient amounts. All money is 6-decimal USDC base
 * units (bigint) — see decimals.ts for the Arc precision duality.
 */

import type { TargetChain } from "./types.js";

/**
 * The kind of resource being monetized per-piece. Content kinds (article, photo,
 * song, podcast) unlock on payment; the "api" kind is a paid service — paying
 * proxies one call to its upstream endpoint and returns the response (the
 * x402 / pay-per-call model an AI agent uses).
 */
export type PieceKind = "article" | "photo" | "song" | "podcast" | "api";

/** Basis points denominator: 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

/**
 * One contributor to a piece (writer, editor, photographer, …) and the share of
 * each reader payment they receive, on the chain they want to be paid on.
 */
export interface Contributor {
  /** Human label for the contributor's role, e.g. "writer", "editor". */
  role: string;
  /** Payout address on `targetChain` (EVM 0x… or base58 Solana). */
  address: string;
  /** Chain this contributor is paid on. */
  targetChain: TargetChain;
  /** Revenue share in basis points. All contributors' shares must sum to 10000. */
  splitBps: number;
}

/** A monetizable piece of content with a per-unlock price and a contributor split. */
export interface Piece {
  id: string;
  /** The publisher tenant that owns this piece and funds its vault account. */
  publisherTenantId: string;
  title: string;
  kind: PieceKind;
  /** Price to unlock the piece (or to make one API call), in 6dp USDC base units. */
  price6: bigint;
  /** For kind "api": the upstream endpoint the platform proxies one call to. */
  endpoint?: string;
  /** For kind "api": HTTP method used to call `endpoint` (default GET). */
  httpMethod?: "GET" | "POST";
  /** Everyone who gets paid when the piece is unlocked. Shares sum to 10000 bps. */
  contributors: Contributor[];
  createdAt: string;
  /** Running count of paid unlocks — feeds the traction counter. */
  unlocks: number;
  /** Total paid out across all unlocks, 6dp — the headline traction number. */
  totalPaid6: bigint;
}

/**
 * Validate that a contributor set's basis points sum to exactly 10000.
 * Throws a descriptive Error otherwise. Call this before persisting a piece.
 */
export function assertBpsSum(contributors: Contributor[]): void {
  if (contributors.length === 0) {
    throw new Error("A piece needs at least one contributor");
  }
  const sum = contributors.reduce((acc, c) => acc + c.splitBps, 0);
  if (sum !== BPS_DENOMINATOR) {
    throw new Error(
      `Contributor splitBps must sum to ${BPS_DENOMINATOR} (100%); got ${sum}`,
    );
  }
}

/**
 * Split a 6dp price across contributors by their basis-point shares.
 *
 * Each share is floor(price6 * splitBps / 10000). Integer division drops dust
 * (sub-base-unit remainders), so the floored shares can sum to slightly less
 * than `price6`. We assign the entire remainder to the contributor with the
 * LARGEST splitBps (first on ties) so the returned shares ALWAYS sum to exactly
 * `price6` — money is never lost or minted.
 *
 * Returns shares aligned by index with `contributors`. Assumes bps already sum
 * to 10000 (call `assertBpsSum` first).
 */
export function computeSplit(price6: bigint, contributors: Contributor[]): bigint[] {
  if (price6 < 0n) {
    throw new Error("price6 must be non-negative");
  }
  assertBpsSum(contributors);

  const shares = contributors.map(
    (c) => (price6 * BigInt(c.splitBps)) / BigInt(BPS_DENOMINATOR),
  );

  const distributed = shares.reduce((acc, s) => acc + s, 0n);
  const remainder = price6 - distributed;

  if (remainder > 0n) {
    let largestIdx = 0;
    for (let i = 1; i < contributors.length; i++) {
      if (contributors[i]!.splitBps > contributors[largestIdx]!.splitBps) {
        largestIdx = i;
      }
    }
    shares[largestIdx] = shares[largestIdx]! + remainder;
  }

  return shares;
}
