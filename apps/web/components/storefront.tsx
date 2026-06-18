/** Storefront building blocks for SplitStream — piece cards, the cross-chain
 *  fan-out reveal, and the live traction hero. Kept presentational so both the
 *  home grid and the shareable /piece/[id] page reuse them. */

"use client";

import { useEffect, useState } from "react";
import { formatUsdc6 } from "@arcane/shared";
import { trpc, errorInfo, getReaderId } from "../lib/trpc";
import { ChainBadge, PathBadge, Pill, TxLink } from "./ui";

export type Piece = Awaited<ReturnType<typeof trpc.pieces.list.query>>[number];
export type Unlock = Awaited<ReturnType<typeof trpc.pieces.unlock.mutate>>;
export type Traction = Awaited<ReturnType<typeof trpc.traction.stats.query>>;
export type ReadingSession = Awaited<ReturnType<typeof trpc.agent.read.mutate>>;
export type ServiceCall = Awaited<ReturnType<typeof trpc.pieces.callApi.mutate>>;
export type LivePay = Awaited<ReturnType<typeof trpc.pieces.payLive.mutate>>;

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

/** True when a content payload is a URL we should render as a link/media. */
function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** The content the reader just paid to unlock, revealed only post-payment. */
function ContentReveal({ content }: { content: string }) {
  const url = isUrl(content);
  const isImage = url && /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(content.trim());
  return (
    <div className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/[0.07] p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
        🔓 Your unlocked content
      </div>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={content.trim()} alt="unlocked content" className="max-h-96 w-full rounded-lg object-contain" />
      ) : url ? (
        <a href={content.trim()} target="_blank" rel="noreferrer"
          className="mono break-all text-sm text-indigo-300 underline decoration-dotted hover:text-indigo-200">
          {content.trim()} ↗
        </a>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{content}</div>
      )}
    </div>
  );
}

/** Short tx-hash → Arc explorer link. */
function ExplorerTx({ explorer, hash, label }: { explorer: string; hash: string; label?: string }) {
  if (!hash) return <span className="text-slate-500">—</span>;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer"
      className="mono text-indigo-300 underline decoration-dotted hover:text-indigo-200">
      {label ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`} ↗
    </a>
  );
}

/**
 * The judge magnet: REAL USDC settlements on Arc, with clickable on-chain proof.
 * Everything here is verifiable on the Arc explorer — nothing simulated.
 */
export function OnchainTraction({ stats }: { stats: Traction | null }) {
  if (!stats) return null;
  const recent = stats.recentOnchain ?? [];
  return (
    <div className="card border-emerald-500/25 p-6" style={{ background: "rgba(16,185,129,0.05)" }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            ⚡ Real USDC settled on Arc · verifiable on-chain
          </span>
          <Pill text={stats.liveAgent ? "LIVE relayer funded" : "live mode"} tone="emerald" />
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-emerald-300">${stats.onchainCreatorPaid}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            real to creators · {stats.onchainPayoutCount} on-chain payouts
          </div>
        </div>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-400">
          No on-chain settlements yet. Hit <span className="text-emerald-300">⚡ Agent pays REAL USDC</span> on a
          piece below (or pay the live x402 endpoint from an agent) to put a verifiable tx here.
        </p>
      ) : (
        <div className="space-y-2">
          {recent.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-200">{s.title} · <span className="text-slate-400">${s.priceUSDC}</span></span>
                <span className="flex items-center gap-2 text-slate-400">
                  paid <ExplorerTx explorer={stats.explorer} hash={s.paymentTx} /> →
                  {s.payouts.map((p, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <span className="text-slate-300">{p.role}</span>
                      <ExplorerTx explorer={stats.explorer} hash={p.txHash} label={`$${p.shareUSDC}`} />
                    </span>
                  ))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
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
      {unlock.content ? <ContentReveal content={unlock.content} /> : null}
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

const CHAINS = ["base", "arbitrum", "ethereum", "solana"] as const;
const KINDS = ["article", "photo", "song", "podcast", "api"] as const;

interface Row {
  role: string;
  address: string;
  targetChain: (typeof CHAINS)[number];
  percent: string;
}

/** Seller surface: register a content piece OR a paid API (x402) with a split. */
export function PublishForm({ onPublished }: { onPublished?: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("article");
  const [price, setPrice] = useState("0.05");
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header" | "query">("none");
  const [authName, setAuthName] = useState("");
  const [authSecret, setAuthSecret] = useState("");
  const [preview, setPreview] = useState("");
  const [content, setContent] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { role: "creator", address: "", targetChain: "base", percent: "100" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okId, setOkId] = useState<string | null>(null);

  const isApi = kind === "api";
  const percentSum = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const publish = async () => {
    setBusy(true);
    setError(null);
    setOkId(null);
    try {
      const contributors = rows.map((r) => ({
        role: r.role.trim(),
        address: r.address.trim(),
        targetChain: r.targetChain,
        splitBps: Math.round((Number(r.percent) || 0) * 100),
      }));
      const auth =
        isApi && authType !== "none" && authSecret.trim()
          ? {
              type: authType,
              secret: authSecret.trim(),
              ...(authType === "bearer" ? {} : { name: authName.trim() }),
            }
          : undefined;
      const piece = await trpc.pieces.create.mutate({
        title: title.trim(),
        kind,
        priceUSDC: price.trim(),
        contributors,
        ...(isApi
          ? { endpoint: endpoint.trim(), httpMethod: method, ...(auth ? { auth } : {}) }
          : {
              ...(preview.trim() ? { preview: preview.trim() } : {}),
              ...(content.trim() ? { content: content.trim() } : {}),
            }),
      });
      setOkId(piece.id);
      onPublished?.(piece.id);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-300">Publish</h2>
      <p className="mb-4 text-sm text-slate-400">
        List a piece of content (unlocks on payment) or register your own API for AI agents to pay per call.
        Define who gets what % — payment auto-splits across chains.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. My App: weather API"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Price USDC
            <input value={price} onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200" />
          </label>
        </div>
      </div>

      {isApi ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-xs text-slate-400">
            Upstream endpoint (your API)
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.yourapp.com/v1/..."
              className="mono mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200" />
          </label>
          <label className="text-xs text-slate-400">
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
              <option>GET</option><option>POST</option>
            </select>
          </label>
        </div>
      ) : null}

      {!isApi ? (
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-slate-400">
            Preview (free teaser shown in the catalog)
            <input value={preview} onChange={(e) => setPreview(e.target.value)} placeholder="A one-line hook readers see before paying…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200" />
          </label>
          <label className="block text-xs text-slate-400">
            Content (revealed only after payment) — markdown/text, or a URL for a photo/audio file
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4}
              placeholder={"# My article\n\nThe full body readers unlock for the price above…\n\n(or paste an https:// URL to a photo/song)"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200" />
          </label>
        </div>
      ) : null}

      {isApi ? (
        <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
          <div className="mb-2 text-xs text-slate-400">
            Upstream auth — your API key is stored server-side and injected per call.
            <span className="text-slate-500"> The paying agent never sees it (access without KYC).</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)}
              className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
              <option value="none">no auth</option>
              <option value="bearer">Bearer token</option>
              <option value="header">custom header</option>
              <option value="query">query param</option>
            </select>
            <input value={authName} onChange={(e) => setAuthName(e.target.value)}
              placeholder={authType === "query" ? "param name (e.g. apikey)" : authType === "header" ? "header (e.g. X-API-Key)" : "—"}
              disabled={authType === "none" || authType === "bearer"}
              className="mono rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-40" />
            <input value={authSecret} onChange={(e) => setAuthSecret(e.target.value)} type="password"
              placeholder="secret / API key" disabled={authType === "none"}
              className="mono rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-40" />
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-400">Revenue split</span>
          <span className={`text-xs ${percentSum === 100 ? "text-emerald-300" : "text-amber-300"}`}>sum {percentSum}%</span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.6fr_1fr_auto_auto] items-center gap-2">
              <input value={r.role} onChange={(e) => setRow(i, { role: e.target.value })} placeholder="role"
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200" />
              <input value={r.address} onChange={(e) => setRow(i, { address: e.target.value })} placeholder="payout address"
                className="mono rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200" />
              <select value={r.targetChain} onChange={(e) => setRow(i, { targetChain: e.target.value as Row["targetChain"] })}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
                {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} placeholder="%"
                className="w-16 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200" />
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}
                className="rounded-lg border border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700/40 disabled:opacity-40">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setRows((rs) => [...rs, { role: "", address: "", targetChain: "base", percent: "0" }])}
          className="mt-2 text-xs text-indigo-300 hover:text-indigo-200">+ add contributor</button>
      </div>

      <button onClick={publish} disabled={busy || percentSum !== 100 || !title}
        className="mt-4 rounded-xl bg-indigo-500/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50">
        {busy ? "Publishing…" : isApi ? "Register API" : "Publish piece"}
      </button>

      {error ? <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      {okId ? (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Published! Live at <code className="mono">/piece/{okId}</code> and in the catalog.
        </div>
      ) : null}
    </div>
  );
}

/** The agentic demo: an AI reading-agent that autonomously unlocks & pays creators. */
export function AgentReader({ onRun }: { onRun?: () => void }) {
  const [interests, setInterests] = useState("Arc, stablecoin, USDC");
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<ReadingSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await trpc.agent.read.mutate({
        interests: interests.split(",").map((s) => s.trim()).filter(Boolean),
        maxUnlocks: 5,
        budgetUSDC: "0.50",
      });
      setSession(result);
      onRun?.();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          AI reading agent · auto-pays creators
        </h2>
        {session ? <Pill text={session.mode === "llm" ? "AI decided" : "heuristic"} tone={session.mode === "llm" ? "emerald" : "slate"} /> : null}
      </div>
      <p className="mb-3 text-sm text-slate-400">
        An autonomous agent reads the catalog, decides what's worth unlocking within a $0.50 budget,
        and pays each creator per piece — splitting across chains. No human in the loop.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="interests, comma-separated"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
        />
        <button
          onClick={run}
          disabled={running}
          className="rounded-xl bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {running ? "Agent reading…" : "Let the agent read & pay"}
        </button>
      </div>

      {error ? <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}

      {session ? (
        <div className="mt-4">
          <div className="mb-2 text-sm text-slate-300">
            Unlocked <span className="font-semibold text-emerald-300">{session.unlocked}</span> pieces ·
            paid <span className="font-semibold text-emerald-300">${session.spentUSDC}</span> to creators ·
            considered {session.considered}
          </div>
          <div className="space-y-1.5">
            {session.decisions.map((d) => (
              <div key={d.pieceId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-900/30 px-3 py-2 text-xs">
                <span className="text-slate-300">{d.title}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-500">{d.reason}</span>
                  <Pill text={d.unlock ? `paid $${d.priceUSDC}` : "skipped"} tone={d.unlock ? "emerald" : "slate"} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A single piece. Content → "Unlock"; API → "Call" (pay-per-call x402).
 *  When `live` is true a second button settles REAL USDC on Arc. */
export function PieceCard({ piece, onUnlocked, live }: { piece: Piece; onUnlocked?: () => void; live?: boolean }) {
  const isApi = piece.kind === "api";
  const [busy, setBusy] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [call, setCall] = useState<ServiceCall | null>(null);
  const [livePay, setLivePay] = useState<LivePay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Content this browser already paid for — fetched on load so a refresh / return
  // visit keeps access without paying again ("pay once, keep reading").
  const [owned, setOwned] = useState<string | null>(null);

  useEffect(() => {
    if (isApi || !piece.hasContent) return;
    let cancelled = false;
    trpc.pieces.access
      .query({ pieceId: piece.id, reader: getReaderId() })
      .then((r) => {
        if (!cancelled && r.entitled && r.content) setOwned(r.content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [piece.id, piece.hasContent, isApi]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isApi) {
        const result = await trpc.pieces.callApi.mutate({ pieceId: piece.id, payer: "web-agent" });
        setCall(result);
      } else {
        const result = await trpc.pieces.unlock.mutate({ pieceId: piece.id, payer: getReaderId() });
        setUnlock(result);
        if (result.content) setOwned(result.content);
      }
      onUnlocked?.();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const runLive = async () => {
    setLiveBusy(true);
    setError(null);
    try {
      const result = await trpc.pieces.payLive.mutate({ pieceId: piece.id });
      setLivePay(result);
      onUnlocked?.();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setLiveBusy(false);
    }
  };

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-1.5">
            <Pill text={isApi ? "paid API" : piece.kind} tone={isApi ? "amber" : "slate"} />
            {isApi && piece.authenticated ? <Pill text={`🔒 ${piece.authType}`} tone="emerald" /> : null}
          </span>
          <h3 className="mt-2 text-lg font-semibold leading-snug text-slate-100">{piece.title}</h3>
          {isApi && piece.endpoint ? (
            <div className="mono mt-1 truncate text-[11px] text-slate-500">{piece.httpMethod ?? "GET"} {piece.endpoint}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-slate-100">${piece.price}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">{isApi ? "per call" : "per unlock"}</div>
        </div>
      </div>

      {!isApi && piece.preview ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          {piece.preview}
          {piece.hasContent ? <span className="ml-1 text-slate-500">🔒 unlocks on payment</span> : null}
        </p>
      ) : null}

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
        <span>{piece.unlocks} {isApi ? "calls" : "unlocks"} · ${piece.totalPaid} to {isApi ? "owner" : "creators"}</span>
        <span>{piece.chains.length} chain{piece.chains.length === 1 ? "" : "s"}</span>
      </div>

      {!isApi && owned && !unlock ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300">
          ✓ You own this — unlocked (no charge)
        </div>
      ) : (
        <button
          onClick={run}
          disabled={busy}
          className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
            isApi ? "bg-amber-400/90 text-slate-900 hover:bg-amber-300" : "bg-emerald-500/90 text-slate-900 hover:bg-emerald-400"
          }`}
        >
          {busy ? (isApi ? "Paying & calling…" : "Splitting across chains…") : isApi ? `Pay & call · $${piece.price}` : `Unlock for $${piece.price}`}
        </button>
      )}

      {live ? (
        <button
          onClick={runLive}
          disabled={liveBusy}
          className="mt-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
        >
          {liveBusy ? "Agent paying real USDC on Arc…" : `⚡ Agent pays REAL USDC on Arc · $${piece.price}`}
        </button>
      ) : null}

      {error ? <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
      {unlock ? <FanOut unlock={unlock} /> : owned ? <ContentReveal content={owned} /> : null}
      {livePay ? (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
          <div className="mb-2 text-sm font-semibold text-emerald-300">✅ Real settlement on Arc Testnet</div>
          <div className="space-y-1 text-xs text-slate-300">
            <div>
              agent paid ${livePay.priceUSDC} ·{" "}
              <a className="mono text-indigo-300 underline decoration-dotted hover:text-indigo-200" target="_blank" rel="noreferrer" href={`${livePay.explorer}/tx/${livePay.paymentTx}`}>
                payment tx ↗
              </a>
            </div>
            {livePay.payouts.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span>→ {p.role} ({p.address.slice(0, 6)}…):</span>
                {p.status === "paid" && p.txHash ? (
                  <a className="mono text-indigo-300 underline decoration-dotted hover:text-indigo-200" target="_blank" rel="noreferrer" href={`${livePay.explorer}/tx/${p.txHash}`}>
                    paid ${(Number(p.share6) / 1e6).toFixed(2)} ↗
                  </a>
                ) : (
                  <span className="text-slate-500">skipped ({p.reason ?? "non-EVM"})</span>
                )}
              </div>
            ))}
            {livePay.upstream ? (
              <div className="mt-2 truncate text-slate-400">upstream {livePay.upstream.status}: {JSON.stringify(livePay.upstream.body).slice(0, 80)}</div>
            ) : null}
          </div>
        </div>
      ) : null}
      {call ? (
        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-amber-300">
              Paid ${call.unlock.price6 ? (Number(call.unlock.price6) / 1e6).toFixed(2) : piece.price} · owner paid on {call.unlock.chains.join(", ")}
            </span>
            <Pill text={call.upstream.ok ? `200 OK` : `error`} tone={call.upstream.ok ? "emerald" : "slate"} />
          </div>
          <pre className="mono max-h-48 overflow-auto rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-[11px] text-slate-300">
{JSON.stringify(call.upstream.body ?? call.upstream.error, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
