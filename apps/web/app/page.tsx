/** SplitStream storefront — browse pieces, unlock one for a few cents, and watch
 *  the payment split instantly across every contributor's chain. Public: no API
 *  key, no signup. This is the traction surface. */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { trpc, errorInfo, getReaderId } from "../lib/trpc";
import {
  AgentReader,
  CreatorLeaderboard,
  LiveChip,
  Logo,
  OnchainTraction,
  PieceCard,
  RestorePurchases,
  TractionHero,
  type Piece,
  type Traction,
} from "../components/storefront";

const CHAIN_DOTS = [
  { label: "Base", color: "#2563EB" },
  { label: "Arbitrum", color: "#0E7490" },
  { label: "Ethereum", color: "#6366F1" },
  { label: "Solana", color: "#059669" },
];

export default function Storefront() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [stats, setStats] = useState<Traction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([trpc.pieces.list.query(), trpc.traction.stats.query()]);
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
    trpc.traction.visit.mutate({ visitorId: getReaderId() }).catch(() => {});
    const t = window.setInterval(refresh, 8000);
    return () => window.clearInterval(t);
  }, [refresh]);


  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* ── nav ── */}
      <nav className="sticky top-0 z-20 border-b border-line backdrop-blur" style={{ background: "rgba(250,248,244,0.85)" }}>
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-[18px] sm:px-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-[18px]">
            <Logo />
            <span className="hidden sm:inline-flex"><LiveChip /></span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="#catalog" className="hidden px-3 py-2 text-[13.5px] text-muted hover:text-ink md:inline">Catalog</Link>
            <Link href="/docs" className="hidden px-3 py-2 text-[13.5px] text-muted hover:text-ink md:inline">Docs</Link>
            <Link href="/library" className="hidden px-3 py-2 text-[13.5px] text-muted hover:text-ink md:inline">My purchases</Link>
            <Link href="/dashboard" className="hidden rounded-[10px] border border-line3 px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-chip sm:inline-block">Console →</Link>
            <Link href="/publish" className="rounded-[10px] px-3.5 py-[9px] text-[13px] font-semibold text-white transition hover:bg-brandhover" style={{ background: "#EE5126" }}>+ Publish</Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1280px] px-5 pb-12 sm:px-10">
        {stats?.relayer?.ready && stats.relayer.low ? (
          <div className="mt-6 rounded-xl px-4 py-2.5 text-xs" style={{ border: "1px solid rgba(238,81,38,0.3)", background: "rgba(238,81,38,0.08)", color: "#C2410C" }}>
            ⚠️ Live settlement relayer is low (${stats.relayer.balanceUSDC} USDC). Top up at{" "}
            <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a>{" "}
            (Arc Testnet) to keep real payouts flowing.
          </div>
        ) : null}

        {/* ── hero ── */}
        <section className="grid grid-cols-1 gap-10 pt-12 pb-9 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-[22px] inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted">
              <span className="mono text-brand">x402</span> pay-per-piece · cross-chain split
            </div>
            <h1 className="font-display text-[38px] font-semibold leading-[1.06] tracking-[-0.025em] text-ink sm:text-[46px]">
              Pay a few cents.<br />Every creator gets paid <span className="text-brand">instantly.</span>
            </h1>
            <p className="mt-5 max-w-[30em] text-base leading-[1.6] text-muted">
              Unlock a single article, photo, song, or API call. The payment fans out to every contributor — each
              settled on their own chain in real USDC, under 500ms. No subscription. No signup.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#catalog" className="rounded-xl px-[22px] py-[13px] text-sm font-semibold text-white transition hover:bg-brandhover" style={{ background: "#EE5126" }}>
                Browse the catalog
              </a>
              <a href="#agent" className="rounded-xl border border-line3 bg-surface px-[22px] py-[13px] text-sm font-medium text-ink transition hover:bg-chip">
                Let an agent read &amp; pay
              </a>
            </div>
            <div className="mt-[30px] flex flex-wrap gap-x-[26px] gap-y-2">
              {CHAIN_DOTS.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-[13px] text-muted2">
                  <span className="rounded-full" style={{ width: 7, height: 7, background: c.color }} />
                  {c.label}
                </div>
              ))}
            </div>
          </div>
          <TractionHero stats={stats} />
        </section>

        {/* ── two-column proof ── */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CreatorLeaderboard stats={stats} />
          <OnchainTraction stats={stats} />
        </section>

        {/* ── agent panel ── */}
        <section id="agent" className="mt-5 scroll-mt-24">
          <AgentReader onRun={refresh} />
        </section>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error} — is the API running on :8787?
          </div>
        ) : null}

        <div className="mt-6">
          <RestorePurchases onRestored={refresh} />
        </div>

        {/* ── catalog ── */}
        <section id="catalog" className="mt-[34px] scroll-mt-24">
          <div className="mb-[18px] flex items-baseline justify-between">
            <h2 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Catalog</h2>
            <span className="text-[13px] text-faint">
              {pieces.length} piece{pieces.length === 1 ? "" : "s"} · pay once, keep access
            </span>
          </div>
          {loading ? (
            <div className="text-sm text-muted">Loading pieces…</div>
          ) : pieces.length === 0 ? (
            <div className="card p-6 text-sm text-muted">No pieces yet. Publishers can register content from the console.</div>
          ) : (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
              {pieces.map((piece) => (
                <PieceCard key={piece.id} piece={piece} detailHref={`/piece/${piece.id}`} />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 flex flex-wrap justify-between gap-2 border-t border-line pt-6 text-xs text-faint">
          <span>SplitStream · per-piece monetization with instant cross-chain splits</span>
          <span className="mono">Circle Arc L1 · Gateway · CCTP</span>
        </footer>
      </main>
    </div>
  );
}
