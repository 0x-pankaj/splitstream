/**
 * SplitStream's per-piece payment orchestrator.
 *
 * A reader (human or agent) unlocks a piece; this fans that single payment out
 * to every contributor on the chain they want, instantly. It does so by mapping
 * the piece onto the reused bulk-payout engine: contributors become recipients,
 * their basis-point shares become per-recipient amounts. The engine then handles
 * routing (instant vs whale), compliance, cross-chain settlement, Arc L1
 * reimbursement, and the audit log — SplitStream adds only the split math and
 * the content/traction bookkeeping.
 *
 * Fee model (v1): the engine assesses network + convenience fees ON TOP of each
 * contributor's gross share. So we credit the publisher's vault for
 * (sum of shares = price) + (sum of fees) before settling — modelling the
 * reader's funds plus operational cost landing in the vault. Contributors split
 * the full price. v2 will net the platform fee out of the reader's price instead
 * (see SPLITSTREAM_PLAN.md "Fee model").
 */

import {
  computeSplit,
  deriveRecipientKey,
  formatUsdc6,
  planPayout,
  totalDebit6,
  errors,
  type BulkPayoutInput,
  type Piece,
  type TargetChain,
} from "@arcane/shared";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import { processBulkPayout, type BulkPayoutResult, type PayoutResult } from "./payoutEngine.js";

/** Per-contributor view of how a single unlock was split and settled. */
export interface ContributorSettlement {
  role: string;
  recipientAddress: string;
  targetChain: TargetChain;
  splitBps: number;
  /** This contributor's share of the unlock price, 6dp string. */
  share6: string;
  /** Settlement detail from the engine (tx hashes, path, latency). */
  settlement: PayoutResult;
}

/** The receipt returned to a reader after unlocking a piece. */
export interface PieceUnlockResult {
  pieceId: string;
  title: string;
  payer: string | null;
  /** Price the reader paid to unlock, 6dp string. */
  price6: string;
  /** Number of contributors paid in this unlock. */
  contributorCount: number;
  /** Distinct chains funds landed on for this unlock. */
  chains: TargetChain[];
  /**
   * The gated content the reader just paid for — markdown/text, or a URL for
   * media — revealed only here, after payment. Null for "api" pieces (which
   * return the upstream response instead) and for content pieces with no body.
   */
  content: string | null;
  contributors: ContributorSettlement[];
  /** The underlying bulk-payout batch (engine's authoritative result). */
  batch: BulkPayoutResult;
  /**
   * Whether the contributor legs settled with real on-chain USDC ("live") or a
   * simulated mirror-mode receipt ("simulated"). The bundled `payForPiece` path
   * is always "simulated" (real piece settlement runs through `payLiveForPiece` /
   * the x402 route); this label means a fake tx hash is never mistaken for real.
   */
  settlementMode: "live" | "simulated";
  /** Running piece stats after this unlock. */
  pieceUnlocks: number;
  pieceTotalPaid6: string;
}

/**
 * Ensure every contributor address is on the publisher tenant's allowlist so the
 * engine's compliance precheck passes. Idempotent — safe to call at creation and
 * again at pay time.
 */
export function whitelistContributors(store: Store, piece: Piece): void {
  for (const c of piece.contributors) {
    store.addRecipient(piece.publisherTenantId, {
      recipientKey: deriveRecipientKey(c.address),
      address: c.address,
      targetChain: c.targetChain,
      label: `${piece.title} — ${c.role}`,
    });
  }
}

/** The upstream response returned to a caller after paying for an API piece. */
export interface ServiceCallResult {
  unlock: PieceUnlockResult;
  upstream: {
    ok: boolean;
    status: number;
    /** Upstream body (parsed JSON when possible, else raw text, truncated). */
    body: unknown;
    error?: string;
  };
}

const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 20_000;

/** Upstream response shape returned by the proxy. */
export interface UpstreamResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/**
 * Proxy ONE call to a paid API's upstream endpoint, injecting the seller's
 * credential server-side (the caller never sees the secret). Used by both the
 * mirror call path and the live x402 settlement path. Never throws — network/HTTP
 * failures are returned as a non-ok result.
 */
export async function proxyUpstream(
  piece: Piece,
  input?: Record<string, unknown>,
): Promise<UpstreamResult> {
  if (piece.kind !== "api" || !piece.endpoint) {
    throw errors.internal(`Piece ${piece.id} is not a callable API service`);
  }
  const method = piece.httpMethod ?? "GET";

  // Inject the seller's upstream credential (if any). The secret lives only here,
  // server-side: it is attached to the outbound request and never returned to the
  // paying agent — so the agent buys access without ever seeing the key.
  let url = piece.endpoint;
  const headers: Record<string, string> = {};
  if (method === "POST") headers["content-type"] = "application/json";
  if (piece.auth) {
    const { type, name, secret } = piece.auth;
    if (type === "bearer") {
      headers["authorization"] = `Bearer ${secret}`;
    } else if (type === "header" && name) {
      headers[name] = secret;
    } else if (type === "query" && name) {
      url += `${url.includes("?") ? "&" : "?"}${encodeURIComponent(name)}=${encodeURIComponent(secret)}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });
    const raw = (await res.text()).slice(0, MAX_BODY_CHARS);
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* not JSON — keep the raw text */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : "upstream call failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pay for ONE call to an "api" piece, then proxy the upstream request and return
 * its response — the bundled pay-per-call path (mirror / one-click UI). Payment
 * (and the cross-chain split to the API's owners) happens first via payForPiece;
 * only then is the upstream called.
 */
export async function callPaidService(
  store: Store,
  piece: Piece,
  opts: { payer?: string; agentId?: string; input?: Record<string, unknown> } = {},
  now = Date.now(),
): Promise<ServiceCallResult> {
  if (piece.kind !== "api" || !piece.endpoint) {
    throw errors.internal(`Piece ${piece.id} is not a callable API service`);
  }
  const unlock = await payForPiece(store, piece, { payer: opts.payer, agentId: opts.agentId }, now);
  const upstream = await proxyUpstream(piece, opts.input);
  return { unlock, upstream };
}

/**
 * Pay for (unlock) a piece: split the price across contributors and settle each
 * on their chain via the reused payout engine.
 */
export async function payForPiece(
  store: Store,
  piece: Piece,
  opts: { payer?: string; agentId?: string } = {},
  now = Date.now(),
): Promise<PieceUnlockResult> {
  const tenant = store.tenants.get(piece.publisherTenantId);
  if (!tenant) {
    throw errors.tenantNotFound(piece.publisherTenantId);
  }

  // Make sure contributors are vetted (compliance precheck depends on this).
  whitelistContributors(store, piece);

  // 1) Split the price into exact per-contributor shares.
  const shares6 = computeSplit(piece.price6, piece.contributors);

  // 2) Build the bulk-payout items (contributors → recipients).
  const payouts = piece.contributors.map((c, i) => ({
    recipientAddress: c.address,
    targetChain: c.targetChain,
    amountUSDC: formatUsdc6(shares6[i]!),
    currencyCode: "USD" as const,
  }));

  // 3) Credit the vault for the reader's payment + operational fees so the
  //    engine's funding check always clears (v1 fee-on-top model).
  let fees6 = 0n;
  for (const item of payouts) {
    const planned = planPayout({
      item,
      threshold6: config.instantThreshold6,
      policy: config.feePolicy,
    });
    fees6 += totalDebit6(planned.fees) - planned.amount6;
  }
  store.creditBalance(tenant.id, piece.price6 + fees6);

  // 4) Settle the split through the reused engine.
  const input: BulkPayoutInput = {
    tenantId: tenant.id,
    idempotencyKey: `unlock-${piece.id}-${now.toString(36)}`,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    payouts,
  };
  // SplitStream pieces settle via the direct-payout model (the live-agent button
  // and the x402 LIVE_X402 path), never the treasury vault's executeIntent — so
  // the bundled split always uses simulated settlement, even when the backend is
  // booted in live (vault-configured) mode. Real on-chain settlement for a piece
  // happens through payLiveForPiece / the x402 route.
  const batch = await processBulkPayout(store, tenant, input, now, { forceSimulated: true });

  // 5) Record the unlock for the traction counter, and grant the reader durable
  //    access so a return visit / refresh re-reads for free (pay once, keep it).
  store.recordUnlock(piece.id, piece.price6);
  if (opts.payer) store.grantEntitlement(piece.id, opts.payer);
  // Count the distinct buyer (reader id or agent) for the traction "buyers" number.
  store.recordBuyer(opts.payer ?? opts.agentId);
  const updated = store.getPiece(piece.id)!;

  // 6) Assemble the reader-facing receipt, aligning settlements to contributors.
  const contributors: ContributorSettlement[] = piece.contributors.map((c, i) => ({
    role: c.role,
    recipientAddress: c.address,
    targetChain: c.targetChain,
    splitBps: c.splitBps,
    share6: shares6[i]!.toString(),
    settlement: batch.results[i]!,
  }));

  const chains = [...new Set(piece.contributors.map((c) => c.targetChain))];

  return {
    pieceId: piece.id,
    title: piece.title,
    payer: opts.payer ?? null,
    price6: piece.price6.toString(),
    contributorCount: piece.contributors.length,
    chains,
    // Deliver the gated content now that payment + split have succeeded. "api"
    // pieces carry no content (the upstream response is the deliverable).
    content: piece.kind === "api" ? null : piece.content ?? null,
    contributors,
    batch,
    settlementMode: batch.results[0]?.settlementMode ?? "simulated",
    pieceUnlocks: updated.unlocks,
    pieceTotalPaid6: updated.totalPaid6.toString(),
  };
}
