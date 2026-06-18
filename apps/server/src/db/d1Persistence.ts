/**
 * Cloudflare D1 durability backend — managed, off-box persistence that survives
 * even if the Railway service/volume is destroyed, and works across instances.
 *
 * Same shape as the sqlite backend: one row in a `snapshot` table holds the JSON
 * blob produced by buildSnapshotJson. We talk to D1 over its HTTP query API, so
 * no native binding or Worker is needed — just three env vars:
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
 * When any is missing, the caller falls back to the local sqlite/volume backend.
 *
 * Defensive throughout: any D1 error logs and the server keeps running in-memory.
 */

import type { Store } from "./store.js";
import { buildSnapshotJson, restoreFromJson } from "./snapshot.js";

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

/** Read D1 credentials from the environment, or null if not fully configured. */
export function d1ConfigFromEnv(): D1Config | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

/** Run one SQL statement against D1's HTTP query API. Throws on any failure. */
async function d1Query(cfg: D1Config, sql: string, params: unknown[] = []): Promise<unknown[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = (await res.json().catch(() => null)) as
    | { success: boolean; result?: Array<{ results?: unknown[] }>; errors?: Array<{ message: string }> }
    | null;
  if (!res.ok || !body?.success) {
    const msg = body?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`D1 query failed: ${msg}`);
  }
  return body.result?.[0]?.results ?? [];
}

/**
 * Initialize D1 persistence: ensure the table exists, hydrate the store from any
 * existing snapshot, and return an async `save()` the server calls on interval
 * and shutdown. Returns null if D1 is unreachable (caller falls back to sqlite).
 */
export async function initD1Persistence(store: Store, cfg: D1Config): Promise<(() => Promise<void>) | null> {
  try {
    await d1Query(cfg, "CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");

    const rows = (await d1Query(cfg, "SELECT json FROM snapshot WHERE id = 1")) as Array<{ json?: string }>;
    const json = rows[0]?.json;
    if (json) {
      restoreFromJson(store, json);
      console.log(
        `[persistence] restored ${store.audit.length} audit entries, ${store.tenants.size} tenants from Cloudflare D1`,
      );
    } else {
      console.log("[persistence] Cloudflare D1 connected (empty snapshot — fresh start)");
    }
  } catch (err) {
    console.warn("[persistence] D1 unavailable — falling back to local sqlite:", err);
    return null;
  }

  let saving = false;
  return async () => {
    if (saving) return; // never overlap a slow HTTP save with the next tick
    saving = true;
    try {
      const json = buildSnapshotJson(store);
      await d1Query(cfg, "INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)", [json]);
    } catch (err) {
      console.warn("[persistence] D1 save failed:", err);
    } finally {
      saving = false;
    }
  };
}
