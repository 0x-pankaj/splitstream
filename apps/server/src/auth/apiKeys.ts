/**
 * Scoped, role-based API-key authentication. Keys are verified against the
 * store; each carries a set of scopes (payouts:write, treasury:read,
 * agents:manage) the route layer enforces.
 */

import { errors } from "@arcane/shared";
import type { Store, Tenant, ApiKey } from "../db/store.js";

export interface AuthContext {
  tenant: Tenant;
  apiKey: ApiKey;
}

/** Resolve and authorize an API key, optionally requiring a scope. */
export function authenticate(
  store: Store,
  rawKey: string | undefined | null,
  requiredScope?: string,
): AuthContext {
  if (!rawKey) throw errors.unauthorized();
  const resolved = store.tenantForApiKey(rawKey);
  if (!resolved) throw errors.unauthorized();
  if (requiredScope && !resolved.apiKey.scopes.has(requiredScope)) {
    throw errors.unauthorized(`API key missing required scope: ${requiredScope}`);
  }
  return { tenant: resolved.tenant, apiKey: resolved.apiKey };
}
