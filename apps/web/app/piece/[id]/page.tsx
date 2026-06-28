/** Shareable single-piece page — the link a publisher drops in a tweet or DM so
 *  any reader can unlock one piece and pay its creators. Public, no API key. */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc, errorInfo, getReaderId } from "../../../lib/trpc";
import {
  LiveChip,
  Logo,
  PieceCard,
  PieceDetail,
  RestorePurchases,
  type Piece,
} from "../../../components/storefront";

export default function PiecePage() {
  const params = useParams<{ id: string }>();
  const pieceId = params.id;
  const [piece, setPiece] = useState<Piece | null>(null);
  const [related, setRelated] = useState<Piece[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [p, all, stats] = await Promise.all([
        trpc.pieces.get.query({ pieceId }),
        trpc.pieces.list.query(),
        trpc.traction.stats.query().catch(() => null),
      ]);
      setPiece(p);
      setRelated(all.filter((x) => x.id !== pieceId).slice(0, 3));
      setLive(stats?.liveAgent ?? false);
      setError(null);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setLoading(false);
    }
  }, [pieceId]);

  useEffect(() => {
    refresh();
    trpc.traction.visit.mutate({ visitorId: getReaderId() }).catch(() => {});
  }, [refresh]);

  return (
    <div className="min-h-screen">
      {/* ── nav ── */}
      <nav className="sticky top-0 z-20 border-b border-line backdrop-blur" style={{ background: "rgba(250,248,244,0.85)" }}>
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-[18px] sm:px-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-[18px]">
            <Link href="/"><Logo /></Link>
            <span className="hidden sm:inline-flex"><LiveChip /></span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/#catalog" className="hidden px-3 py-2 text-[13.5px] text-muted hover:text-ink sm:inline">Catalog</Link>
            <Link href="/docs" className="hidden px-3 py-2 text-[13.5px] text-muted hover:text-ink sm:inline">Docs</Link>
            <Link href="/library" className="rounded-[10px] border border-line3 px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-chip">My purchases</Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1280px] px-5 pb-12 sm:px-10">
        {/* breadcrumb */}
        <div className="py-3.5 text-[12.5px] text-faint">
          <Link href="/#catalog" className="text-muted hover:text-ink">Catalog</Link>
          <span className="mx-2">/</span>
          <span className="text-ink3">{piece ? piece.kind : "…"}</span>
          {piece ? <><span className="mx-2">/</span><span>{piece.title}</span></> : null}
        </div>

        {loading ? (
          <div className="py-8 text-sm text-muted">Loading…</div>
        ) : error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : !piece ? (
          <div className="card p-6 text-sm text-muted">No such piece.</div>
        ) : (
          <div className="space-y-10 pt-2 pb-6">
            <PieceDetail piece={piece} onUnlocked={refresh} live={live} />
            <RestorePurchases onRestored={refresh} />

            {related.length > 0 ? (
              <section>
                <h2 className="font-display mb-[18px] text-xl font-semibold tracking-[-0.01em] text-ink">More from the catalog</h2>
                <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
                  {related.map((p) => (
                    <PieceCard key={p.id} piece={p} detailHref={`/piece/${p.id}`} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
