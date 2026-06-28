/**
 * In-app autonomous agent that pays for a piece with REAL USDC on Arc — so a
 * click on the storefront triggers a real on-chain settlement (not a simulation).
 *
 * It uses a persistent demo agent wallet (DEMO_AGENT_PRIVATE_KEY), funded once
 * from the relayer. On each call the agent:
 *   1. tops itself up from the relayer if its balance is low,
 *   2. signs + sends a real USDC payment to the platform payTo on Arc,
 *   3. has the payment verified on-chain,
 *   4. pays each contributor their split in real USDC on Arc,
 *   5. (for API pieces) proxies the upstream call,
 * returning every real Arc tx hash. Requires LIVE_X402 + a funded relayer.
 */

import { createWalletClient, http, type WalletClient, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_TESTNET,
  USDC,
  arcTestnet,
  computeSplit,
  formatUsdc6,
  type Piece,
} from "@arcane/shared";
import { config } from "../config.js";
import { publicClient, relayerAccount, walletClient as relayerWallet } from "../chain/arc.js";
import { erc20Abi } from "../chain/abis.js";
import { verifyArcUsdcPayment, payContributorsOnArc, type OnArcPayout } from "./x402Settle.js";
import { proxyUpstream, payForPiece, type UpstreamResult } from "./splitEngine.js";
import type { Store } from "../db/store.js";

/**
 * Top up the agent when its USDC balance drops below this (6dp). Kept well above
 * a single unlock price so the agent never lands in a low-balance dead-zone where
 * `transfer(price) + gas` can't clear even though the nominal balance looks fine.
 */
const LOW_BALANCE_6 = 1_000_000n; // $1.00
/** Native-USDC top-up amount (18dp) = $3.00 — refills to a healthy buffer. */
const TOPUP_18 = 3_000_000_000_000_000_000n;

/** Advisory "relayer is running low" threshold (6dp) — surfaced as a banner. */
const RELAYER_LOW_6 = 1_000_000n; // $1.00
/** Small gas/headroom buffer required above a piece's price before settling. */
const RELAYER_GAS_BUFFER_6 = 100_000n; // $0.10
/** Cache the relayer balance so the polled traction/health reads don't hammer RPC. */
const RELAYER_BAL_TTL_MS = 30_000;
let _relayerBalCache: { at: number; bal6: bigint } | undefined;

let _agent: Account | undefined;
let _agentWallet: WalletClient | undefined;

function agentWallet(): { account: Account; wallet: WalletClient } {
  if (!config.demoAgentPrivateKey) throw new Error("DEMO_AGENT_PRIVATE_KEY not configured");
  if (!_agent || !_agentWallet) {
    _agent = privateKeyToAccount(config.demoAgentPrivateKey);
    _agentWallet = createWalletClient({ account: _agent, chain: arcTestnet, transport: http(config.rpcHttp) });
  }
  return { account: _agent, wallet: _agentWallet };
}

async function usdc6(addr: string): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr as `0x${string}`],
  })) as bigint;
}

export interface LiveAgentResult {
  mode: "live-arc";
  agent: string;
  /** payTo (the platform relayer). */
  paidTo: string;
  /** The agent's real USDC payment tx on Arc. */
  paymentTx: string;
  priceUSDC: string;
  payouts: OnArcPayout[];
  upstream?: UpstreamResult;
  explorer: string;
  pieceUnlocks: number;
  pieceTotalPaidUSDC: string;
  /** Gated content, returned only when an entitled `reader` sponsored the unlock. */
  content?: string | null;
}

/** True when the in-app live agent can actually settle on Arc. */
export function liveAgentReady(): boolean {
  return config.liveX402 && Boolean(relayerAccount && relayerWallet && config.demoAgentPrivateKey);
}

/** Relayer USDC balance (6dp), cached for RELAYER_BAL_TTL_MS to spare the RPC. */
async function relayerUsdc6(now = Date.now()): Promise<bigint> {
  if (!relayerAccount) return 0n;
  if (_relayerBalCache && now - _relayerBalCache.at < RELAYER_BAL_TTL_MS) return _relayerBalCache.bal6;
  const bal6 = await usdc6(relayerAccount.address);
  _relayerBalCache = { at: now, bal6 };
  return bal6;
}

export interface RelayerStatus {
  /** True when live settlement is wired (relayer + demo agent + LIVE_X402). */
  ready: boolean;
  /** Relayer USDC balance on Arc, as a display string. */
  balanceUSDC: string;
  /** True when the balance has dropped near empty — top up at the Circle faucet. */
  low: boolean;
}

/**
 * Live-settlement health: is the relayer funded enough to keep paying creators?
 * Cheap (cached) so the storefront can poll it and warn before the URL silently
 * fails. Returns ready:false in mirror mode (no relayer) — there's nothing to warn.
 */
export async function liveRelayerStatus(now = Date.now()): Promise<RelayerStatus> {
  if (!liveAgentReady()) return { ready: false, balanceUSDC: "0", low: false };
  const bal6 = await relayerUsdc6(now).catch(() => 0n);
  return { ready: true, balanceUSDC: formatUsdc6(bal6), low: bal6 < RELAYER_LOW_6 };
}

/**
 * Pay for a piece on-chain as the autonomous demo agent. Returns the real Arc
 * tx hashes for the payment and each contributor payout.
 *
 * When `opts.reader` is supplied (a stable per-browser id), the relayer is
 * sponsoring a real human's unlock: we grant that reader a durable entitlement
 * and hand back the gated content, so the human keeps access on return visits
 * without ever needing a wallet. The on-chain money still moves for real.
 */
export async function payLiveForPiece(
  store: Store,
  piece: Piece,
  opts: { reader?: string; input?: Record<string, unknown> } = {},
): Promise<LiveAgentResult> {
  if (!config.liveX402) throw new Error("LIVE_X402 is not enabled");
  if (!relayerAccount || !relayerWallet) throw new Error("relayer wallet not configured");
  const { account: agent, wallet } = agentWallet();
  const payTo = relayerAccount.address;

  // 0) Fail fast with an actionable message if the relayer can't cover this
  // settlement (it funds agent top-ups + gas). Beats a cryptic on-chain revert.
  const relayerBal6 = await relayerUsdc6();
  if (relayerBal6 < piece.price6 + RELAYER_GAS_BUFFER_6) {
    throw new Error(
      "Relayer is out of Arc test USDC — top up at https://faucet.circle.com (Arc Testnet) before settling",
    );
  }

  // 1) Top the agent up from the relayer if needed (real tx, only when low).
  if ((await usdc6(agent.address)) < LOW_BALANCE_6) {
    const topup = await relayerWallet.sendTransaction({
      account: relayerAccount,
      chain: arcTestnet,
      to: agent.address,
      value: TOPUP_18,
    });
    await publicClient.waitForTransactionReceipt({ hash: topup });
  }

  // 2) Agent signs + sends a real USDC payment to payTo on Arc.
  const paymentTx = await wallet.writeContract({
    account: agent,
    chain: arcTestnet,
    address: USDC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [payTo as `0x${string}`, piece.price6],
  });
  await publicClient.waitForTransactionReceipt({ hash: paymentTx });

  // 3) Verify the payment landed on-chain before paying anyone out.
  const verified = await verifyArcUsdcPayment(paymentTx, payTo, piece.price6);
  if (!verified.ok) throw new Error(`payment verification failed: ${verified.reason}`);

  // 4) Pay each contributor their split in real USDC on Arc.
  const shares6 = computeSplit(piece.price6, piece.contributors);
  const payouts = await payContributorsOnArc(piece.contributors, shares6);
  // This settlement moved relayer funds (top-up + gas) — refresh on next read.
  _relayerBalCache = undefined;

  // 5) Record traction (counter + verifiable on-chain ledger); proxy upstream.
  store.recordUnlock(piece.id, piece.price6);
  store.recordOnchainSettlement({
    pieceId: piece.id,
    title: piece.title,
    kind: piece.kind,
    price6: piece.price6,
    payer: agent.address,
    paymentTx,
    payouts: payouts
      .filter((p) => p.status === "paid" && p.txHash)
      .map((p) => ({ role: p.role, address: p.address, share6: BigInt(p.share6), txHash: p.txHash! })),
    at: new Date().toISOString(),
  });
  const upstream = piece.kind === "api" ? await proxyUpstream(piece, opts.input) : undefined;

  // When a human sponsored this unlock, key the entitlement to their browser id
  // so they keep access on return visits (the on-chain payer is the relayer/agent,
  // but the *reader* is who we remember).
  if (opts.reader) store.grantEntitlement(piece.id, opts.reader);
  // The buyer is the human reader when sponsored, else the autonomous agent.
  // This unlock settled REAL USDC on Arc, so it counts as a real buyer (the
  // numerator of reader-to-payer conversion), never a simulated one.
  store.recordBuyer(opts.reader ?? agent.address);
  store.recordRealBuyer(opts.reader ?? agent.address);
  const updated = store.getPiece(piece.id)!;

  return {
    mode: "live-arc",
    agent: agent.address,
    paidTo: payTo,
    paymentTx,
    priceUSDC: formatUsdc6(piece.price6),
    payouts,
    upstream,
    explorer: ARC_TESTNET.explorer,
    pieceUnlocks: updated.unlocks,
    pieceTotalPaidUSDC: formatUsdc6(updated.totalPaid6),
    content: opts.reader && piece.kind !== "api" ? piece.content ?? null : null,
  };
}

/** A contributor leg of a sponsored unlock, normalized across live & simulated. */
export interface SponsoredPayout {
  role: string;
  address: string;
  targetChain: string;
  shareUSDC: string;
  /** Real Arc tx hash (live) or simulated settlement hash; null if skipped. */
  txHash: string | null;
  status: "paid" | "skipped";
  reason?: string;
}

/**
 * The receipt for a relayer-SPONSORED unlock — the walletless buy path. The
 * platform relayer covers the payment so a reader with no wallet (e.g. a phone
 * browser) can still buy a piece; access is remembered against their browser id.
 */
export interface SponsoredUnlockResult {
  /** "live-arc" = real USDC moved on Arc; "simulated" = mirror-mode settlement. */
  mode: "live-arc" | "simulated";
  pieceId: string;
  reader: string;
  priceUSDC: string;
  /** Real Arc payment tx hash when live; null in simulated mode. */
  paymentTx: string | null;
  explorer: string;
  payouts: SponsoredPayout[];
  /** The gated content the reader just unlocked (null for "api" pieces). */
  content: string | null;
  pieceUnlocks: number;
  pieceTotalPaidUSDC: string;
}

/**
 * Unlock a piece on the reader's behalf, paid for by the platform relayer.
 *
 * This is the no-wallet buy path the mobile UI uses: when the live relayer is
 * funded (`liveAgentReady`) the money moves for real on Arc; otherwise it falls
 * back to mirror-mode simulated settlement so the demo always works with zero
 * keys. Either way the reader gets a durable, remembered entitlement keyed to
 * their browser id and the gated content is returned.
 */
export async function sponsoredUnlock(
  store: Store,
  piece: Piece,
  reader: string,
): Promise<SponsoredUnlockResult> {
  if (liveAgentReady()) {
    const live = await payLiveForPiece(store, piece, { reader });
    return {
      mode: "live-arc",
      pieceId: piece.id,
      reader,
      priceUSDC: live.priceUSDC,
      paymentTx: live.paymentTx,
      explorer: live.explorer,
      payouts: live.payouts.map((p, i) => ({
        role: p.role,
        address: p.address,
        targetChain: piece.contributors[i]?.targetChain ?? "arc",
        shareUSDC: formatUsdc6(BigInt(p.share6)),
        txHash: p.txHash,
        status: p.status,
        reason: p.reason,
      })),
      content: live.content ?? null,
      pieceUnlocks: live.pieceUnlocks,
      pieceTotalPaidUSDC: live.pieceTotalPaidUSDC,
    };
  }

  // No silent fakes in live mode: if we INTEND to be live (LIVE_X402 is set) but
  // the relayer/demo-agent wallet isn't fully wired, refuse rather than quietly
  // settling a simulated payment that would read as real. Mirror-mode simulation
  // is ONLY for zero-key local dev (LIVE_X402 unset).
  if (config.liveX402) {
    throw new Error(
      "LIVE_X402 is set but the relayer/demo-agent wallet is not fully configured — refusing to simulate a payment in live mode",
    );
  }

  // Mirror-mode fallback (zero-key local dev): simulated settlement, clearly
  // labeled (mode: "simulated"), with the same remembered entitlement.
  const sim = await payForPiece(store, piece, { payer: reader });
  return {
    mode: "simulated",
    pieceId: piece.id,
    reader,
    priceUSDC: formatUsdc6(BigInt(sim.price6)),
    paymentTx: null,
    explorer: ARC_TESTNET.explorer,
    payouts: sim.contributors.map((c) => ({
      role: c.role,
      address: c.recipientAddress,
      targetChain: c.targetChain,
      shareUSDC: formatUsdc6(BigInt(c.share6)),
      txHash: c.settlement.destinationTxHash,
      status: "paid",
    })),
    content: sim.content,
    pieceUnlocks: sim.pieceUnlocks,
    pieceTotalPaidUSDC: sim.pieceTotalPaid6
      ? formatUsdc6(BigInt(sim.pieceTotalPaid6))
      : "0",
  };
}
