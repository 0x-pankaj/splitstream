/**
 * The hybrid payout orchestrator — ties the whole engine together.
 *
 * Pipeline for POST /api/v1/payouts/bulk:
 *   1. plan      — parse amounts, derive intent ids + recipient keys, route by
 *                  size (instant vs whale), price fees
 *   2. authorize — if an agent wallet initiated the batch, enforce its velocity
 *                  policy atomically
 *   3. comply    — recipient allowlist + rolling 24h velocity (mirrors / eth_call)
 *   4. fund      — ensure the tenant's vault balance covers the batch
 *   5. fx        — lock USDC→EURC quotes for EUR recipients (StableFX / Swap)
 *   6. settle    — instant via the Gateway-backed solver mesh; whale via CCTP V2
 *   7. record    — reimburse solvers on Arc L1 (executeIntent), append audit log
 */

import {
  computeFees,
  deriveIntentId,
  deriveRecipientKey,
  planPayout,
  totalDebit6,
  errors,
  type AuditEntry,
  type BulkPayoutInput,
  type PayoutItem,
  type RoutePath,
  type RoutedPayout,
} from "@arcane/shared";
import { config } from "../config.js";
import type { Store, Tenant } from "../db/store.js";
import { precheckBatch, recordSettledVolume } from "./compliance.js";
import { readTenantBalance6, executeIntentOnArc, platformTreasurySolver } from "./vault.js";
import { settleThroughMesh } from "./solverMesh.js";
import { settleWhale } from "./cctp.js";
import { lockUsdcToEurcQuote } from "./stablefx.js";
import { authorizeAgentBatch } from "./agentTreasury.js";

export interface PayoutResult {
  payoutId: string;
  intentId: `0x${string}`;
  recipientAddress: string;
  targetChain: PayoutItem["targetChain"];
  currencyCode: PayoutItem["currencyCode"];
  amount6: string;
  payoutAmount: string;
  payoutCurrency: "USDC" | "EURC";
  path: RoutePath;
  status: "settled";
  destinationTxHash: string;
  arcTxHash: string;
  settlementMode: "live" | "simulated";
  /** End-to-end settlement latency in ms (burn→mint for CCTP, intent→fill for instant). */
  latencyMs: number;
  solverId: string | null;
  fxRate6: string | null;
}

export interface BulkPayoutResult {
  batchId: string;
  tenantId: string;
  accepted: number;
  totalDebited6: string;
  instantCount: number;
  whaleCount: number;
  results: PayoutResult[];
}

let batchCounter = 0;

/** Deterministic-ish batch id that does not rely on Math.random at import time. */
function nextBatchId(idempotencyKey: string | undefined, now: number): string {
  if (idempotencyKey) return idempotencyKey;
  batchCounter += 1;
  return `batch-${now.toString(36)}-${batchCounter}`;
}

export async function processBulkPayout(
  store: Store,
  tenant: Tenant,
  input: BulkPayoutInput,
  now = Date.now(),
): Promise<BulkPayoutResult> {
  const batchId = nextBatchId(input.idempotencyKey, now);

  // 1) Plan every item.
  const planned: RoutedPayout[] = input.payouts.map((item, i): RoutedPayout => {
    const { amount6, path, fees } = planPayout({
      item,
      threshold6: config.instantThreshold6,
      policy: config.feePolicy,
    });
    const nonce = `${batchId}:${i}`;
    return {
      ...item,
      payoutId: `${batchId}:${i}`,
      intentId: deriveIntentId({
        tenantId: tenant.id,
        recipientAddress: item.recipientAddress,
        targetChain: item.targetChain,
        amount6,
        nonce,
      }),
      amount6,
      path,
      fees,
      fxRate6: null,
    };
  });

  // 2) Agent velocity policy (if an agent initiated the batch).
  if (input.agentId) {
    authorizeAgentBatch(
      store,
      input.agentId,
      planned.map((p) => p.amount6),
      now,
    );
  }

  // 3) Compliance: recipient allowlist + rolling velocity.
  const recipientKeys = planned.map((p) => deriveRecipientKey(p.recipientAddress));
  await precheckBatch(
    store,
    tenant,
    planned.map((p, i) => ({ recipientKey: recipientKeys[i]!, amount6: p.amount6 })),
    now,
  );

  // 4) Funding: the tenant must cover gross + fees for the whole batch.
  const totalDebit = planned.reduce((sum, p) => sum + totalDebit6(p.fees), 0n);
  const balance = await readTenantBalance6(store, tenant);
  if (totalDebit > balance) {
    throw errors.insufficientBalance({
      needed6: totalDebit.toString(),
      available6: balance.toString(),
    });
  }

  // 5–7) Settle each payout and record it.
  const results: PayoutResult[] = [];
  let instantCount = 0;
  let whaleCount = 0;

  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]!;
    const recipientKey = recipientKeys[i]!;

    // FX leg for EUR recipients.
    let fxRate6: bigint | null = null;
    let payoutAmount6 = p.amount6;
    let payoutCurrency: "USDC" | "EURC" = "USDC";
    if (p.currencyCode === "EUR") {
      const quote = await lockUsdcToEurcQuote(p.amount6);
      fxRate6 = quote.rate6;
      payoutAmount6 = quote.amountOut6;
      payoutCurrency = "EURC";
    }

    let destinationTxHash: string;
    let arcTxHash: string;
    let settlementMode: "live" | "simulated";
    let latencyMs: number;
    let solverId: string | null = null;

    if (p.path === "instant") {
      instantCount += 1;
      const mesh = await settleThroughMesh(store, {
        intentId: p.intentId,
        recipient: p.recipientAddress,
        destinationChain: p.targetChain,
        amount6: p.amount6,
      });
      destinationTxHash = mesh.receipt.destinationTxHash;
      settlementMode = mesh.receipt.mode;
      latencyMs = mesh.receipt.latencyMs;
      solverId = mesh.solver.id;

      // Reimburse the solver on Arc L1 (real executeIntent when configured).
      const exec = await executeIntentOnArc(store, {
        intentId: p.intentId,
        tenant,
        recipientKey,
        destinationSolver: mesh.solver.arcAddress,
        fees: p.fees,
      });
      arcTxHash = exec.arcTxHash;
    } else {
      whaleCount += 1;
      const receipt = await settleWhale({
        intentId: p.intentId,
        recipient: p.recipientAddress,
        destinationChain: p.targetChain,
        amount6: p.amount6,
      });
      destinationTxHash = receipt.destinationTxHash;
      settlementMode = receipt.mode;
      latencyMs = receipt.latencyMs;
      // The whale rail settles via a real CCTP burn on Arc (sourceTxHash) → mint
      // on the destination (destinationTxHash); the platform relayer fronts that
      // burn from its own USDC. We then debit the tenant on Arc via executeIntent
      // — reimbursing the relayer as the treasury "solver" — so the on-chain
      // vault balance stays authoritative for both rails (matches the instant
      // path). In mirror mode this is the equivalent ledger debit.
      const exec = await executeIntentOnArc(store, {
        intentId: p.intentId,
        tenant,
        recipientKey,
        destinationSolver: platformTreasurySolver(),
        fees: p.fees,
      });
      // Surface the cross-chain CCTP burn as the Arc tx when we have it; fall
      // back to the executeIntent/ledger reference otherwise.
      arcTxHash = receipt.sourceTxHash ?? exec.arcTxHash;
    }

    // Record velocity + audit.
    recordSettledVolume(store, tenant.id, p.amount6, now);

    const entry: AuditEntry = {
      id: p.intentId,
      tenantId: tenant.id,
      payoutId: p.payoutId,
      intentId: p.intentId,
      recipientAddress: p.recipientAddress,
      targetChain: p.targetChain,
      currencyCode: p.currencyCode,
      amount6: p.amount6,
      grossAmount6: p.fees.grossAmount6,
      networkFee6: p.fees.networkFee6,
      convenienceFee6: p.fees.convenienceFee6,
      path: p.path,
      status: "settled",
      destinationTxHash,
      arcTxHash,
      settlementMode,
      latencyMs,
      createdAt: new Date(now + i).toISOString(),
    };
    store.appendAudit(entry);
    store.intents.set(p.intentId, { ...p, status: "settled" });

    results.push({
      payoutId: p.payoutId,
      intentId: p.intentId,
      recipientAddress: p.recipientAddress,
      targetChain: p.targetChain,
      currencyCode: p.currencyCode,
      amount6: p.amount6.toString(),
      payoutAmount: payoutAmount6.toString(),
      payoutCurrency,
      path: p.path,
      status: "settled",
      destinationTxHash,
      arcTxHash,
      settlementMode,
      latencyMs,
      solverId,
      fxRate6: fxRate6 === null ? null : fxRate6.toString(),
    });
  }

  return {
    batchId,
    tenantId: tenant.id,
    accepted: results.length,
    totalDebited6: totalDebit.toString(),
    instantCount,
    whaleCount,
    results,
  };
}
