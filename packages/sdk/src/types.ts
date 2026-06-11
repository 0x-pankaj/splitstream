/** Public types for the Arcane Treasury SDK. Mirror the REST API responses. */

export type TargetChain = "solana" | "base" | "arbitrum" | "ethereum";
export type CurrencyCode = "USD" | "EUR";
export type RoutePath = "instant" | "whale";

export interface ArcaneClientOptions {
  /** A scoped API key (`arc_live_sk_…` / `arc_test_sk_…`). */
  apiKey: string;
  /** API base URL. Defaults to `http://localhost:8787`. */
  baseUrl?: string;
  /** Override the fetch implementation (e.g. in tests or older runtimes). */
  fetch?: typeof fetch;
  /**
   * Tenant id this key belongs to. Optional — the SDK resolves and caches it
   * from `GET /tenants/me` on first payout if omitted.
   */
  tenantId?: string;
}

export interface SignupOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  name: string;
  /** The Arc L1 wallet the tenant will fund the vault from. */
  onchainAddress: string;
}

export interface Account {
  tenantId: string;
  name: string;
  onchainAddress: string;
  /** Present only on signup — the one-time API key. */
  apiKey?: string;
  scopes: string[];
  vaultAddress?: string | null;
  usdcAddress?: string;
  limitTxHash?: string | null;
}

export interface Recipient {
  recipientKey: string;
  address: string;
  targetChain: TargetChain;
  label?: string;
  addedAt: string;
}

export interface RecipientInput {
  address: string;
  targetChain: TargetChain;
  label?: string;
}

export interface DepositInfo {
  onchainEnabled: boolean;
  vaultAddress: string | null;
  usdcAddress: string;
  tenantAddress: string;
  /** Human USDC string, e.g. "1234.56". */
  balance: string;
  instructions?: string[];
}

export interface PayoutItem {
  recipientAddress: string;
  targetChain: TargetChain;
  /** Human USDC string with ≤ 6 decimals, e.g. "250" or "1000.50". */
  amountUSDC: string;
  currencyCode?: CurrencyCode;
}

export interface PayoutResult {
  payoutId: string;
  intentId: string;
  recipientAddress: string;
  targetChain: TargetChain;
  currencyCode: CurrencyCode;
  amount6: string;
  payoutAmount: string;
  payoutCurrency: "USDC" | "EURC";
  path: RoutePath;
  status: "settled";
  destinationTxHash: string;
  arcTxHash: string;
  settlementMode: "live" | "simulated";
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

export interface CreatePayoutOptions {
  payouts: PayoutItem[];
  /** Idempotency key so a retried batch is never paid twice (≥ 8 chars). */
  idempotencyKey?: string;
  /** Optional scoped agent wallet authorizing the batch. */
  agentId?: string;
  /** Override the resolved tenant id (rarely needed). */
  tenantId?: string;
}
