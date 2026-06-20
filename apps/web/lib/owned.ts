/**
 * Local cache of content this device has unlocked, with a tiny pub/sub so every
 * mounted PieceCard reveals instantly when content arrives — whether from a
 * sponsored unlock, a wallet payment, or a "restore purchases" signature.
 *
 * This is intentionally client-trusted: it only ever holds content the user has
 * already legitimately unlocked on this device, so caching it locally just saves
 * a round-trip (and, for wallet purchases, a re-signature) on refresh. The server
 * remains the source of truth — content only enters this cache after a real
 * unlock or a signature-proven restore.
 */

const PREFIX = "splitstream_owned_";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Content this device has unlocked for `pieceId`, or null if not cached. */
export function getOwnedContent(pieceId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PREFIX + pieceId);
}

/** Cache unlocked content for `pieceId` and notify any subscribed cards. */
export function cacheOwnedContent(pieceId: string, content: string | null | undefined): void {
  if (typeof window === "undefined" || !content) return;
  window.localStorage.setItem(PREFIX + pieceId, content);
  for (const l of listeners) l();
}

/** Subscribe to cache changes (e.g. a restore revealed several pieces at once). */
export function subscribeOwned(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
