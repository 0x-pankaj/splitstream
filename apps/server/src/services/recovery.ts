/**
 * Recovery codes — let a NO-WALLET buyer carry their purchases to a new device
 * without signup or KYC. After unlocking, a buyer can mint a short code; entering
 * it on another device copies their entitlements onto that device's reader id.
 *
 * The code is a bearer token (whoever has it can claim the library) — an
 * acceptable trade for low-value pay-per-piece content and the no-signup mission.
 * Wallet buyers don't need this; they restore portably via a signature.
 */

import { ArcaneError } from "@arcane/shared";
import type { Store } from "../db/store.js";

// Unambiguous alphabet (no 0/O/1/I/L) so codes are easy to read and re-type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const bad = (msg: string) => new ArcaneError("VALIDATION_FAILED", msg, 400);

/** A human-friendly code like "SS-AB7K-9QXM". */
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `SS-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/** Normalize a user-entered code: uppercase, strip spaces. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** One owned piece returned after a redeem (so the new device can cache content). */
export interface LibraryPiece {
  pieceId: string;
  title: string;
  kind: string;
  preview: string | null;
  content: string | null;
}

/**
 * Mint a recovery code that backs up `reader`'s current purchases. Requires the
 * reader to actually own something (no empty backups).
 */
export function issueRecoveryCode(store: Store, reader: string): { code: string } {
  if (!reader.trim()) throw bad("a reader id is required");
  if (store.entitledPieceIdsFor(reader).length === 0) {
    throw bad("nothing to back up yet — unlock a piece first");
  }
  let code = generateCode();
  // Avoid the (vanishingly rare) collision with an existing code.
  for (let i = 0; i < 5 && store.readerForRecoveryCode(code); i++) code = generateCode();
  store.createRecoveryCode(code, reader.trim());
  return { code };
}

/**
 * Redeem a code on a new device: copy the source reader's entitlements onto
 * `reader` (the redeeming device's id) and return the now-owned pieces + content
 * so the device can reveal/cache them.
 */
export function redeemRecoveryCode(
  store: Store,
  code: string,
  reader: string,
): { count: number; pieces: LibraryPiece[] } {
  if (!reader.trim()) throw bad("a reader id is required");
  const source = store.readerForRecoveryCode(normalizeCode(code));
  if (!source) throw bad("that recovery code is not valid");

  const pieces: LibraryPiece[] = [];
  for (const id of store.entitledPieceIdsFor(source)) {
    const p = store.getPiece(id);
    if (!p) continue;
    store.grantEntitlement(id, reader); // the redeeming device now owns it too
    pieces.push({
      pieceId: p.id,
      title: p.title,
      kind: p.kind,
      preview: p.preview ?? null,
      content: p.kind === "api" ? null : p.content ?? null,
    });
  }
  if (pieces.length > 0) store.recordBuyer(reader);
  return { count: pieces.length, pieces };
}

/**
 * The pieces a reader owns — their library. Content is returned only for an
 * unguessable browser reader id; a bare wallet address gets metadata only (it
 * must reveal content through the signature-gated `restore`, since addresses are
 * public). API pieces never carry content (pay-per-call).
 */
export function readerLibrary(store: Store, reader: string): { count: number; pieces: LibraryPiece[] } {
  const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(reader);
  const pieces: LibraryPiece[] = [];
  for (const id of store.entitledPieceIdsFor(reader)) {
    const p = store.getPiece(id);
    if (!p) continue;
    pieces.push({
      pieceId: p.id,
      title: p.title,
      kind: p.kind,
      preview: p.preview ?? null,
      content: !isWalletAddress && p.kind !== "api" ? p.content ?? null : null,
    });
  }
  return { count: pieces.length, pieces };
}
