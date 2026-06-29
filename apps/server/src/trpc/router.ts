/**
 * tRPC app router consumed by the CFO dashboard. All amounts are returned as
 * display strings (see serialize.ts); inputs accept human USDC strings.
 */

import { z } from "zod";
import {
  BulkPayoutSchema,
  PayoutItemSchema,
  AgentPolicySchema,
  RecipientInputSchema,
  SignupSchema,
  formatUsdc6,
  planPayout,
  totalDebit6,
  type RoutePath,
} from "@arcane/shared";
import { config } from "../config.js";
import {
  router,
  publicProcedure,
  protectedProcedure,
  toTRPCError,
} from "./context.js";
import { serializeAgent, serializeAudit, serializePiece, serializeSolver } from "./serialize.js";
import { readTenantBalance6 } from "../services/vault.js";
import { processBulkPayout } from "../services/payoutEngine.js";
import { createAgentWallet, setAgentEnabled } from "../services/agentTreasury.js";
import { signupTenant } from "../services/onboarding.js";
import { addTenantRecipient, removeTenantRecipient } from "../services/recipients.js";
import { callPaidService, payForPiece, whitelistContributors } from "../services/splitEngine.js";
import { runReadingAgent } from "../services/readingAgent.js";
import { payLiveForPiece, liveAgentReady, sponsoredUnlock, liveRelayerStatus } from "../services/liveAgent.js";
import { walletPaymentInfo, claimWalletPayment, claimWalletCall } from "../services/walletPayment.js";
import { restoreEntitlements } from "../services/walletRestore.js";
import { issueRecoveryCode, redeemRecoveryCode, readerLibrary } from "../services/recovery.js";
import { computeRealTractionMetrics } from "../services/tractionMetrics.js";
import {
  CreatePieceSchema,
  CallPieceSchema,
  ContributorSchema,
  assertBpsSum,
  parseUsdc6,
  ARC_TESTNET,
  CreatorRequestOtpSchema,
  CreatorVerifyOtpSchema,
  CreatorWithdrawSchema,
  CreatorPayoutAddressSchema,
  CreatorPublishSchema,
  type Contributor,
  type PublishContributorInput,
} from "@arcane/shared";
import { requestCreatorOtp, verifyCreatorOtp, authenticateCreator } from "../services/creatorAuth.js";
import { getWalletBalance6, createWithdrawal } from "../services/circleWallets.js";
import { creatorEarnings } from "../services/creatorEarnings.js";
import type { Creator, Store } from "../db/store.js";

/** Arc L1 native USDC system contract (6dp ERC-20 view). */
const ARC_USDC = "0x3600000000000000000000000000000000000000";

const DashboardPayoutSchema = z.object({
  payouts: z.array(PayoutItemSchema).min(1).max(10_000),
  agentId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

/**
 * EVM chain label for a registered creator's Circle wallet. The wallet is an Arc
 * EOA (one address valid across EVM chains) and the live path settles every EVM
 * contributor on Arc — so this is a display label, exactly like the seed creators.
 */
const REGISTERED_CREATOR_CHAIN = "base" as const;

/** The self-view of a creator account (safe to return to the logged-in creator). */
function creatorView(c: Creator) {
  return {
    id: c.id,
    email: c.email,
    handle: c.handle,
    displayName: c.displayName,
    walletAddress: c.walletAddress,
    walletProvider: c.walletProvider,
    /** True when payouts land in a real custodial wallet they can withdraw from. */
    custodialWallet: c.walletProvider === "circle",
    tenantId: c.tenantId,
    createdAt: c.createdAt,
  };
}

/** Resolve publish contributor lines (creatorRef or BYO) to engine Contributors. */
function resolveContributors(store: Store, lines: PublishContributorInput[]): Contributor[] {
  return lines.map((line) => {
    if (line.creatorRef) {
      const ref = line.creatorRef.trim();
      const creator = ref.includes("@") ? store.creatorByEmail(ref) : store.creatorByHandle(ref);
      if (!creator) throw new Error(`No registered creator found for "${ref}"`);
      if (!creator.walletAddress) throw new Error(`Creator "${ref}" has no payout wallet yet`);
      return {
        role: line.role,
        address: creator.walletAddress,
        targetChain: REGISTERED_CREATOR_CHAIN,
        splitBps: line.splitBps,
      };
    }
    return {
      role: line.role,
      address: line.address!,
      targetChain: line.targetChain!,
      splitBps: line.splitBps,
    };
  });
}

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    onchainEnabled: config.onchainEnabled,
    /** True when every payment path settles REAL USDC on Arc (no simulation). */
    allReal: liveAgentReady(),
    liveX402: config.liveX402,
    instantThresholdUsd: formatUsdc6(config.instantThreshold6),
  })),

  me: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.auth!.tenant.id,
    name: ctx.auth!.tenant.name,
    onchainAddress: ctx.auth!.tenant.onchainAddress,
    scopes: [...ctx.auth!.apiKey.scopes],
  })),

  /** Self-serve onboarding — open a corporate treasury account. */
  tenants: router({
    signup: publicProcedure.input(SignupSchema).mutation(async ({ ctx, input }) => {
      try {
        const { tenant, apiKey, limitTxHash } = await signupTenant(ctx.store, input);
        return {
          tenantId: tenant.id,
          name: tenant.name,
          onchainAddress: tenant.onchainAddress,
          apiKey: apiKey.key, // shown exactly once
          scopes: [...apiKey.scopes],
          vaultAddress: config.vaultAddress ?? null,
          usdcAddress: ARC_USDC,
          limitTxHash,
        };
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
  }),

  treasury: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const tenant = ctx.auth!.tenant;
      const balance6 = await readTenantBalance6(ctx.store, tenant);
      const limit6 = ctx.store.dailyVolumeLimit6.get(tenant.id) ?? 0n;
      const used6 = ctx.store.currentVolume6(tenant.id, Date.now());
      const settledCount = ctx.store.auditForTenant(tenant.id).length;
      return {
        balance: formatUsdc6(balance6),
        velocityLimit: formatUsdc6(limit6),
        velocityUsed: formatUsdc6(used6),
        velocityRemaining: formatUsdc6(limit6 - used6),
        settledCount,
        instantThreshold: formatUsdc6(config.instantThreshold6),
        onchainEnabled: config.onchainEnabled,
      };
    }),

    /** How and where to fund the vault, plus the live on-chain balance. */
    depositInfo: protectedProcedure.query(async ({ ctx }) => {
      const tenant = ctx.auth!.tenant;
      const balance6 = await readTenantBalance6(ctx.store, tenant);
      return {
        onchainEnabled: config.onchainEnabled,
        vaultAddress: config.vaultAddress ?? null,
        usdcAddress: ARC_USDC,
        tenantAddress: tenant.onchainAddress,
        balance: formatUsdc6(balance6),
      };
    }),
  }),

  /** Payee allowlist management. */
  recipients: router({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.store.listRecipients(ctx.auth!.tenant.id),
    ),

    add: protectedProcedure
      .input(RecipientInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const { record, onchainTxHash } = await addTenantRecipient(
            ctx.store,
            ctx.auth!.tenant,
            input,
          );
          return { recipient: record, onchainTxHash };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Bulk-vet a list of payees in one call — powers CSV upload and the
     * one-click "whitelist every recipient in this batch" action in the
     * dashboard. Each payee is allowlisted independently and reported per-item
     * so a single bad row never fails the whole upload. `addRecipient` is
     * idempotent, so re-adding an existing payee is a safe no-op.
     */
    addMany: protectedProcedure
      .input(z.object({ recipients: z.array(RecipientInputSchema).min(1).max(1000) }))
      .mutation(async ({ ctx, input }) => {
        const results: Array<{
          address: string;
          ok: boolean;
          recipientKey?: string;
          onchainTxHash?: string | null;
          error?: string;
        }> = [];
        for (const r of input.recipients) {
          try {
            const { record, onchainTxHash } = await addTenantRecipient(
              ctx.store,
              ctx.auth!.tenant,
              r,
            );
            results.push({
              address: r.address,
              ok: true,
              recipientKey: record.recipientKey,
              onchainTxHash,
            });
          } catch (err) {
            results.push({
              address: r.address,
              ok: false,
              error: err instanceof Error ? err.message : "Could not add payee",
            });
          }
        }
        return {
          total: results.length,
          added: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        };
      }),

    remove: protectedProcedure
      .input(z.object({ recipientKey: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const { removed, onchainTxHash } = await removeTenantRecipient(
            ctx.store,
            ctx.auth!.tenant,
            input.recipientKey as `0x${string}`,
          );
          return { removed, onchainTxHash };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),

  audit: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(1000).default(200) }).optional())
      .query(({ ctx, input }) => {
        const limit = input?.limit ?? 200;
        return ctx.store
          .auditForTenant(ctx.auth!.tenant.id)
          .slice(0, limit)
          .map(serializeAudit);
      }),
  }),

  solvers: router({
    list: protectedProcedure.query(({ ctx }) => ctx.store.solvers.map(serializeSolver)),
  }),

  agents: router({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.store.agentsForTenant(ctx.auth!.tenant.id).map(serializeAgent),
    ),

    create: protectedProcedure
      .input(z.object({ agentId: z.string().min(1), label: z.string().min(1), policy: AgentPolicySchema }))
      .mutation(({ ctx, input }) => {
        try {
          const agent = createAgentWallet(ctx.store, {
            agentId: input.agentId,
            tenantId: ctx.auth!.tenant.id,
            label: input.label,
            policy: input.policy,
          });
          return serializeAgent(agent);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    setEnabled: protectedProcedure
      .input(z.object({ agentId: z.string().min(1), enabled: z.boolean() }))
      .mutation(({ ctx, input }) => {
        try {
          return serializeAgent(setAgentEnabled(ctx.store, input.agentId, input.enabled));
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),

  routing: router({
    /** Pure preview: classify each payout into instant/whale and price fees. */
    preview: protectedProcedure
      .input(z.object({ payouts: z.array(PayoutItemSchema).min(1).max(10_000) }))
      .query(({ input }) => {
        let instant = 0;
        let whale = 0;
        let totalGross6 = 0n;
        let totalDebit = 0n;
        const items = input.payouts.map((item) => {
          const { amount6, path, fees } = planPayout({
            item,
            threshold6: config.instantThreshold6,
            policy: config.feePolicy,
          });
          if (path === "instant") instant += 1;
          else whale += 1;
          totalGross6 += amount6;
          totalDebit += totalDebit6(fees);
          return {
            recipientAddress: item.recipientAddress,
            targetChain: item.targetChain,
            currencyCode: item.currencyCode,
            amount: formatUsdc6(amount6),
            path: path as RoutePath,
            convenienceFee: formatUsdc6(fees.convenienceFee6),
            networkFee: formatUsdc6(fees.networkFee6),
          };
        });
        return {
          items,
          summary: {
            count: items.length,
            instant,
            whale,
            totalGross: formatUsdc6(totalGross6),
            totalDebit: formatUsdc6(totalDebit),
          },
        };
      }),
  }),

  payouts: router({
    submit: protectedProcedure
      .input(DashboardPayoutSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const parsed = BulkPayoutSchema.parse({
            tenantId: ctx.auth!.tenant.id,
            payouts: input.payouts,
            agentId: input.agentId,
            idempotencyKey: input.idempotencyKey,
          });
          return await processBulkPayout(ctx.store, ctx.auth!.tenant, parsed);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),

  /**
   * SplitStream creator storefront — all public so a shared link can browse and
   * unlock pieces without an API key. Readers don't authenticate; they pay.
   */
  pieces: router({
    list: publicProcedure.query(({ ctx }) =>
      ctx.store.listPieces().map(serializePiece),
    ),

    get: publicProcedure
      .input(z.object({ pieceId: z.string().min(1) }))
      .query(({ ctx, input }) => {
        const piece = ctx.store.getPiece(input.pieceId);
        return piece ? serializePiece(piece) : null;
      }),

    /**
     * Check whether a reader already owns a piece and, if so, hand back the
     * gated content WITHOUT charging again — "pay once, keep access". The web
     * calls this on load with a stable per-browser reader id so a paid unlock
     * survives refreshes and return visits. Content is returned only when
     * entitled (never leaks to a non-owner).
     */
    access: publicProcedure
      .input(z.object({ pieceId: z.string().min(1), reader: z.string().min(1).max(128) }))
      .query(({ ctx, input }) => {
        const piece = ctx.store.getPiece(input.pieceId);
        if (!piece) return { entitled: false, content: null as string | null };
        const entitled = ctx.store.hasEntitlement(input.pieceId, input.reader);
        // A bare wallet address is PUBLIC (it's in every on-chain payment tx), so
        // we must NEVER hand back content for one here — that would let anyone who
        // scrapes a payer address read the content free. Wallet owners reveal their
        // content through `restore` (which requires a signature). Unguessable
        // browser reader ids keep the lightweight path (the no-wallet flow).
        const isWalletAddress = /^0x[a-fA-F0-9]{40}$/.test(input.reader);
        const content =
          entitled && !isWalletAddress && piece.kind !== "api" ? piece.content ?? null : null;
        return { entitled, content };
      }),

    /**
     * Restore purchases: prove control of a wallet (via a signed message) and get
     * back every piece that wallet has unlocked — no matter where it paid (browser,
     * terminal/CLI agent, or x402). The wallet is a portable identity; the
     * signature is what stops anyone from reading a public address's content.
     */
    restore: publicProcedure
      .input(
        z.object({
          address: z.string().min(1).max(64),
          message: z.string().min(1).max(2000),
          signature: z.string().min(1).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await restoreEntitlements(ctx.store, input);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * A reader's library — every piece they own. Content is returned for an
     * unguessable browser reader id; a bare wallet address gets metadata only
     * (wallets reveal content via the signature-gated `restore`).
     */
    library: publicProcedure
      .input(z.object({ reader: z.string().min(1).max(128) }))
      .query(({ ctx, input }) => readerLibrary(ctx.store, input.reader)),

    /** Mint a recovery code that backs up this reader's purchases (no-wallet portability). */
    createRecoveryCode: publicProcedure
      .input(z.object({ reader: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) => {
        try {
          return issueRecoveryCode(ctx.store, input.reader);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Redeem a recovery code on a new device — copies the library onto this reader. */
    redeemRecoveryCode: publicProcedure
      .input(z.object({ code: z.string().min(1).max(64), reader: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) => {
        try {
          return redeemRecoveryCode(ctx.store, input.code, input.reader);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Publisher registers a piece (content or paid API). Requires an API key. */
    create: protectedProcedure
      .input(CreatePieceSchema)
      .mutation(({ ctx, input }) => {
        try {
          const piece = ctx.store.createPiece({
            publisherTenantId: ctx.auth!.tenant.id,
            title: input.title,
            kind: input.kind,
            price6: parseUsdc6(input.priceUSDC),
            contributors: input.contributors,
            endpoint: input.endpoint,
            httpMethod: input.httpMethod,
            auth: input.auth,
            preview: input.preview,
            content: input.content,
          });
          whitelistContributors(ctx.store, piece);
          return serializePiece(piece);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Admin: replace a piece's contributors (e.g. swap demo placeholder addresses
     * for real creator wallets) without resetting its stats. Requires a publisher
     * API key; bps must sum to 10000; new addresses are re-whitelisted so the
     * compliance precheck keeps passing.
     */
    setContributors: protectedProcedure
      .input(
        z.object({
          pieceId: z.string().min(1),
          contributors: z.array(ContributorSchema).min(1).max(20),
        }),
      )
      .mutation(({ ctx, input }) => {
        try {
          assertBpsSum(input.contributors);
          const piece = ctx.store.setPieceContributors(input.pieceId, input.contributors);
          whitelistContributors(ctx.store, piece);
          return serializePiece(piece);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Pay for a piece on-chain as the autonomous demo agent — REAL USDC on Arc.
     * Returns real Arc tx hashes. Only available when LIVE_X402 + funded relayer.
     */
    payLive: publicProcedure
      .input(z.object({ pieceId: z.string().min(1), reader: z.string().min(1).max(128).optional() }))
      .mutation(async ({ ctx, input }) => {
        try {
          if (!liveAgentReady()) {
            throw new Error("Live on-chain mode is off (set LIVE_X402 + a funded relayer & demo agent)");
          }
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error(`No such piece: ${input.pieceId}`);
          // Pass the clicker's reader id so the agent's REAL payment also grants
          // them durable access + returns the content — one click, no second pay.
          return await payLiveForPiece(ctx.store, piece, { reader: input.reader });
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Walletless buy: the platform relayer sponsors this reader's unlock. Used by
     * mobile / no-wallet browsers — the relayer pays real USDC on Arc when funded
     * (else mirror-mode simulated), and the reader gets a durable entitlement
     * keyed to their browser id so the content stays unlocked on return visits.
     */
    sponsoredUnlock: publicProcedure
      .input(z.object({ pieceId: z.string().min(1), reader: z.string().min(1).max(128) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error(`No such piece: ${input.pieceId}`);
          if (piece.kind === "api") {
            throw new Error("API pieces are pay-per-call — use callApi, not a sponsored unlock");
          }
          return await sponsoredUnlock(ctx.store, piece, input.reader);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Pay for one call to an "api" piece and return the upstream response.
     *
     * When the live relayer is ready (`liveAgentReady`), this settles for REAL on
     * Arc: the demo agent pays, the payment is verified on-chain, each contributor
     * is paid their split in real USDC, then the upstream call is proxied. Only in
     * zero-key local dev does it fall back to a clearly-labeled simulated split.
     */
    callApi: publicProcedure
      .input(CallPieceSchema.extend({ pieceId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error(`No such piece: ${input.pieceId}`);
          if (piece.kind !== "api") throw new Error(`Piece ${input.pieceId} is not an API service`);
          if (liveAgentReady()) {
            const live = await payLiveForPiece(ctx.store, piece, {
              reader: input.payer,
              input: input.input,
            });
            return {
              settlementMode: "live" as const,
              unlock: {
                pieceId: piece.id,
                title: piece.title,
                payer: input.payer ?? null,
                price6: piece.price6.toString(),
                contributorCount: piece.contributors.length,
                chains: [...new Set(piece.contributors.map((c) => c.targetChain))],
                content: null as string | null,
                paymentTx: live.paymentTx,
                explorer: live.explorer,
                payouts: live.payouts,
              },
              upstream: live.upstream ?? { ok: false, status: 0, body: null, error: "no upstream" },
            };
          }
          const sim = await callPaidService(ctx.store, piece, {
            payer: input.payer,
            agentId: input.agentId,
            input: input.input,
          });
          return { settlementMode: "simulated" as const, ...sim };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Params a wallet needs to pay a piece in real USDC on Arc (or {enabled:false}). */
    paymentInfo: publicProcedure.query(() => walletPaymentInfo()),

    /**
     * Claim a piece after paying for it with a real wallet: verify the buyer's
     * on-chain USDC payment, grant a wallet-keyed entitlement, fan the split out
     * to contributors on Arc, and return the now-unlocked content. This is the
     * flow where "you paid" is cryptographically true.
     */
    claimPaid: publicProcedure
      .input(z.object({ pieceId: z.string().min(1), txHash: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error(`No such piece: ${input.pieceId}`);
          return await claimWalletPayment(ctx.store, piece, input.txHash);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Reader pays for ONE API call from their own wallet (real USDC on Arc): we
     * verify the payment, settle the split to the API owner(s), then proxy the
     * upstream call and return the response. The reader pays — not the agent.
     * Returns the same shape as the live `callApi` so the UI renders it identically.
     */
    claimCall: publicProcedure
      .input(
        z.object({
          pieceId: z.string().min(1),
          txHash: z.string().min(1),
          input: z.record(z.unknown()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error(`No such piece: ${input.pieceId}`);
          const r = await claimWalletCall(ctx.store, piece, input.txHash, input.input);
          return {
            settlementMode: "live" as const,
            unlock: {
              pieceId: piece.id,
              title: piece.title,
              payer: r.payer,
              price6: piece.price6.toString(),
              contributorCount: piece.contributors.length,
              chains: [...new Set(piece.contributors.map((c) => c.targetChain))],
              content: null as string | null,
              paymentTx: r.paymentTx,
              explorer: r.explorer,
              payouts: r.payouts,
            },
            upstream: r.upstream,
          };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /**
     * Legacy/dev unlock — fans the price out to every contributor via the bundled
     * (simulated, `settlementMode:"simulated"`) path. The real human buy paths are
     * `sponsoredUnlock` (relayer-sponsored, real on Arc), `payLive` (agent pays
     * real), and `claimPaid` (wallet pays real); the storefront uses those. Kept
     * for the zero-key local demo and API consumers that want a mirror receipt.
     */
    unlock: publicProcedure
      .input(
        z.object({
          pieceId: z.string().min(1),
          payer: z.string().max(128).optional(),
          agentId: z.string().min(1).max(128).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) {
            throw new Error(`No such piece: ${input.pieceId}`);
          }
          return await payForPiece(ctx.store, piece, {
            payer: input.payer,
            agentId: input.agentId,
          });
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),

  /**
   * Live traction — the hackathon's deciding metric: total creator payouts.
   * Public so it can headline the storefront and the demo.
   */
  traction: router({
    /** Record a unique visitor (the denominator of reader-to-payer conversion). */
    visit: publicProcedure
      .input(z.object({ visitorId: z.string().min(1).max(128) }))
      .mutation(({ ctx, input }) => {
        ctx.store.recordVisitor(input.visitorId);
        return { ok: true };
      }),

    /**
     * Admin: remove on-chain payouts to specific addresses from the leaderboard
     * ledger (e.g. demo placeholder creators). Requires a publisher API key.
     */
    purgeCreators: protectedProcedure
      .input(z.object({ addresses: z.array(z.string().min(1)).min(1).max(50) }))
      .mutation(({ ctx, input }) => {
        try {
          return ctx.store.purgeOnchainPayouts(input.addresses);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    stats: publicProcedure.query(async ({ ctx }) => {
      const pieces = ctx.store.listPieces();
      // Live-settlement relayer funding (cached) — lets the storefront warn the
      // operator before the URL silently stops settling real payments.
      const relayer = await liveRelayerStatus();
      let totalUnlocks = 0;
      let totalPaid6 = 0n;
      const contributors = new Set<string>();
      const chains = new Set<string>();
      for (const p of pieces) {
        totalUnlocks += p.unlocks;
        totalPaid6 += p.totalPaid6;
        for (const c of p.contributors) {
          contributors.add(`${c.targetChain}:${c.address}`);
          chains.add(c.targetChain);
        }
      }
      const topPieces = [...pieces]
        .sort((a, b) => b.unlocks - a.unlocks)
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          unlocks: p.unlocks,
          totalPaid: formatUsdc6(p.totalPaid6),
        }));
      // Verifiable, real-on-Arc traction (the "nothing simulated" headline).
      const onchain = ctx.store.listOnchainSettlements(8);
      const onchainPaid6 = ctx.store.onchainPaidTotal6();
      const settlements = ctx.store.onchainSettlements;
      const onchainPayoutCount = settlements.reduce((n, s) => n + s.payouts.length, 0);

      // RFB-06 metrics — real-only (creators earning, avg/piece, conversion).
      const { topCreators, avgPaymentPerPiece, uniqueVisitors, realBuyerCount, readerToPayerConversion } =
        computeRealTractionMetrics(ctx.store);

      return {
        totalUnlocks,
        totalCreatorPaid: formatUsdc6(totalPaid6),
        pieceCount: pieces.length,
        contributorCount: contributors.size,
        /** Distinct buyers across all pay flows — demand for creators. */
        uniqueBuyers: ctx.store.buyers.size,
        chainCount: chains.size,
        chains: [...chains],
        topPieces,
        onchainMode: config.onchainEnabled ? "live" : "simulated",
        /** When true, the storefront's live-agent button settles real USDC on Arc. */
        liveAgent: liveAgentReady(),
        /** Live-settlement relayer funding status (ready / balance / low). */
        relayer,
        /** Arc explorer base for linking the real settlement txs below. */
        explorer: ARC_TESTNET.explorer,
        /** Real USDC actually paid to creators on Arc (verifiable on-chain). */
        onchainCreatorPaid: formatUsdc6(onchainPaid6),
        /** Count of real on-chain settlement events and individual payout txs. */
        onchainSettlementCount: settlements.length,
        onchainPayoutCount,
        /** RFB-06 metrics, sourced ONLY from real on-chain settlements. */
        avgPaymentPerPiece,
        uniqueVisitors,
        realBuyerCount,
        readerToPayerConversion,
        /** "Creators earning" leaderboard — real USDC per contributor address. */
        topCreators,
        /** Most recent real settlements, with payment + payout tx hashes. */
        recentOnchain: onchain.map((s) => ({
          pieceId: s.pieceId,
          title: s.title,
          kind: s.kind,
          priceUSDC: formatUsdc6(s.price6),
          payer: s.payer,
          paymentTx: s.paymentTx,
          at: s.at,
          payouts: s.payouts.map((p) => ({
            role: p.role,
            address: p.address,
            shareUSDC: formatUsdc6(p.share6),
            txHash: p.txHash,
          })),
        })),
      };
    }),
  }),

  /**
   * The agentic layer: an autonomous reading-agent that decides which pieces to
   * unlock and pays the creators per piece. Public so the storefront's "let an
   * agent read" demo can drive real payment volume on its own.
   */
  agent: router({
    read: publicProcedure
      .input(
        z.object({
          interests: z.array(z.string().min(1)).min(1).max(10),
          maxUnlocks: z.number().int().min(1).max(50).default(3),
          budgetUSDC: z
            .string()
            .regex(/^\d+(\.\d{1,6})?$/)
            .default("0.50"),
          agentId: z.string().min(1).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await runReadingAgent(ctx.store, {
            interests: input.interests,
            maxUnlocks: input.maxUnlocks,
            budgetUSDC: input.budgetUSDC,
            agentId: input.agentId,
          });
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),

  /**
   * Creator accounts — the real-user layer. A creator logs in with email + a
   * one-time code, is assigned a custodial Circle wallet on Arc, publishes pieces,
   * watches real earnings climb, and withdraws. Session auth via x-creator-token.
   */
  creator: router({
    /** Email a one-time login code (logged to stdout in keyless dev). */
    requestOtp: publicProcedure
      .input(CreatorRequestOtpSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const { channel } = await requestCreatorOtp(ctx.store, input.email, Date.now());
          return { ok: true, channel };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Verify the code; create the account + assign a wallet on first login. */
    verifyOtp: publicProcedure
      .input(CreatorVerifyOtpSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const { token, creator, isNew } = await verifyCreatorOtp(ctx.store, input, Date.now());
          return { token, isNew, creator: creatorView(creator) };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** The logged-in creator's profile (resolves the x-creator-token session). */
    me: publicProcedure.query(({ ctx }) => {
      try {
        const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
        return creatorView(me);
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

    /** The creator's payout wallet + live USDC balance. */
    wallet: publicProcedure.query(async ({ ctx }) => {
      try {
        const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
        const balance6 = me.walletId ? await getWalletBalance6(me.walletId) : 0n;
        return {
          address: me.walletAddress,
          provider: me.walletProvider,
          custodial: me.walletProvider === "circle",
          balanceUSDC: formatUsdc6(balance6),
          explorer: ARC_TESTNET.explorer,
        };
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

    /** Real on-chain earnings rolled up to this creator's payout address. */
    earnings: publicProcedure.query(({ ctx }) => {
      try {
        const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
        return creatorEarnings(ctx.store, me.walletAddress);
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

    /** Pieces this creator has published. */
    myPieces: publicProcedure.query(({ ctx }) => {
      try {
        const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
        return ctx.store.listPieces(me.tenantId).map(serializePiece);
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

    /** Publish a piece from the creator dashboard (no API key — session auth). */
    publish: publicProcedure
      .input(CreatorPublishSchema)
      .mutation(({ ctx, input }) => {
        try {
          const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
          const contributors = resolveContributors(ctx.store, input.contributors);
          assertBpsSum(contributors);
          const piece = ctx.store.createPiece({
            publisherTenantId: me.tenantId,
            title: input.title,
            kind: input.kind,
            price6: parseUsdc6(input.priceUSDC),
            contributors,
            endpoint: input.endpoint,
            httpMethod: input.httpMethod,
            auth: input.auth,
            preview: input.preview,
            content: input.content,
          });
          whitelistContributors(ctx.store, piece);
          return serializePiece(piece);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Permanently delete one of this creator's own pieces from the catalog. */
    deletePiece: publicProcedure
      .input(z.object({ pieceId: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        try {
          const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
          const piece = ctx.store.getPiece(input.pieceId);
          if (!piece) throw new Error("No such piece");
          if (piece.publisherTenantId !== me.tenantId) {
            throw new Error("You can only delete your own pieces");
          }
          const deleted = ctx.store.deletePiece(input.pieceId);
          return { deleted };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Withdraw USDC from the custodial wallet to an external EVM address. */
    withdraw: publicProcedure
      .input(CreatorWithdrawSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
          if (!me.walletId) throw new Error("No wallet to withdraw from");
          const res = await createWithdrawal(me.walletId, input.toAddress, parseUsdc6(input.amountUSDC));
          return { ok: true, transactionId: res.transactionId, state: res.state };
        } catch (err) {
          throw toTRPCError(err);
        }
      }),

    /** Switch to a bring-your-own payout address (advanced creators). */
    setPayoutAddress: publicProcedure
      .input(CreatorPayoutAddressSchema)
      .mutation(({ ctx, input }) => {
        try {
          const me = authenticateCreator(ctx.store, ctx.creatorToken, Date.now());
          me.walletAddress = input.address;
          me.walletProvider = "byo";
          me.walletId = null;
          ctx.store.upsertCreator(me);
          return creatorView(me);
        } catch (err) {
          throw toTRPCError(err);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
