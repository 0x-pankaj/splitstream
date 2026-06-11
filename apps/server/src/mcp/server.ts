/**
 * Arcane Treasury MCP server — exposes the treasury engine as Model Context
 * Protocol tools so an AI agent (Claude, etc.) can autonomously authorize and
 * stream cross-chain USDC payouts within a scoped, velocity-limited policy,
 * while the CFO retains a single-currency audit log.
 *
 * Every tool requires the platform's scoped api key; agent-initiated payouts
 * additionally pass an agentId so the agent's velocity policy is enforced.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArcaneError, TARGET_CHAINS, CURRENCY_CODES } from "@arcane/shared";
import type { Store } from "../db/store.js";
import { authenticate } from "../auth/apiKeys.js";
import { processBulkPayout } from "../services/payoutEngine.js";
import { createAgentWallet } from "../services/agentTreasury.js";
import { readTenantBalance6 } from "../services/vault.js";
import { serializeAgent, serializeAudit } from "../trpc/serialize.js";
import { formatUsdc6, planPayout, totalDebit6 } from "@arcane/shared";
import { config } from "../config.js";

const payoutItemShape = {
  recipientAddress: z.string().describe("Destination address (EVM 0x… or Solana base58)"),
  targetChain: z.enum(TARGET_CHAINS),
  amountUSDC: z.string().describe('USDC amount as a string, e.g. "250.00"'),
  currencyCode: z.enum(CURRENCY_CODES).default("USD"),
};

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message =
    err instanceof ArcaneError
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : "Unknown error";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer({
    name: "arcane-treasury",
    version: "0.1.0",
  });

  server.registerTool(
    "get_treasury_balance",
    {
      title: "Get treasury balance",
      description:
        "Return the tenant's Arc L1 vault balance, rolling velocity usage, and the instant/whale routing threshold.",
      inputSchema: { apiKey: z.string() },
    },
    async ({ apiKey }) => {
      try {
        const { tenant } = authenticate(store, apiKey, "treasury:read");
        const balance6 = await readTenantBalance6(store, tenant);
        const limit6 = store.dailyVolumeLimit6.get(tenant.id) ?? 0n;
        const used6 = store.currentVolume6(tenant.id, Date.now());
        return ok({
          tenant: tenant.name,
          balanceUSDC: formatUsdc6(balance6),
          velocityLimitUSDC: formatUsdc6(limit6),
          velocityUsedUSDC: formatUsdc6(used6),
          velocityRemainingUSDC: formatUsdc6(limit6 - used6),
          instantThresholdUSDC: formatUsdc6(config.instantThreshold6),
          onchainMode: config.onchainEnabled ? "live" : "simulated",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "simulate_route",
    {
      title: "Simulate payout routing",
      description:
        "Dry-run a batch: classify each payout into the instant (Gateway) or whale (CCTP) path and price fees, without settling.",
      inputSchema: { apiKey: z.string(), payouts: z.array(z.object(payoutItemShape)).min(1) },
    },
    async ({ apiKey, payouts }) => {
      try {
        authenticate(store, apiKey, "treasury:read");
        let instant = 0;
        let whale = 0;
        let debit6 = 0n;
        const items = payouts.map((item) => {
          const plan = planPayout({
            item,
            threshold6: config.instantThreshold6,
            policy: config.feePolicy,
          });
          if (plan.path === "instant") instant += 1;
          else whale += 1;
          debit6 += totalDebit6(plan.fees);
          return {
            recipient: item.recipientAddress,
            chain: item.targetChain,
            amount: formatUsdc6(plan.amount6),
            path: plan.path,
            totalDebit: formatUsdc6(totalDebit6(plan.fees)),
          };
        });
        return ok({ summary: { count: items.length, instant, whale, totalDebit: formatUsdc6(debit6) }, items });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "submit_bulk_payout",
    {
      title: "Submit a bulk cross-chain payout",
      description:
        "Settle a batch of cross-chain USDC payouts through the hybrid engine. If agentId is supplied, the agent's velocity policy is enforced before settlement.",
      inputSchema: {
        apiKey: z.string(),
        payouts: z.array(z.object(payoutItemShape)).min(1).max(10_000),
        agentId: z.string().optional(),
        idempotencyKey: z.string().min(8).optional(),
      },
    },
    async ({ apiKey, payouts, agentId, idempotencyKey }) => {
      try {
        const { tenant } = authenticate(store, apiKey, "payouts:write");
        const result = await processBulkPayout(store, tenant, {
          tenantId: tenant.id,
          payouts,
          agentId,
          idempotencyKey,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_audit_log",
    {
      title: "Get the CFO audit log",
      description: "Return the tenant's single-currency settlement audit log, newest first.",
      inputSchema: { apiKey: z.string(), limit: z.number().int().min(1).max(1000).default(50) },
    },
    async ({ apiKey, limit }) => {
      try {
        const { tenant } = authenticate(store, apiKey, "treasury:read");
        return ok(store.auditForTenant(tenant.id).slice(0, limit).map(serializeAudit));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_agent_policy",
    {
      title: "Create or update an agent wallet policy",
      description:
        "Provision a scoped, velocity-limited agent wallet (per-transaction / daily / weekly / monthly USDC caps) the AI agent can spend within.",
      inputSchema: {
        apiKey: z.string(),
        agentId: z.string().min(1),
        label: z.string().min(1),
        perTransaction: z.string(),
        daily: z.string(),
        weekly: z.string(),
        monthly: z.string(),
      },
    },
    async ({ apiKey, agentId, label, perTransaction, daily, weekly, monthly }) => {
      try {
        const { tenant } = authenticate(store, apiKey, "agents:manage");
        const agent = createAgentWallet(store, {
          agentId,
          tenantId: tenant.id,
          label,
          policy: { perTransaction, daily, weekly, monthly },
        });
        return ok(serializeAgent(agent));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
