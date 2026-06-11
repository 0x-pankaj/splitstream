/**
 * Shared plumbing for the cross-chain settlement rails (Gateway, CCTP, StableFX).
 *
 * Each rail has two execution modes:
 *   - "live": calls Circle's App Kit SDK against Arc Testnet. Used when a kit key
 *     is configured AND the call succeeds (real Gateway/CCTP/Swap).
 *   - "simulated": deterministic, dependency-free settlement that always works,
 *     so the engine is demoable without funded hot wallets on four external
 *     chains. Receipts are clearly labelled with the mode so the CFO audit log
 *     and the grant reviewers can tell real settlements from simulated ones.
 *
 * App Kit is loaded via dynamic import so a missing/optional package never
 * breaks the build or a simulated run.
 */

import { keccak256, toHex } from "viem";
import type { TargetChain } from "@arcane/shared";
import { config } from "../config.js";

export type RailMode = "live" | "simulated";

export interface SettlementReceipt {
  rail: "gateway" | "cctp";
  destinationChain: TargetChain;
  recipient: string;
  amount6: bigint;
  /** Tx hash on the destination chain (real in live mode, derived in sim). */
  destinationTxHash: string;
  /** Source-chain (Arc) tx hash — the CCTP burn — when applicable. */
  sourceTxHash?: string;
  /** Observed (live) or representative (sim) end-to-end latency, ms. */
  latencyMs: number;
  mode: RailMode;
}

/** Deterministic, collision-resistant pseudo tx hash for simulated settlements. */
export function simTxHash(...parts: (string | bigint)[]): string {
  return keccak256(toHex(parts.map(String).join("|")));
}

let _appKit: unknown | null | undefined;

/**
 * Best-effort dynamic load of Circle App Kit. Returns null if the package is not
 * installed or a kit key is not configured. Typed as unknown — rail modules
 * narrow it where they use it.
 */
export async function loadAppKit(): Promise<unknown | null> {
  if (_appKit !== undefined) return _appKit;
  if (!config.circleKitKey) {
    _appKit = null;
    return null;
  }
  try {
    // Optional dependency, loaded by a non-literal specifier so the build does
    // not require the package to be present. Present only when installed.
    const specifier = "@circle-fin/app-kit";
    _appKit = await import(/* @vite-ignore */ specifier);
  } catch {
    _appKit = null;
  }
  return _appKit;
}

/** Whether live rails are even possible in this process. */
export function liveRailsPossible(): boolean {
  return Boolean(config.circleKitKey);
}
