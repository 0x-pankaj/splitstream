/** Storefront building blocks for SplitStream — piece cards, the cross-chain
 *  fan-out reveal, and the live traction hero. Kept presentational so both the
 *  home grid and the shareable /piece/[id] page reuse them. */

"use client";

import { useState } from "react";
import { formatUsdc6 } from "@arcane/shared";
import { trpc, errorInfo } from "../lib/trpc";
import { ChainBadge, PathBadge, Pill, TxLink } from "./ui";

export type Piece = Awaited<ReturnType<typeof trpc.pieces.list.query>>[number];
export type Unlock = Awaited<ReturnType<typeof trpc.pieces.unlock.mutate>>;
export type Traction = Awaited<ReturnType<typeof trpc.traction.stats.query>>;

/** Format a 6dp base-unit string ("30000") as a USD display string ("$0.03"). */
export function usd(base6: string): string {
  return `$${formatUsdc6(BigInt(base6))}`;
}

const CHAIN_TINT: Record<string, string> = {
  base: "#3b82f6",
  arbitrum: "#22d3ee",
  ethereum: "#a5b4fc",
  solana: "#34d399",
};

/** A stacked bar visualizing how a piece's price splits across contributors. */
function SplitBar({ contributors }: { contributors: Piece["contributors"] }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full border border-slate-700">
      {contributors.map((c, i) => (
        <div
          key={i}
          title={`${c.role} · ${c.targetChain} · ${(c.splitBps / 100).toFixed(0)}%`}
          style={{
            width: `${c.splitBps / 100}%`,
            background: CHAIN_TINT[c.targetChain] ?? "#64748b",
          }}
        />
      ))}
    </div>
  );
}

/** The headline: total creator payouts + unlocks across the whole platform. */
export function TractionHero({ stats }: { stats: Traction | null }) {
  const cells = [
    { label: "Creators paid", value: stats ? stats.totalCreatorPaid : "—", accent: "#34d399", prefix: "$" },
    { label: "Unlocks", value: stats ? String(stats.totalUnlocks) : "—", accent: "#a5b4fc", prefix: "" },
    { label: "Contributors", value: stats ? String(stats.contributorCount) : "—", accent: "#fbbf24", prefix: "" },
    { label: "Chains", value: stats ? String(stats.chainCount) : "—", accent: "#22d3ee", prefix: "" },
  ];
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-400">Live traction · paid out to creators</div>
        {stats ? <Pill text={stats.onchainMode === "live" ? "LIVE Arc" : "simulated"} tone={stats.onchainMode === "live" ? "emerald" : "slate"} /> : null}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-3xl font-semibold tabular-nums" style={{ color: c.accent }}>
              {c.prefix}
              {c.value}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The post-unlock reveal: every contributor that just got paid, on their chain. */
export function FanOut({ unlock }: { unlock: Unlock }) {
  return (
    <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-emerald-300">
          Unlocked · {usd(unlock.price6)} split across {unlock.contributorCount} creators on {unlock.chains.length} chains
        </div>
        <Pill text={`${unlock.batch.instantCount} instant`} tone="emerald" />
      </div>
      <div className="space-y-2">
        {unlock.contributors.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-200">{c.role}</span>
              <ChainBadge chain={c.targetChain} />
              <span className="mono text-xs text-slate-500">{c.recipientAddress.slice(0, 6)}…{c.recipientAddress.slice(-4)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-sm font-semibold text-emerald-300">{usd(c.share6)}</span>
              <span className="text-[11px] text-slate-400">{c.settlement.latencyMs}ms</span>
              <PathBadge path={c.settlement.path} />
              <TxLink hash={c.settlement.destinationTxHash} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single piece with its split preview and an Unlock button + fan-out reveal. */
export function PieceCard({ piece, onUnlocked }: { piece: Piece; onUnlocked?: () => void }) {
  const [unlocking, setUnlocking] = useState(false);
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doUnlock = async () => {
    setUnlocking(true);
    setError(null);
    try {
      const result = await trpc.pieces.unlock.mutate({ pieceId: piece.id, payer: "web-reader" });
      setUnlock(result);
      onUnlocked?.();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill text={piece.kind} tone="slate" />
          <h3 className="mt-2 text-lg font-semibold leading-snug text-slate-100">{piece.title}</h3>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-slate-100">${piece.price}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">per unlock</div>
        </div>
      </div>

      <div className="mt-4">
        <SplitBar contributors={piece.contributors} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {piece.contributors.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-slate-300">{c.role}</span>
              <span className="text-slate-500">· {c.targetChain} · {(c.splitBps / 100).toFixed(0)}%</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>{piece.unlocks} unlocks · ${piece.totalPaid} to creators</span>
        <span>{piece.chains.length} chains</span>
      </div>

      <button
        onClick={doUnlock}
        disabled={unlocking}
        className="mt-4 rounded-xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {unlocking ? "Splitting across chains…" : `Unlock for $${piece.price}`}
      </button>

      {error ? <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      {unlock ? <FanOut unlock={unlock} /> : null}
    </div>
  );
}
