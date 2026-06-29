/** Compact, embeddable TipJar/unlock widget — rendered inside an iframe on any
 *  third-party site via /widget.js. Walletless by design (the relayer covers the
 *  payment), so it works anywhere with no wallet, then splits to every creator on
 *  Arc. Posts its height to the parent so the host iframe auto-resizes. */

"use client";

import { useEffect, useRef, useState } from "react";
import { trpc, errorInfo, getReaderId } from "../../../lib/trpc";
import type { PieceMeta } from "../../../lib/site";

const CHAIN_TINT: Record<string, string> = {
  base: "#2563EB",
  arbitrum: "#0E7490",
  ethereum: "#6366F1",
  solana: "#059669",
};

export default function EmbedClient({ piece }: { piece: PieceMeta }) {
  const isApi = piece.kind === "api";
  const rootRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [owned, setOwned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chainCount = piece.chains.length;

  // Tell the parent page how tall we are so /widget.js can size the iframe.
  useEffect(() => {
    const postSize = () => {
      const h = rootRef.current?.offsetHeight ?? document.body.scrollHeight;
      window.parent?.postMessage({ type: "splitstream:resize", piece: piece.id, height: h }, "*");
    };
    postSize();
    const ro = new ResizeObserver(postSize);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [piece.id, owned, error, busy]);

  // Reflect prior access so a returning reader sees "unlocked" without re-paying.
  useEffect(() => {
    if (isApi) return;
    trpc.pieces.access
      .query({ pieceId: piece.id, reader: getReaderId() })
      .then((r) => setOwned(Boolean(r.entitled)))
      .catch(() => {});
  }, [piece.id, isApi]);

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isApi) {
        await trpc.pieces.callApi.mutate({ pieceId: piece.id, payer: "embed-widget" });
        setOwned(true);
      } else {
        await trpc.pieces.sponsoredUnlock.mutate({ pieceId: piece.id, reader: getReaderId() });
        setOwned(true);
      }
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const siteHref = `/piece/${piece.id}`;

  return (
    <div
      ref={rootRef}
      style={{ fontFamily: "var(--font-sans)" }}
      className="rounded-2xl border border-line bg-surface p-4"
    >
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 6, background: "#EE5126" }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: "#fff", transform: "rotate(45deg)" }} />
          </div>
          <span className="font-display text-[13px] font-semibold tracking-tight text-ink">SplitStream</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(14,157,110,0.1)", color: "#0E7A56" }}>
          <span className="live-dot" />Arc L1
        </span>
      </div>

      {/* piece */}
      <a href={siteHref} target="_blank" rel="noreferrer" className="font-display mt-3 block text-[15px] font-semibold leading-snug text-ink hover:text-brand">
        {piece.title}
      </a>

      {/* split bar */}
      <div className="mt-3 flex w-full overflow-hidden rounded-full" style={{ height: 6, background: "#F3EFE8" }}>
        {piece.contributors.map((c, i) => (
          <div key={i} style={{ width: `${c.splitBps / 100}%`, background: CHAIN_TINT[c.targetChain] ?? "#8a8378" }} />
        ))}
      </div>

      {owned ? (
        <div className="mt-3 rounded-xl px-3 py-2.5 text-center text-[13px] font-semibold" style={{ border: "1px solid rgba(14,157,110,0.3)", background: "rgba(14,157,110,0.1)", color: "#0E7A56" }}>
          ✓ {isApi ? "Paid — creators settled" : "Unlocked — creators paid"}
          <a href={siteHref} target="_blank" rel="noreferrer" className="ml-1 underline" style={{ color: "#0E7A56" }}>
            {isApi ? "details" : "read"} →
          </a>
        </div>
      ) : (
        <>
          <button
            onClick={buy}
            disabled={busy}
            className="mt-3 w-full rounded-[11px] px-3.5 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-brandhover disabled:opacity-60"
            style={{ background: "#EE5126" }}
          >
            {busy ? "Paying creators…" : isApi ? `Pay & call · $${piece.price}` : `Unlock for $${piece.price}`}
          </button>
          <div className="mt-2 text-center text-[10.5px] text-faint">
            Splits to {piece.contributors.length} creator{piece.contributors.length === 1 ? "" : "s"} on {chainCount} chain{chainCount === 1 ? "" : "s"} · no wallet needed
          </div>
        </>
      )}

      {error ? <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{error}</div> : null}
    </div>
  );
}
