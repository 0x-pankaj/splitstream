/**
 * Autonomous Treasury layer — scoped, velocity-limited agent wallets.
 *
 * An enterprise deploys an AI agent (e.g. a programmatic ad-buyer) and gives it
 * a wallet with per-transaction / daily / weekly / monthly USDC caps. The agent
 * can then autonomously authorize cross-chain payouts within those caps, while
 * the CFO keeps a single-currency audit log. Caps mirror Circle's agent-wallet
 * policy semantics and are enforced here before the engine ever touches a rail.
 */

import { errors, parseUsdc6, type AgentPolicy, type AgentWallet } from "@arcane/shared";
import type { Store } from "../db/store.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

interface WindowStarts {
  day: number;
  week: number;
  month: number;
}

const windowStarts = new Map<string, WindowStarts>();

export function resetAgentWindows(): void {
  windowStarts.clear();
}

function policyFromStrings(p: {
  perTransaction: string;
  daily: string;
  weekly: string;
  monthly: string;
}): AgentPolicy {
  return {
    perTransaction6: parseUsdc6(p.perTransaction),
    daily6: parseUsdc6(p.daily),
    weekly6: parseUsdc6(p.weekly),
    monthly6: parseUsdc6(p.monthly),
  };
}

export function createAgentWallet(
  store: Store,
  input: {
    agentId: string;
    tenantId: string;
    label: string;
    policy: { perTransaction: string; daily: string; weekly: string; monthly: string };
  },
  now = Date.now(),
): AgentWallet {
  const agent: AgentWallet = {
    agentId: input.agentId,
    tenantId: input.tenantId,
    label: input.label,
    policy: policyFromStrings(input.policy),
    spend: { daily6: 0n, weekly6: 0n, monthly6: 0n },
    enabled: true,
    createdAt: new Date(now).toISOString(),
  };
  store.upsertAgent(agent);
  windowStarts.set(agent.agentId, { day: now, week: now, month: now });
  return agent;
}

export function setAgentEnabled(store: Store, agentId: string, enabled: boolean): AgentWallet {
  const agent = store.agent(agentId);
  if (!agent) throw errors.internal(`Unknown agent ${agentId}`);
  agent.enabled = enabled;
  store.upsertAgent(agent);
  return agent;
}

/** Roll forward spend windows that have elapsed, zeroing the accumulator. */
function rollWindows(agent: AgentWallet, now: number): void {
  let starts = windowStarts.get(agent.agentId);
  if (!starts) {
    starts = { day: now, week: now, month: now };
    windowStarts.set(agent.agentId, starts);
  }
  if (now - starts.day >= DAY) {
    agent.spend.daily6 = 0n;
    starts.day = now;
  }
  if (now - starts.week >= WEEK) {
    agent.spend.weekly6 = 0n;
    starts.week = now;
  }
  if (now - starts.month >= MONTH) {
    agent.spend.monthly6 = 0n;
    starts.month = now;
  }
}

/**
 * Authorize an agent-initiated spend against its velocity policy. Throws an
 * ArcaneError on any breach; records the spend across all windows on success.
 */
export function authorizeAgentSpend(
  store: Store,
  agentId: string,
  amount6: bigint,
  now = Date.now(),
): AgentWallet {
  const agent = store.agent(agentId);
  if (!agent) throw errors.internal(`Unknown agent ${agentId}`);
  if (!agent.enabled) throw errors.agentDisabled(agentId);

  rollWindows(agent, now);

  const { policy, spend } = agent;
  if (amount6 > policy.perTransaction6) {
    throw errors.agentPolicyExceeded({
      window: "perTransaction",
      cap6: policy.perTransaction6.toString(),
      attempted6: amount6.toString(),
    });
  }
  const checks: Array<[string, bigint, bigint]> = [
    ["daily", spend.daily6 + amount6, policy.daily6],
    ["weekly", spend.weekly6 + amount6, policy.weekly6],
    ["monthly", spend.monthly6 + amount6, policy.monthly6],
  ];
  for (const [window, projected, cap] of checks) {
    if (projected > cap) {
      throw errors.agentPolicyExceeded({
        window,
        cap6: cap.toString(),
        projected6: projected.toString(),
      });
    }
  }

  spend.daily6 += amount6;
  spend.weekly6 += amount6;
  spend.monthly6 += amount6;
  store.upsertAgent(agent);
  return agent;
}

/**
 * Atomically authorize a batch of agent-initiated payouts: every item must fit
 * the per-transaction cap and the batch total must fit every rolling window.
 * Validates fully before mutating any spend, so a rejected batch records
 * nothing.
 */
export function authorizeAgentBatch(
  store: Store,
  agentId: string,
  amounts6: bigint[],
  now = Date.now(),
): AgentWallet {
  const agent = store.agent(agentId);
  if (!agent) throw errors.internal(`Unknown agent ${agentId}`);
  if (!agent.enabled) throw errors.agentDisabled(agentId);

  rollWindows(agent, now);
  const { policy, spend } = agent;

  for (const amount6 of amounts6) {
    if (amount6 > policy.perTransaction6) {
      throw errors.agentPolicyExceeded({
        window: "perTransaction",
        cap6: policy.perTransaction6.toString(),
        attempted6: amount6.toString(),
      });
    }
  }

  const total = amounts6.reduce((s, a) => s + a, 0n);
  const windows: Array<[string, bigint, bigint]> = [
    ["daily", spend.daily6 + total, policy.daily6],
    ["weekly", spend.weekly6 + total, policy.weekly6],
    ["monthly", spend.monthly6 + total, policy.monthly6],
  ];
  for (const [window, projected, cap] of windows) {
    if (projected > cap) {
      throw errors.agentPolicyExceeded({
        window,
        cap6: cap.toString(),
        projected6: projected.toString(),
      });
    }
  }

  spend.daily6 += total;
  spend.weekly6 += total;
  spend.monthly6 += total;
  store.upsertAgent(agent);
  return agent;
}
