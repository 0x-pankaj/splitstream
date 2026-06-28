/**
 * Snapshot codec — shared by every durability backend (bun:sqlite locally on a
 * Railway volume, and Cloudflare D1 for managed off-box persistence). It encodes
 * the mutable slices of the in-memory store to a single JSON blob and restores
 * them, so the backends only have to move that one string in and out.
 *
 * bigint is tagged so it round-trips through JSON without precision loss.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { AgentWallet, AuditEntry, Piece } from "@arcane/shared";
import type {
  ApiKey,
  Creator,
  CreatorSession,
  OnchainSettlement,
  PooledWallet,
  RecipientRecord,
  Store,
  Tenant,
} from "./store.js";

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
  /** Unique visitors + the subset who became REAL on-chain buyers (conversion). */
  visitors?: string[];
  realBuyers?: string[];
  /** Recovery code → reader id (no-wallet library restore). */
  recoveryCodes?: Array<[string, string]>;
  /** Real on-chain settlements (verifiable Arc traction). */
  onchainSettlements?: OnchainSettlement[];
  /** Registered creators (email+OTP) and their assigned payout wallets. */
  creators?: Creator[];
  /** Live creator login sessions (so a login survives a redeploy). */
  creatorSessions?: CreatorSession[];
  /** Unassigned pre-created Circle wallets waiting in the pool. */
  circleWalletPool?: PooledWallet[];
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
    visitors: [...store.visitors],
    realBuyers: [...store.realBuyers],
    recoveryCodes: [...store.recoveryCodes.entries()],
    onchainSettlements: store.onchainSettlements,
    creators: [...store.creators.values()],
    creatorSessions: [...store.creatorSessions.values()],
    circleWalletPool: store.circleWalletPool,
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
  for (const v of snap.visitors ?? []) store.visitors.add(v);
  for (const b of snap.realBuyers ?? []) store.realBuyers.add(b);
  for (const [c, r] of snap.recoveryCodes ?? []) store.recoveryCodes.set(c, r);
  if (snap.onchainSettlements) store.onchainSettlements = snap.onchainSettlements;
  for (const c of snap.creators ?? []) store.upsertCreator(c);
  for (const s of snap.creatorSessions ?? []) store.putCreatorSession(s);
  if (snap.circleWalletPool) store.circleWalletPool = snap.circleWalletPool;
}

// ── At-rest encryption (transparent, backward-compatible) ───────────────────

const ENC_PREFIX = "enc:v1:";

/** 32-byte AES key derived from SNAPSHOT_ENC_KEY, or undefined when unset. */
function encKey(): Buffer | undefined {
  const raw = config.snapshotEncKey;
  return raw ? createHash("sha256").update(raw).digest() : undefined;
}

/**
 * Encode the store snapshot for storage. With SNAPSHOT_ENC_KEY set, the JSON is
 * AES-256-GCM encrypted (so secrets/emails/keys aren't cleartext at rest);
 * otherwise it's plaintext JSON (and stays readable by older deployments).
 */
export function serializeSnapshot(store: Store): string {
  const json = buildSnapshotJson(store);
  const key = encKey();
  if (!key) return json;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decode a stored snapshot blob (encrypted or plaintext) and restore the store. */
export function deserializeSnapshot(store: Store, blob: string): void {
  if (!blob.startsWith(ENC_PREFIX)) {
    restoreFromJson(store, blob);
    return;
  }
  const key = encKey();
  if (!key) throw new Error("snapshot is encrypted but SNAPSHOT_ENC_KEY is not set");
  const buf = Buffer.from(blob.slice(ENC_PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  restoreFromJson(store, json);
}
