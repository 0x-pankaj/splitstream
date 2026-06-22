/**
 * SplitStream reading-agent — the agentic layer (RFB: "AI reading lists that
 * auto-pay creators as you consume").
 *
 * An autonomous agent walks the catalog and DECIDES which pieces to unlock based
 * on its interests and a session budget, then pays the creators per piece. Money
 * control stays in code: the agent only chooses; the loop enforces the budget,
 * the max-unlocks ceiling, and (when an agent wallet is supplied) the on-chain
 * spend caps in agentTreasury. Each unlock fans out to every contributor via the
 * reused split engine — so an agent reading a feed continuously pays real,
 * sub-cent USDC to creators across chains.
 *
 * Two decision modes, mirroring the rest of the codebase's "works with zero
 * keys, upgrades when configured" philosophy:
 *   - heuristic (default): deterministic interest-keyword scoring. Always runs.
 *   - llm (OPENROUTER_API_KEY set): an LLM via OpenRouter (default model
 *     deepseek/deepseek-v4-pro, override with OPENROUTER_MODEL) reasons over the
 *     catalog and returns which pieces to unlock and why. Falls back to the
 *     heuristic on any error so the demo never breaks.
 */

import { formatUsdc6, parseUsdc6, type Piece } from "@arcane/shared";
import type { Store } from "../db/store.js";
import { sponsoredUnlock, type SponsoredUnlockResult } from "./liveAgent.js";

export interface ReadingAgentConfig {
  /** Optional scoped agent wallet — when set, its on-chain spend caps apply. */
  agentId?: string;
  /** Topics the agent cares about; drives which pieces it chooses to read. */
  interests: string[];
  /** Hard ceiling on how many pieces to unlock this session. */
  maxUnlocks: number;
  /** Session spend budget as a human USDC string, e.g. "0.50". */
  budgetUSDC: string;
}

/** The agent's verdict on a single piece, before the budget loop runs. */
export interface ReadingDecision {
  pieceId: string;
  title: string;
  priceUSDC: string;
  unlock: boolean;
  reason: string;
  /** Interest relevance score (heuristic) or model-assigned rank. */
  score: number;
}

export interface ReadingSessionResult {
  mode: "llm" | "heuristic";
  interests: string[];
  considered: number;
  unlocked: number;
  skipped: number;
  spentUSDC: string;
  budgetUSDC: string;
  decisions: ReadingDecision[];
  /** Each unlock the agent paid for — REAL on Arc in production. */
  unlocks: SponsoredUnlockResult[];
}

/** Lowercase keyword bag describing a piece, for interest matching. */
function pieceText(piece: Piece): string {
  const roles = piece.contributors.map((c) => c.role).join(" ");
  return `${piece.title} ${piece.kind} ${roles}`.toLowerCase();
}

/**
 * Deterministic interest-relevance scoring: a piece scores one point per
 * interest keyword that appears in its title/kind/roles. Pieces with no match
 * still get a tiny base score so a curious agent with budget left will sample
 * them after exhausting its strong matches.
 */
export function heuristicDecide(
  pieces: Piece[],
  config: ReadingAgentConfig,
): ReadingDecision[] {
  const interests = config.interests.map((i) => i.toLowerCase());
  return pieces
    .map((piece): ReadingDecision => {
      const text = pieceText(piece);
      const hits = interests.filter((i) => i.length > 0 && text.includes(i));
      const score = hits.length + 0.1;
      const reason =
        hits.length > 0
          ? `Matches interests: ${hits.join(", ")}`
          : "No direct interest match — sampling if budget allows";
      return {
        pieceId: piece.id,
        title: piece.title,
        priceUSDC: formatUsdc6(piece.price6),
        unlock: hits.length > 0,
        reason,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Default model on OpenRouter; override with OPENROUTER_MODEL. */
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-pro";

/**
 * Ask an LLM (via OpenRouter) which pieces to unlock. Returns null when no API
 * key is configured or the call fails, so callers fall back to the heuristic.
 * The model only chooses and explains; it never moves money.
 */
async function llmDecide(
  pieces: Piece[],
  config: ReadingAgentConfig,
): Promise<ReadingDecision[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: OpenAI } = await import("openai");

    const client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const catalog = pieces.map((p) => ({
      pieceId: p.id,
      title: p.title,
      kind: p.kind,
      priceUSDC: formatUsdc6(p.price6),
      contributors: p.contributors.map((c) => `${c.role} (${c.targetChain})`),
    }));

    const completion = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an autonomous reading agent for SplitStream, a per-piece creator " +
            "monetization platform on Circle's Arc L1. You decide which pieces of " +
            "content are worth unlocking (paying a few cents for) given the reader's " +
            "interests and budget. Paying unlocks the piece and instantly splits the " +
            "payment across its creators. Prefer pieces that match the interests; you " +
            "may sample an off-interest piece if it looks valuable and budget remains. " +
            "Reply with ONLY a JSON object of the form " +
            '{"decisions":[{"pieceId":string,"unlock":boolean,"reason":string,"score":number}]} ' +
            "where score is 0 (skip) to 1 (must read) and reason is one line. " +
            "Return a decision for every piece in the catalog.",
        },
        {
          role: "user",
          content:
            `Interests: ${config.interests.join(", ") || "(none specified)"}\n` +
            `Session budget: $${config.budgetUSDC} USDC\n` +
            `Unlock at most ${config.maxUnlocks} pieces.\n\n` +
            `Catalog:\n${JSON.stringify(catalog, null, 2)}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) return null;

    const parsed = JSON.parse(text) as {
      decisions?: Array<{ pieceId: string; unlock: boolean; reason: string; score: number }>;
    };
    if (!Array.isArray(parsed.decisions)) return null;

    const byId = new Map(pieces.map((p) => [p.id, p]));
    return parsed.decisions
      .filter((d) => d && byId.has(d.pieceId))
      .map((d): ReadingDecision => {
        const piece = byId.get(d.pieceId)!;
        return {
          pieceId: d.pieceId,
          title: piece.title,
          priceUSDC: formatUsdc6(piece.price6),
          unlock: Boolean(d.unlock),
          reason: typeof d.reason === "string" ? d.reason : "",
          score: typeof d.score === "number" ? d.score : 0,
        };
      })
      .sort((a, b) => b.score - a.score);
  } catch {
    // Any failure (no key, network, parse) falls back to the heuristic.
    return null;
  }
}

/**
 * Run one autonomous reading session: decide, then unlock-and-pay within the
 * budget and unlock ceiling. Returns a full session report for the UI/demo.
 */
export async function runReadingAgent(
  store: Store,
  config: ReadingAgentConfig,
  now = Date.now(),
): Promise<ReadingSessionResult> {
  const pieces = store.listPieces();
  const llm = await llmDecide(pieces, config);
  const decisions = llm ?? heuristicDecide(pieces, config);
  const mode: "llm" | "heuristic" = llm ? "llm" : "heuristic";

  const budget6 = parseUsdc6(config.budgetUSDC);
  let spent6 = 0n;
  let unlocked = 0;
  let skipped = 0;
  const unlocks: SponsoredUnlockResult[] = [];
  const reader = `reading-agent${config.agentId ? `:${config.agentId}` : ""}`;

  for (const decision of decisions) {
    const piece = store.getPiece(decision.pieceId);
    if (!piece) continue;

    const affordable = spent6 + piece.price6 <= budget6;
    const hasRoom = unlocked < config.maxUnlocks;

    if (decision.unlock && affordable && hasRoom) {
      // Settle for REAL on Arc in production (sponsoredUnlock pays via the relayer
      // when live, simulated only as the zero-key dev fallback) — so the agent's
      // reading session produces real, verifiable creator payouts.
      const result = await sponsoredUnlock(store, piece, reader);
      unlocks.push(result);
      spent6 += piece.price6;
      unlocked += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    mode,
    interests: config.interests,
    considered: decisions.length,
    unlocked,
    skipped,
    spentUSDC: formatUsdc6(spent6),
    budgetUSDC: config.budgetUSDC,
    decisions,
    unlocks,
  };
}
