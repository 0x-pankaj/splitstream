/**
 * Shared domain types for Arcane Treasury, used across the backend engine,
 * the MCP server, and the CFO dashboard.
 */

/** Destination chains a platform can pay out to. */
export type TargetChain = "solana" | "base" | "arbitrum" | "ethereum";

/** Settlement currency requested by the platform for a given recipient. */
export type CurrencyCode = "USD" | "EUR";

/** Which rail the hybrid router selected for a payout. */
export type RoutePath = "instant" | "whale";

/** Lifecycle of a single payout as it moves through the engine. */
export type PayoutStatus =
  | "received" // validated, persisted, awaiting compliance
  | "compliance_passed"
  | "compliance_rejected"
  | "fx_converted" // USD->EUR leg done (EUR recipients only)
  | "routing" // assigned to a rail
  | "settling" // funds moving on the destination chain
  | "settled" // recipient received funds on target chain
  | "reimbursed" // solver reimbursed on Arc L1 (instant path only)
  | "failed";

/** A single recipient line item within a bulk payout request. */
export interface PayoutItem {
  recipientAddress: string;
  targetChain: TargetChain;
  /** Requested amount as a human string, e.g. "250.00". */
  amountUSDC: string;
  currencyCode: CurrencyCode;
}

/** Fee breakdown for a payout, all in 6-decimal USDC base units. */
export interface FeeBreakdown {
  /** Amount the recipient actually receives. */
  grossAmount6: bigint;
  /** Reserved to fund autonomous relayer/gas operations. */
  networkFee6: bigint;
  /** SaaS protocol fee credited to the platform fee wallet. */
  convenienceFee6: bigint;
}

/** A payout after routing + fee assessment, ready for settlement. */
export interface RoutedPayout extends PayoutItem {
  payoutId: string;
  /** Deterministic on-chain intent id (bytes32 hex). */
  intentId: `0x${string}`;
  amount6: bigint;
  path: RoutePath;
  fees: FeeBreakdown;
  /** EUR recipients: locked USDC->EURC rate (6dp EURC per 1 USDC), else null. */
  fxRate6: bigint | null;
}

/** A simulated institutional market maker on the instant path. */
export interface Solver {
  id: string;
  label: string;
  /** Address reimbursed on Arc L1 via executeIntent (must be vault-whitelisted). */
  arcAddress: `0x${string}`;
  /** Chains this solver keeps hot-wallet reserves on. */
  supportedChains: TargetChain[];
  /** Available hot-wallet reserves per chain, 6dp USDC base units. */
  reserves6: Record<TargetChain, bigint>;
  online: boolean;
}

/** An immutable audit-log entry — the CFO's single-currency ledger. */
export interface AuditEntry {
  id: string;
  tenantId: string;
  payoutId: string;
  intentId: `0x${string}`;
  recipientAddress: string;
  targetChain: TargetChain;
  currencyCode: CurrencyCode;
  amount6: bigint;
  grossAmount6: bigint;
  networkFee6: bigint;
  convenienceFee6: bigint;
  path: RoutePath;
  status: PayoutStatus;
  /** Settlement tx hash on the destination chain (instant path). */
  destinationTxHash: string | null;
  /** executeIntent / CCTP burn tx hash on Arc L1. */
  arcTxHash: string | null;
  /** Whether settlement ran on real Arc Testnet / Circle rails or simulated. */
  settlementMode: "live" | "simulated";
  /**
   * End-to-end settlement latency in ms. For the whale path this is the CCTP
   * burn→mint time observed by the engine; for the instant path it is the
   * intent→fill time. Representative (not live-observed) for simulated rails.
   */
  latencyMs: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** Velocity policy for a scoped, autonomous agent wallet (6dp USDC caps). */
export interface AgentPolicy {
  perTransaction6: bigint;
  daily6: bigint;
  weekly6: bigint;
  monthly6: bigint;
}

/** Rolling spend accumulators for an agent wallet (6dp USDC). */
export interface AgentSpend {
  daily6: bigint;
  weekly6: bigint;
  monthly6: bigint;
}

/** A scoped agent wallet that can autonomously authorize payouts within caps. */
export interface AgentWallet {
  agentId: string;
  tenantId: string;
  label: string;
  policy: AgentPolicy;
  spend: AgentSpend;
  enabled: boolean;
  createdAt: string;
}
