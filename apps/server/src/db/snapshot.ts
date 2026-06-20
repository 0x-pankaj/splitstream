/**
 * Snapshot codec — shared by every durability backend (bun:sqlite locally on a
 * Railway volume, and Cloudflare D1 for managed off-box persistence). It encodes
 * the mutable slices of the in-memory store to a single JSON blob and restores
 * them, so the backends only have to move that one string in and out.
 *
 * bigint is tagged so it round-trips through JSON without precision loss.
 */

import type { AgentWallet, AuditEntry, Piece } from "@arcane/shared";
import type { ApiKey, OnchainSettlement, RecipientRecord, Store, Tenant } from "./store.js";

/** JSON.stringify replacer that encodes bigint as a tagged string. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { $b: value.toString() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "$b" in (value as Record<string, unknown>)) {
    return BigInt((value as { $b: string }).$b);
  }
  return value;
}

/** ApiKey with scopes flattened to an array (Set is not JSON-serializable). */
interface SerializedApiKey {
  key: string;
  tenantId: string;
  label: string;
  scopes: string[];
}

export interface Snapshot {
  audit: AuditEntry[];
  agents: AgentWallet[];
  balances: Array<[string, bigint]>;
  tenants?: Tenant[];
  apiKeys?: SerializedApiKey[];
  dailyLimits?: Array<[string, bigint]>;
  recipients?: Array<[string, RecipientRecord[]]>;
  /** SplitStream pieces (with accumulated traction) and reader entitlements. */
  pieces?: Piece[];
  entitlements?: string[];
  /** Distinct buyers across all pay flows (unique-buyers traction count). */
  buyers?: string[];
  /** Real on-chain settlements (verifiable Arc traction). */
  onchainSettlements?: OnchainSettlement[];
}

/** Encode the durable slices of the store as a JSON blob. */
export function buildSnapshotJson(store: Store): string {
  const snap: Snapshot = {
    audit: store.audit,
    agents: [...store.agentWallets.values()],
    balances: [...store.tenantBalances6.entries()],
    tenants: [...store.tenants.values()],
    apiKeys: [...store.apiKeys.values()].map((k) => ({
      key: k.key,
      tenantId: k.tenantId,
      label: k.label,
      scopes: [...k.scopes],
    })),
    dailyLimits: [...store.dailyVolumeLimit6.entries()],
    recipients: [...store.recipients.entries()].map(
      ([tid, byKey]) => [tid, [...byKey.values()]] as [string, RecipientRecord[]],
    ),
    pieces: [...store.pieces.values()],
    entitlements: [...store.entitlements],
    buyers: [...store.buyers],
    onchainSettlements: store.onchainSettlements,
  };
  return JSON.stringify(snap, replacer);
}

/** Restore the store from a snapshot JSON blob (best-effort, additive). */
export function restoreFromJson(store: Store, json: string): void {
  const snap = JSON.parse(json, reviver) as Snapshot;
  store.audit = snap.audit ?? store.audit;
  for (const a of snap.agents ?? []) store.upsertAgent(a);
  for (const [tid, bal] of snap.balances ?? []) store.tenantBalances6.set(tid, bal);
  for (const t of snap.tenants ?? []) store.upsertTenant(t);
  for (const k of snap.apiKeys ?? []) store.addApiKey({ ...k, scopes: new Set(k.scopes) });
  for (const [tid, lim] of snap.dailyLimits ?? []) store.setDailyLimit(tid, lim);
  for (const [tid, recs] of snap.recipients ?? []) for (const r of recs) store.addRecipient(tid, r);
  for (const p of snap.pieces ?? []) store.pieces.set(p.id, p);
  for (const e of snap.entitlements ?? []) store.entitlements.add(e);
  for (const b of snap.buyers ?? []) store.buyers.add(b);
  if (snap.onchainSettlements) store.onchainSettlements = snap.onchainSettlements;
}
