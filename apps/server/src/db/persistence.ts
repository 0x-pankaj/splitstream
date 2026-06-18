/**
 * Best-effort durability via bun:sqlite. Snapshots the mutable slices of the
 * store (audit log, agent wallets, tenant balances) to a single SQLite row so a
 * restart preserves a demo session. Entirely optional and defensive — any
 * failure logs and the server continues in-memory. Only imported by the Bun
 * entrypoint; the Vitest suite never touches SQLite.
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

interface Snapshot {
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
  /** Real on-chain settlements (verifiable Arc traction). */
  onchainSettlements?: OnchainSettlement[];
}

type SqliteDb = {
  run: (sql: string) => void;
  query: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void };
};

export async function initPersistence(store: Store, path: string): Promise<() => void> {
  let db: SqliteDb;
  try {
    const { Database } = (await import("bun:sqlite")) as { Database: new (p: string) => SqliteDb };
    db = new Database(path);
  } catch {
    console.warn("[persistence] bun:sqlite unavailable — running in-memory only");
    return () => {};
  }

  db.run("CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");

  // Hydrate from any existing snapshot.
  try {
    const row = db.query("SELECT json FROM snapshot WHERE id = 1").get() as
      | { json: string }
      | undefined;
    if (row?.json) {
      const snap = JSON.parse(row.json, reviver) as Snapshot;
      store.audit = snap.audit ?? store.audit;
      for (const a of snap.agents ?? []) store.upsertAgent(a);
      for (const [tid, bal] of snap.balances ?? []) store.tenantBalances6.set(tid, bal);
      // Restore self-serve tenants, their keys, limits, and payees.
      for (const t of snap.tenants ?? []) store.upsertTenant(t);
      for (const k of snap.apiKeys ?? [])
        store.addApiKey({ ...k, scopes: new Set(k.scopes) });
      for (const [tid, lim] of snap.dailyLimits ?? []) store.setDailyLimit(tid, lim);
      for (const [tid, recs] of snap.recipients ?? [])
        for (const r of recs) store.addRecipient(tid, r);
      // Restore pieces (preserving accumulated unlocks/payouts) and entitlements
      // so a redeploy keeps published content, the traction counter, and who has
      // already paid. Overwrites the freshly-seeded same-id pieces with their
      // accumulated state.
      for (const p of snap.pieces ?? []) store.pieces.set(p.id, p);
      for (const e of snap.entitlements ?? []) store.entitlements.add(e);
      if (snap.onchainSettlements) store.onchainSettlements = snap.onchainSettlements;
      console.log(
        `[persistence] restored ${store.audit.length} audit entries, ` +
          `${store.tenants.size} tenants from ${path}`,
      );
    }
  } catch (err) {
    console.warn("[persistence] failed to restore snapshot:", err);
  }

  const save = () => {
    try {
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
        onchainSettlements: store.onchainSettlements,
      };
      const json = JSON.stringify(snap, replacer);
      db.query("INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)").run(json);
    } catch (err) {
      console.warn("[persistence] save failed:", err);
    }
  };

  return save;
}
