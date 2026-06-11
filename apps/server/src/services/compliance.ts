/**
 * Compliance pre-flight. Mirrors ArcaneComplianceGuard: recipient allowlist +
 * rolling 24h velocity. When a guard address is configured it performs the real
 * on-chain `precheck` via eth_call; otherwise it uses the in-memory mirror so
 * the engine runs standalone.
 */

import { errors } from "@arcane/shared";
import { config } from "../config.js";
import { publicClient } from "../chain/arc.js";
import { complianceGuardAbi } from "../chain/abis.js";
import type { Store, Tenant } from "../db/store.js";

export interface ComplianceCheck {
  recipientKey: `0x${string}`;
  amount6: bigint;
}

/**
 * Verify every payout in a batch against recipient allowlist + the tenant's
 * rolling velocity cap. The aggregate batch volume is checked so a batch that
 * individually passes but collectively breaches the cap is rejected. Throws an
 * ArcaneError on the first breach; returns silently on success.
 */
export async function precheckBatch(
  store: Store,
  tenant: Tenant,
  checks: ComplianceCheck[],
  now = Date.now(),
): Promise<void> {
  // 1) Recipient allowlist — per item.
  for (const c of checks) {
    const allowed = await isRecipientAllowed(store, tenant, c.recipientKey);
    if (!allowed) {
      throw errors.recipientNotWhitelisted(c.recipientKey);
    }
  }

  // 2) Rolling velocity — aggregate batch volume on top of the current window.
  const batchVolume = checks.reduce((sum, c) => sum + c.amount6, 0n);
  const limit = store.dailyVolumeLimit6.get(tenant.id) ?? 0n;
  if (limit === 0n) {
    throw errors.velocityExceeded({ reason: "tenant velocity limit not configured" });
  }
  const current = store.currentVolume6(tenant.id, now);
  if (current + batchVolume > limit) {
    throw errors.velocityExceeded({
      limit6: limit.toString(),
      currentWindow6: current.toString(),
      batchVolume6: batchVolume.toString(),
    });
  }
}

async function isRecipientAllowed(
  store: Store,
  tenant: Tenant,
  recipientKey: `0x${string}`,
): Promise<boolean> {
  if (config.onchainEnabled && config.complianceGuardAddress) {
    try {
      // precheck reverts on disallowed recipient; a successful read => allowed.
      await publicClient.readContract({
        address: config.complianceGuardAddress,
        abi: complianceGuardAbi,
        functionName: "precheck",
        args: [tenant.onchainAddress, recipientKey, 1n],
      });
      return true;
    } catch {
      // A revert here may be RecipientNotWhitelisted OR (with amount=1) an
      // unrelated velocity edge; fall back to the mirror for a precise answer.
    }
  }
  return store.isRecipientWhitelisted(tenant.id, recipientKey);
}

/** Record settled volume against the rolling window (mirror side). */
export function recordSettledVolume(
  store: Store,
  tenantId: string,
  amount6: bigint,
  now = Date.now(),
): void {
  store.recordVolume6(tenantId, amount6, now);
}
