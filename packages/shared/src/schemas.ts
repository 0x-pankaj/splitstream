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

// ── SplitStream: pieces & per-piece payments ────────────────────────────────

export const PIECE_KINDS = ["article", "photo", "song", "podcast", "api"] as const;

/** One contributor line: role, payout address, chain, and basis-point share. */
export const ContributorSchema = z
  .object({
    role: z.string().min(1).max(60),
    address: z.string().min(1),
    targetChain: z.enum(TARGET_CHAINS),
    splitBps: z.number().int().min(1).max(10_000),
  })
  .superRefine((c, ctx) => {
    if (!isAddressValidForChain(c.address, c.targetChain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: `address is not valid for chain "${c.targetChain}"`,
      });
    }
  });

export type ContributorInput = z.infer<typeof ContributorSchema>;

/** An http(s) URL — the upstream endpoint a paid API piece proxies to. */
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "endpoint must be an http(s) URL");

/**
 * A publisher registers a monetizable piece: content (unlocks on payment) or an
 * "api" service (paying proxies one call to its endpoint). Contributor shares
 * must sum to 100%; an "api" piece requires an endpoint.
 */
export const CreatePieceSchema = z
  .object({
    title: z.string().min(1).max(200),
    kind: z.enum(PIECE_KINDS),
    priceUSDC: usdcAmount,
    contributors: z.array(ContributorSchema).min(1).max(20),
    /**
     * Content kinds: a short free teaser shown in the catalog before payment.
     */
    preview: z.string().max(2_000).optional(),
    /**
     * Content kinds: the gated payload (markdown/text, or a URL for media)
     * revealed only in the unlock receipt after payment. Ignored for "api".
     */
    content: z.string().max(50_000).optional(),
    /** Required when kind === "api": the upstream endpoint to proxy on payment. */
    endpoint: httpUrl.optional(),
    httpMethod: z.enum(["GET", "POST"]).default("GET"),
    /**
     * Optional upstream credential for an authenticated API. Stored server-side
     * only, injected on the proxy call, never returned to clients — so a paying
     * agent gets access without ever seeing the key.
     */
    auth: z
      .object({
        type: z.enum(["bearer", "header", "query"]),
        name: z.string().min(1).max(120).optional(),
        secret: z.string().min(1).max(4096),
      })
      .optional()
      .superRefine((a, ctx) => {
        if (a && (a.type === "header" || a.type === "query") && !a.name) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: `auth.name is required for type "${a.type}"`,
          });
        }
      }),
  })
  .superRefine((piece, ctx) => {
    const sum = piece.contributors.reduce((acc, c) => acc + c.splitBps, 0);
    if (sum !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributors"],
        message: `contributor splitBps must sum to 10000 (100%); got ${sum}`,
      });
    }
    if (piece.kind === "api" && !piece.endpoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpoint"],
        message: 'an "api" piece requires an endpoint URL',
      });
    }
  });

export type CreatePieceInput = z.infer<typeof CreatePieceSchema>;

/** A reader (human or agent) unlocks a piece. Body is optional metadata. */
export const PayPieceSchema = z.object({
  /** Optional identifier for the payer (wallet / agent id) — for receipts. */
  payer: z.string().max(128).optional(),
  /** Optional scoped agent wallet authorizing this unlock (agentic path). */
  agentId: z.string().min(1).max(128).optional(),
});

export type PayPieceInput = z.infer<typeof PayPieceSchema>;

/** Pay for one call to an "api" piece. Optional input forwarded to the endpoint. */
export const CallPieceSchema = z.object({
  payer: z.string().max(128).optional(),
  agentId: z.string().min(1).max(128).optional(),
  /** Forwarded to the upstream: as a JSON body for POST, ignored for GET. */
  input: z.record(z.unknown()).optional(),
});

export type CallPieceInput = z.infer<typeof CallPieceSchema>;
