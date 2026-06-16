/**
 * View-model serializers: turn engine domain objects (bigint amounts) into
 * JSON-safe shapes the dashboard consumes. Every monetary field becomes both a
 * 6dp base-unit string and a human USD/EUR display string.
 */

import {
  formatUsdc6,
  type AgentWallet,
  type AuditEntry,
  type Piece,
  type Solver,
  type TargetChain,
} from "@arcane/shared";

/** Serialize a content piece for the storefront (bigint → display strings). */
export function serializePiece(p: Piece) {
  return {
    id: p.id,
    publisherTenantId: p.publisherTenantId,
    title: p.title,
    kind: p.kind,
    price: formatUsdc6(p.price6),
    contributors: p.contributors,
    chains: [...new Set(p.contributors.map((c) => c.targetChain))],
    endpoint: p.endpoint ?? null,
    httpMethod: p.httpMethod ?? null,
    // Reveal that the API is authenticated and how — but NEVER the secret.
    authenticated: Boolean(p.auth),
    authType: p.auth?.type ?? null,
    createdAt: p.createdAt,
    unlocks: p.unlocks,
    totalPaid: formatUsdc6(p.totalPaid6),
  };
}

export function serializeAudit(e: AuditEntry) {
  return {
    id: e.id,
    payoutId: e.payoutId,
    intentId: e.intentId,
    recipientAddress: e.recipientAddress,
    targetChain: e.targetChain,
    currencyCode: e.currencyCode,
    amount: formatUsdc6(e.amount6),
    grossAmount: formatUsdc6(e.grossAmount6),
    networkFee: formatUsdc6(e.networkFee6),
    convenienceFee: formatUsdc6(e.convenienceFee6),
    path: e.path,
    status: e.status,
    destinationTxHash: e.destinationTxHash,
    arcTxHash: e.arcTxHash,
    settlementMode: e.settlementMode,
    latencyMs: e.latencyMs,
    createdAt: e.createdAt,
  };
}

export function serializeSolver(s: Solver) {
  const chains: TargetChain[] = ["solana", "base", "arbitrum", "ethereum"];
  return {
    id: s.id,
    label: s.label,
    arcAddress: s.arcAddress,
    online: s.online,
    supportedChains: s.supportedChains,
    reserves: chains.map((chain) => ({
      chain,
      available: formatUsdc6(s.reserves6[chain]),
      supported: s.supportedChains.includes(chain),
    })),
  };
}

export function serializeAgent(a: AgentWallet) {
  return {
    agentId: a.agentId,
    tenantId: a.tenantId,
    label: a.label,
    enabled: a.enabled,
    createdAt: a.createdAt,
    policy: {
      perTransaction: formatUsdc6(a.policy.perTransaction6),
      daily: formatUsdc6(a.policy.daily6),
      weekly: formatUsdc6(a.policy.weekly6),
      monthly: formatUsdc6(a.policy.monthly6),
    },
    spend: {
      daily: formatUsdc6(a.spend.daily6),
      weekly: formatUsdc6(a.spend.weekly6),
      monthly: formatUsdc6(a.spend.monthly6),
    },
    remaining: {
      daily: formatUsdc6(a.policy.daily6 - a.spend.daily6),
      weekly: formatUsdc6(a.policy.weekly6 - a.spend.weekly6),
      monthly: formatUsdc6(a.policy.monthly6 - a.spend.monthly6),
    },
  };
}
