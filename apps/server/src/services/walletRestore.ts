/**
 * "Restore purchases" — prove you control a wallet, get back everything it has
 * unlocked. This is what makes the wallet a PORTABLE identity across SplitStream:
 * pay from a browser wallet, a terminal/CLI agent, or an x402 call, then connect
 * that same wallet anywhere and read your content.
 *
 * Why a signature (not just an address): wallet addresses are PUBLIC — they sit
 * in plain sight in every payment tx on Arc. So "knows the address" can't be the
 * bar to reveal paid content, or anyone watching the chain could read it for
 * free. The reader must PROVE control of the address by signing a fresh,
 * timestamped message (gasless, instant). We recover the signer from the
 * signature and only then return the content. This also closes the address-leak
 * on `pieces.access` (which now never returns content for a bare address).
 */

import { recoverMessageAddress, type Hex } from "viem";
import { ArcaneError } from "@arcane/shared";
import type { Store } from "../db/store.js";

/** First line of the message the wallet signs — must match on client and server. */
export const OWNERSHIP_DOMAIN =
  "SplitStream: prove wallet ownership to restore your unlocked content.";

/** A signed ownership proof is only valid for a short window (anti-stale/replay). */
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

const bad = (msg: string) => new ArcaneError("VALIDATION_FAILED", msg, 400);

/** Build the exact message a wallet signs to prove ownership of `address`. */
export function ownershipMessage(address: string, issuedISO: string): string {
  return `${OWNERSHIP_DOMAIN}\n\nWallet: ${address}\nIssued: ${issuedISO}`;
}

/** One unlocked piece returned to its owner after a proven restore. */
export interface RestoredPiece {
  pieceId: string;
  title: string;
  kind: string;
  /** Gated content (null for "api" pieces, which are pay-per-call). */
  content: string | null;
}

export interface RestoreResult {
  /** The proven wallet address (checksummed/lowercased as recovered). */
  address: string;
  count: number;
  pieces: RestoredPiece[];
}

/**
 * Verify a wallet-ownership signature and return every piece that wallet owns.
 * Throws a 400 ArcaneError if the proof is malformed, stale, or doesn't match.
 */
export async function restoreEntitlements(
  store: Store,
  args: { address: string; message: string; signature: string },
  now = Date.now(),
): Promise<RestoreResult> {
  const { address, message, signature } = args;

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw bad("a wallet address is required");
  if (!/^0x[a-fA-F0-9]+$/.test(signature)) throw bad("a signature is required");
  if (!message.startsWith(OWNERSHIP_DOMAIN)) throw bad("unexpected ownership message");

  // The signed message must embed the SAME wallet it claims, plus a recent
  // timestamp — so a leaked/old signature for one purpose can't be reused.
  const walletLine = /Wallet:\s*(0x[a-fA-F0-9]{40})/.exec(message);
  if (!walletLine || walletLine[1]!.toLowerCase() !== address.toLowerCase()) {
    throw bad("message wallet does not match the claimed address");
  }
  const issuedLine = /Issued:\s*(\S+)/.exec(message);
  const issuedMs = issuedLine ? Date.parse(issuedLine[1]!) : NaN;
  if (Number.isNaN(issuedMs) || Math.abs(now - issuedMs) > MAX_AGE_MS) {
    throw bad("signature expired — please sign again");
  }

  // Recover the signer from the signature and confirm it controls the address.
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    throw bad("could not verify the signature");
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw bad("signature does not match the wallet");
  }

  // Ownership proven — hand back every piece this wallet has unlocked.
  const pieces: RestoredPiece[] = [];
  for (const id of store.entitledPieceIdsFor(address)) {
    const p = store.getPiece(id);
    if (!p) continue;
    pieces.push({
      pieceId: p.id,
      title: p.title,
      kind: p.kind,
      content: p.kind === "api" ? null : p.content ?? null,
    });
  }
  return { address: recovered, count: pieces.length, pieces };
}
