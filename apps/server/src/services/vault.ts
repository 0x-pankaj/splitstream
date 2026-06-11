/**
 * Arc L1 vault settlement. When a relayer key + vault address are configured,
 * this submits the REAL `executeIntent` transaction to ArcaneTreasuryVault on
 * Arc Testnet, reimbursing the solver and recording the intent on-chain. When
 * not configured it performs the equivalent ledger move in the in-memory store
 * so the full pipeline still completes and the audit log is populated.
 */

import type { FeeBreakdown } from "@arcane/shared";
import { totalDebit6 } from "@arcane/shared";
import { config } from "../config.js";
import { publicClient, walletClient, relayerAccount, hasRelayer } from "../chain/arc.js";
import { vaultAbi } from "../chain/abis.js";
import type { Store, Tenant } from "../db/store.js";
import { arcTestnet } from "@arcane/shared";

export interface ExecuteIntentInput {
  intentId: `0x${string}`;
  tenant: Tenant;
  recipientKey: `0x${string}`;
  destinationSolver: `0x${string}`;
  fees: FeeBreakdown;
}

export interface ExecuteIntentResult {
  arcTxHash: string;
  onchain: boolean;
}

/**
 * Reimburse the solver on Arc L1 and record the intent. Returns the Arc tx hash
 * (real on-chain hash, or a deterministic ledger reference in mirror mode).
 */
export async function executeIntentOnArc(
  store: Store,
  input: ExecuteIntentInput,
): Promise<ExecuteIntentResult> {
  const total = totalDebit6(input.fees);

  if (config.onchainEnabled && hasRelayer() && config.vaultAddress) {
    const hash = await walletClient!.writeContract({
      account: relayerAccount!,
      chain: arcTestnet,
      address: config.vaultAddress,
      abi: vaultAbi,
      functionName: "executeIntent",
      args: [
        input.intentId,
        input.tenant.onchainAddress,
        input.recipientKey,
        input.destinationSolver,
        input.fees.grossAmount6,
        input.fees.networkFee6,
        input.fees.convenienceFee6,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { arcTxHash: hash, onchain: true };
  }

  // Mirror mode: debit the tenant ledger exactly as the contract would.
  store.debitBalance(input.tenant.id, total);
  return { arcTxHash: input.intentId, onchain: false };
}

/**
 * The Arc address reimbursed for fronting a settlement. For the whale/CCTP rail
 * the platform relayer itself fronts the burn, so it is reimbursed as the
 * "solver"; it is the vault-whitelisted relayer in live mode. In mirror mode the
 * value is unused (executeIntentOnArc only debits the ledger).
 */
export function platformTreasurySolver(): `0x${string}` {
  return relayerAccount?.address ?? "0x0000000000000000000000000000000000000000";
}

/** Read a tenant's vault balance (on-chain when configured, else mirror). */
export async function readTenantBalance6(store: Store, tenant: Tenant): Promise<bigint> {
  if (config.onchainEnabled && config.vaultAddress) {
    return publicClient.readContract({
      address: config.vaultAddress,
      abi: vaultAbi,
      functionName: "tenantBalances",
      args: [tenant.onchainAddress],
    });
  }
  return store.balanceOf(tenant.id);
}
