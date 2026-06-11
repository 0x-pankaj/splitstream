/**
 * Zod validation schemas for the enterprise payout gateway. These are the hard
 * boundary between untrusted platform input and the engine.
 */

import { z } from "zod";

export const TARGET_CHAINS = ["solana", "base", "arbitrum", "ethereum"] as const;
export const CURRENCY_CODES = ["USD", "EUR"] as const;

/** EVM 0x-address (20 bytes) — used for base/arbitrum/ethereum recipients. */
const evmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

/** Base58 Solana address (32–44 chars). */
const solanaAddress = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address");

/** True when `address` is a syntactically valid recipient for `chain`. */
export function isAddressValidForChain(
  address: string,
  chain: (typeof TARGET_CHAINS)[number],
): boolean {
  const schema = chain === "solana" ? solanaAddress : evmAddress;
  return schema.safeParse(address).success;
}

/** A USDC amount string with at most 6 decimal places and a positive value. */
const usdcAmount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Amount must be a number with <= 6 decimal places")
  .refine((v) => Number(v) > 0, "Amount must be greater than zero");

export const PayoutItemSchema = z
  .object({
    recipientAddress: z.string().min(1),
    targetChain: z.enum(TARGET_CHAINS),
    amountUSDC: usdcAmount,
    currencyCode: z.enum(CURRENCY_CODES).default("USD"),
  })
  .superRefine((item, ctx) => {
    // Cross-validate the address format against the selected chain.
    const isSolana = item.targetChain === "solana";
    const result = isSolana
      ? solanaAddress.safeParse(item.recipientAddress)
      : evmAddress.safeParse(item.recipientAddress);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipientAddress"],
        message: `recipientAddress is not valid for chain "${item.targetChain}"`,
      });
    }
  });

/** The exact public bulk-payout contract from the engineering spec. */
export const BulkPayoutSchema = z.object({
  tenantId: z.string().uuid(),
  /** Optional idempotency key so a retried batch is not paid twice. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** Optional scoped agent wallet authorizing this batch (agentic path). */
  agentId: z.string().min(1).optional(),
  payouts: z.array(PayoutItemSchema).min(1).max(10_000),
});

export type BulkPayoutInput = z.infer<typeof BulkPayoutSchema>;

/** Agent wallet policy input (human USDC strings; converted to 6dp internally). */
export const AgentPolicySchema = z.object({
  perTransaction: usdcAmount,
  daily: usdcAmount,
  weekly: usdcAmount,
  monthly: usdcAmount,
});

export const CreateAgentWalletSchema = z.object({
  tenantId: z.string().uuid(),
  label: z.string().min(1).max(120),
  policy: AgentPolicySchema,
});

/** An Arc L1 wallet address (the tenant funds the vault from this address). */
export const arcWalletAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Arc wallet address (expected 0x + 40 hex chars)");

/** Self-serve onboarding: a company opens a corporate treasury account. */
export const SignupSchema = z.object({
  name: z.string().min(2, "Company name is too short").max(120),
  onchainAddress: arcWalletAddress,
});

export type SignupInput = z.infer<typeof SignupSchema>;

/** A payee the tenant vets and adds to its on-chain + off-chain allowlist. */
export const RecipientInputSchema = z
  .object({
    address: z.string().min(1),
    targetChain: z.enum(TARGET_CHAINS),
    label: z.string().max(120).optional(),
  })
  .superRefine((item, ctx) => {
    if (!isAddressValidForChain(item.address, item.targetChain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: `address is not valid for chain "${item.targetChain}"`,
      });
    }
  });

export type RecipientInput = z.infer<typeof RecipientInputSchema>;
