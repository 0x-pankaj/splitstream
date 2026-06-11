/** Small presentational building blocks for the CFO console. */

"use client";

import { useState } from "react";
import { ARC_TESTNET } from "@arcane/shared";

/** A monospace value with a one-click copy button (addresses, API keys). */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <div>
      {label ? <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div> : null}
      <div className="mt-1 flex items-center gap-2">
        <code className="mono flex-1 truncate rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
          {value}
        </code>
        <button
          onClick={copy}
          className="shrink-0 rounded-md border border-slate-600 px-2 py-1.5 text-xs hover:bg-slate-700/40"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** A small labeled pill used for status/labels. */
export function Pill({ text, tone = "slate" }: { text: string; tone?: "slate" | "amber" | "emerald" }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    slate: { bg: "rgba(148,163,184,0.14)", fg: "#94a3b8" },
    amber: { bg: "rgba(245,158,11,0.14)", fg: "#fbbf24" },
    emerald: { bg: "rgba(16,185,129,0.14)", fg: "#34d399" },
  };
  const c = tones[tone]!;
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {text}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function PathBadge({ path }: { path: "instant" | "whale" }) {
  const instant = path === "instant";
  return (
    <span
      className="badge"
      style={{
        background: instant ? "rgba(16,185,129,0.14)" : "rgba(245,158,11,0.14)",
        color: instant ? "#34d399" : "#fbbf24",
        border: `1px solid ${instant ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)"}`,
      }}
    >
      {instant ? "⚡ Instant · Gateway" : "🐋 Whale · CCTP"}
    </span>
  );
}

export function ChainBadge({ chain }: { chain: string }) {
  return (
    <span className="badge" style={{ background: "rgba(99,102,241,0.14)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}>
      {chain}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: "live" | "simulated" }) {
  const live = mode === "live";
  return (
    <span
      className="badge"
      style={{
        background: live ? "rgba(16,185,129,0.14)" : "rgba(148,163,184,0.14)",
        color: live ? "#34d399" : "#94a3b8",
        border: `1px solid ${live ? "rgba(16,185,129,0.35)" : "rgba(148,163,184,0.3)"}`,
      }}
    >
      {live ? "LIVE Arc Testnet" : "Simulated"}
    </span>
  );
}

export function TxLink({ hash }: { hash: string | null }) {
  if (!hash) return <span className="text-slate-500">—</span>;
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  return (
    <a
      className="mono text-indigo-300 hover:text-indigo-200 underline decoration-dotted"
      href={`${ARC_TESTNET.explorer}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
    >
      {short}
    </a>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}
