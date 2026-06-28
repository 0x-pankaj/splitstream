/**
 * Durability dispatcher + the local bun:sqlite backend.
 *
 * `initPersistence` picks a backend: if Cloudflare D1 credentials are present it
 * uses managed D1 (off-box, survives service/volume loss); otherwise it snapshots
 * the store to a single bun:sqlite row on the Railway volume. Both encode the
 * store via the shared snapshot codec. Entirely optional and defensive — any
 * failure logs and the server continues in-memory. The Vitest suite never touches
 * either backend.
 */

import type { Store } from "./store.js";
import { serializeSnapshot, deserializeSnapshot } from "./snapshot.js";
import { d1ConfigFromEnv, initD1Persistence } from "./d1Persistence.js";

type SqliteDb = {
  run: (sql: string) => void;
  query: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void };
};

/** The local bun:sqlite backend (used when D1 is not configured). */
async function initSqlitePersistence(store: Store, path: string): Promise<() => void> {
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
    const row = db.query("SELECT json FROM snapshot WHERE id = 1").get() as { json: string } | undefined;
    if (row?.json) {
      deserializeSnapshot(store, row.json);
      console.log(
        `[persistence] restored ${store.audit.length} audit entries, ` +
          `${store.tenants.size} tenants from ${path}`,
      );
    }
  } catch (err) {
    console.warn("[persistence] failed to restore snapshot:", err);
  }

  return () => {
    try {
      db.query("INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)").run(serializeSnapshot(store));
    } catch (err) {
      console.warn("[persistence] save failed:", err);
    }
  };
}

/**
 * Pick a durability backend and return a `save()` the server calls on interval
 * and shutdown. Prefers Cloudflare D1 when configured; falls back to local
 * sqlite (and to a no-op if neither is available).
 */
export async function initPersistence(store: Store, path: string): Promise<() => void | Promise<void>> {
  const d1 = d1ConfigFromEnv();
  if (d1) {
    const save = await initD1Persistence(store, d1);
    if (save) return save;
    // D1 was configured but unreachable — fall through to local sqlite.
  }
  return initSqlitePersistence(store, path);
}
