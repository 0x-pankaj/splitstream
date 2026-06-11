/**
 * Payee (recipient) management — a tenant vets the addresses it is allowed to
 * pay. Compliance requires every payout recipient to be on this allowlist, so
 * this is a prerequisite for a tenant's first payout.
 *
 * Each add/remove updates both the off-chain mirror (used by the pre-flight
 * eth_call / standalone mode) and, in live mode, the on-chain ComplianceGuard
 * (whose `enforce` gates the vault's executeIntent).
 */

import { deriveRecipientKey, type RecipientInput } from "@arcane/shared";
import type { RecipientRecord, Store, Tenant } from "../db/store.js";
import {
  setRecipientWhitelistedOnchain,
} from "./complianceAdmin.js";

export interface RecipientMutation {
  record: RecipientRecord;
  /** On-chain tx that updated the allowlist (null in mirror mode). */
  onchainTxHash: string | null;
}

/** Vet and allowlist a payee for a tenant. */
export async function addTenantRecipient(
  store: Store,
  tenant: Tenant,
  input: RecipientInput,
): Promise<RecipientMutation> {
  const recipientKey = deriveRecipientKey(input.address);
  const record = store.addRecipient(tenant.id, {
    recipientKey,
    address: input.address,
    targetChain: input.targetChain,
    label: input.label,
  });
  const onchainTxHash = await setRecipientWhitelistedOnchain(
    tenant.onchainAddress,
    recipientKey,
    true,
  );
  return { record, onchainTxHash };
}

export interface RecipientRemoval {
  removed: boolean;
  onchainTxHash: string | null;
}

/** Revoke a payee from a tenant's allowlist. */
export async function removeTenantRecipient(
  store: Store,
  tenant: Tenant,
  recipientKey: `0x${string}`,
): Promise<RecipientRemoval> {
  const removed = store.removeRecipient(tenant.id, recipientKey);
  // Mirror the revocation on-chain even if the local record was already gone, so
  // the two views can never drift into "allowed on-chain but not off-chain".
  const onchainTxHash = await setRecipientWhitelistedOnchain(
    tenant.onchainAddress,
    recipientKey,
    false,
  );
  return { removed, onchainTxHash };
}
