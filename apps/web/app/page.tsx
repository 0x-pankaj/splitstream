/** SplitStream storefront — browse pieces, unlock one for a few cents, and watch
 *  the payment split instantly across every contributor's chain. Public: no API
 *  key, no signup. This is the traction surface. */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { trpc, errorInfo } from "../lib/trpc";
import { AgentReader, OnchainTraction, PieceCard, RestorePurchases, TractionHero, type Piece, type Traction } from "../components/storefront";

export default function Storefront() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [stats, setStats] = useState<Traction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        trpc.pieces.list.query(),
        trpc.traction.stats.query(),
      ]);
      setPieces(p);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold tracking-tight text-slate-100">SplitStream</span>
            <span className="badge" style={{ background: "rgba(16,185,129,0.14)", color: "#34d399" }}>
              on Arc L1
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Pay a few cents to unlock a single piece. The payment splits instantly across every
            contributor — each paid on their own chain, in under 500ms. No subscription, no signup.
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-2">
          <Link href="/library" className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-center text-xs text-slate-300 hover:bg-slate-700/40 sm:flex-none">
            My purchases
          </Link>
          <Link href="/docs" className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-center text-xs text-slate-300 hover:bg-slate-700/40 sm:flex-none">
            Docs
          </Link>
          <Link href="/publish" className="flex-1 rounded-lg bg-indigo-500/90 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-indigo-400 sm:flex-none">
            + Publish
          </Link>
          <Link href="/dashboard" className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-center text-xs text-slate-300 hover:bg-slate-700/40 sm:flex-none">
            Console →
          </Link>
        </nav>
      </header>

      <TractionHero stats={stats} />

      <div className="mt-6">
        <OnchainTraction stats={stats} />
      </div>

      <div className="mt-6">
        <AgentReader onRun={refresh} />
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} — is the API running on :8787?
        </div>
      ) : null}

      <div className="mt-6">
        <RestorePurchases onRestored={refresh} />
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-300">Catalog</h2>
        {loading ? (
          <div className="text-sm text-slate-400">Loading pieces…</div>
        ) : pieces.length === 0 ? (
          <div className="card p-6 text-sm text-slate-400">
            No pieces yet. Publishers can register content from the console.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {pieces.map((piece) => (
              <PieceCard key={piece.id} piece={piece} onUnlocked={refresh} live={stats?.liveAgent ?? false} detailHref={`/piece/${piece.id}`} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-slate-800 pt-6 text-xs text-slate-500">
        SplitStream · per-piece creator monetization with instant cross-chain revenue splitting ·
        Circle Arc L1 · Gateway · CCTP
      </footer>
    </main>
  );
}
