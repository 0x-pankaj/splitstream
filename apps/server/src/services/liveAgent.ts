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
import { proxyUpstream, type UpstreamResult } from "./splitEngine.js";
import type { Store } from "../db/store.js";

/** Top up the agent when its USDC balance drops below this (6dp). */
const LOW_BALANCE_6 = 50_000n; // $0.05
/** Native-USDC top-up amount (18dp) = $1.00. */
const TOPUP_18 = 1_000_000_000_000_000_000n;

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
}

/** True when the in-app live agent can actually settle on Arc. */
export function liveAgentReady(): boolean {
  return config.liveX402 && Boolean(relayerAccount && relayerWallet && config.demoAgentPrivateKey);
}

/**
 * Pay for a piece on-chain as the autonomous demo agent. Returns the real Arc
 * tx hashes for the payment and each contributor payout.
 */
export async function payLiveForPiece(store: Store, piece: Piece): Promise<LiveAgentResult> {
  if (!config.liveX402) throw new Error("LIVE_X402 is not enabled");
  if (!relayerAccount || !relayerWallet) throw new Error("relayer wallet not configured");
  const { account: agent, wallet } = agentWallet();
  const payTo = relayerAccount.address;

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
  const upstream = piece.kind === "api" ? await proxyUpstream(piece) : undefined;
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
  };
}
