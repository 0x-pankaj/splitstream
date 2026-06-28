/** Small presentational building blocks, themed to the SplitStream design system
 *  (warm cream surfaces, orange brand, real-USDC green). */

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
      {label ? <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div> : null}
      <div className="mt-1 flex items-center gap-2">
        <code className="mono flex-1 truncate rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink2">
          {value}
        </code>
        <button
          onClick={copy}
          className="shrink-0 rounded-md border border-line3 px-2 py-1.5 text-xs text-ink hover:bg-chip"
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
    slate: { bg: "#f1ece3", fg: "#6e675c" },
    amber: { bg: "rgba(238,81,38,0.1)", fg: "#c2410c" },
    emerald: { bg: "rgba(14,157,110,0.1)", fg: "#0e7a56" },
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
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
      <div className="font-display mt-2 text-2xl font-semibold tracking-tight" style={accent ? { color: accent } : { color: "#17140f" }}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function PathBadge({ path }: { path: "instant" | "whale" }) {
  const instant = path === "instant";
  return (
    <span
      className="badge"
      style={{
        background: instant ? "rgba(14,157,110,0.1)" : "rgba(238,81,38,0.1)",
        color: instant ? "#0e7a56" : "#c2410c",
        border: `1px solid ${instant ? "rgba(14,157,110,0.25)" : "rgba(238,81,38,0.25)"}`,
      }}
    >
      {instant ? "⚡ Instant · Gateway" : "🐋 Whale · CCTP"}
    </span>
  );
}

const CHAIN_TINT: Record<string, string> = {
  base: "#2563eb",
  arbitrum: "#0e7490",
  ethereum: "#6366f1",
  solana: "#059669",
};

export function ChainBadge({ chain }: { chain: string }) {
  const tint = CHAIN_TINT[chain] ?? "#8a8378";
  return (
    <span className="badge" style={{ background: "#f1ece3", color: "#6e675c" }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tint, display: "inline-block" }} />
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
        background: live ? "rgba(14,157,110,0.1)" : "#f1ece3",
        color: live ? "#0e7a56" : "#6e675c",
        border: `1px solid ${live ? "rgba(14,157,110,0.25)" : "#dad3c7"}`,
      }}
    >
      {live ? "LIVE Arc Testnet" : "Simulated"}
    </span>
  );
}

export function TxLink({ hash }: { hash: string | null }) {
  if (!hash) return <span className="text-faint2">—</span>;
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  return (
    <a
      className="mono underline decoration-dotted hover:opacity-80"
      style={{ color: "#2563eb" }}
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink3">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}
