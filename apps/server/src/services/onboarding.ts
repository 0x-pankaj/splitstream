/**
 * Self-serve onboarding — the front door to the platform.
 *
 * A company signs up with a name and the Arc wallet it will fund the vault from.
 * We create a tenant, set a default rolling 24h limit (off-chain mirror + on the
 * on-chain ComplianceGuard in live mode), and issue a scoped API key. The key is
 * returned exactly once — the caller is responsible for surfacing it to the user.
 */

import { parseUsdc6, type SignupInput } from "@arcane/shared";
import { config } from "../config.js";
import type { ApiKey, Store, Tenant } from "../db/store.js";
import { setTenantLimitOnchain } from "./complianceAdmin.js";

/** Default rolling 24h velocity cap for a new tenant ($500k). */
export const DEFAULT_DAILY_LIMIT_6 = parseUsdc6("500000");

/** Scopes granted to a tenant's primary key. */
export const PRIMARY_KEY_SCOPES = ["payouts:write", "treasury:read", "agents:manage"];

export interface SignupResult {
  tenant: Tenant;
  apiKey: ApiKey;
  /** On-chain tx that set the tenant's compliance limit (null in mirror mode). */
  limitTxHash: string | null;
}

/** Provision a new corporate treasury account. */
export async function signupTenant(
  store: Store,
  input: SignupInput,
): Promise<SignupResult> {
  const tenant = store.createTenant({
    name: input.name,
    onchainAddress: input.onchainAddress as `0x${string}`,
  });

  store.setDailyLimit(tenant.id, DEFAULT_DAILY_LIMIT_6);
  const apiKey = store.issueApiKey(
    tenant.id,
    "Primary key",
    PRIMARY_KEY_SCOPES,
    config.onchainEnabled,
  );

  const limitTxHash = await setTenantLimitOnchain(
    tenant.onchainAddress,
    DEFAULT_DAILY_LIMIT_6,
  );

  return { tenant, apiKey, limitTxHash };
}
