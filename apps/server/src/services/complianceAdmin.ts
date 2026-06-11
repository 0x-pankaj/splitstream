/**
 * On-chain compliance administration — owner-key writes to ArcaneComplianceGuard.
 *
 * These are the KYB/admin operations a tenant triggers indirectly: when a
 * company signs up we set its rolling 24h limit on-chain, and when it vets a
 * payee we whitelist that recipient key on-chain. The guard's `enforce` (called
 * atomically inside the vault's executeIntent) then lets the tenant's payouts
 * through. All writes are signed by the platform relayer, which is the guard's
 * owner on Arc Testnet.
 *
 * Every function is a no-op (returns null) unless live on-chain mode is active
 * AND a compliance-guard address is configured — so the off-chain mirror always
 * works standalone and the test suite never touches the chain.
 */

import { arcTestnet } from "@arcane/shared";
import { config } from "../config.js";
import { complianceGuardAbi } from "../chain/abis.js";
import { hasRelayer, publicClient, relayerAccount, walletClient } from "../chain/arc.js";

function liveGuard(): boolean {
  return Boolean(config.onchainEnabled && hasRelayer() && config.complianceGuardAddress);
}

/** Configure a tenant's on-chain rolling 24h volume limit. */
export async function setTenantLimitOnchain(
  tenantAddress: `0x${string}`,
  limit6: bigint,
): Promise<string | null> {
  if (!liveGuard()) return null;
  const hash = await walletClient!.writeContract({
    account: relayerAccount!,
    chain: arcTestnet,
    address: config.complianceGuardAddress!,
    abi: complianceGuardAbi,
    functionName: "setDailyVolumeLimit",
    args: [tenantAddress, limit6],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Whitelist (or revoke) a recipient key for a tenant on-chain. */
export async function setRecipientWhitelistedOnchain(
  tenantAddress: `0x${string}`,
  recipientKey: `0x${string}`,
  allowed: boolean,
): Promise<string | null> {
  if (!liveGuard()) return null;
  const hash = await walletClient!.writeContract({
    account: relayerAccount!,
    chain: arcTestnet,
    address: config.complianceGuardAddress!,
    abi: complianceGuardAbi,
    functionName: "setRecipientWhitelisted",
    args: [tenantAddress, recipientKey, allowed],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
