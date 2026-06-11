/**
 * @arcane/sdk — official TypeScript client for the Arcane Treasury
 * cross-chain payout API ("Stripe for cross-chain payouts" on Circle's Arc L1).
 */

export { ArcaneClient, ArcaneApiError } from "./client.js";
export type {
  Account,
  ArcaneClientOptions,
  BulkPayoutResult,
  CreatePayoutOptions,
  CurrencyCode,
  DepositInfo,
  PayoutItem,
  PayoutResult,
  Recipient,
  RecipientInput,
  RoutePath,
  SignupOptions,
  TargetChain,
} from "./types.js";
