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
import { payForPiece } from "../services/splitEngine.js";

/** Arc L1 native USDC system contract (6dp ERC-20 view). */
const ARC_USDC = "0x3600000000000000000000000000000000000000";

const DashboardPayoutSchema = z.object({
  payouts: z.array(PayoutItemSchema).min(1).max(10_000),
  agentId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    onchainEnabled: config.onchainEnabled,
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

    /** Unlock (pay for) a piece — fans the price out to every contributor. */
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
    stats: publicProcedure.query(({ ctx }) => {
      const pieces = ctx.store.listPieces();
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
      return {
        totalUnlocks,
        totalCreatorPaid: formatUsdc6(totalPaid6),
        pieceCount: pieces.length,
        contributorCount: contributors.size,
        chainCount: chains.size,
        chains: [...chains],
        topPieces,
        onchainMode: config.onchainEnabled ? "live" : "simulated",
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
