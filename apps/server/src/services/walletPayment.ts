/**
 * Real human payment — the flow that makes "you paid" cryptographically true.
 *
 * A reader connects a wallet and sends real USDC on Arc to the platform payTo.
 * Here we VERIFY that on-chain payment, then:
 *   1. grant an entitlement keyed to the on-chain payer (their wallet address) —
 *      portable, unspoofable identity, not a guessable browser id;
 *   2. fan the price out to every contributor in real USDC on Arc (the split);
 *   3. record it on the verifiable traction ledger and hand back the content.
 *
 * tx hashes are single-use (anti-replay). Disabled unless LIVE_X402 + a funded
 * relayer are configured (the relayer is the payTo and pays the split out).
 */

import { ARC_TESTNET, USDC, ArcaneError, computeSplit, formatUsdc6, errors, type Piece } from "@arcane/shared";
import { config } from "../config.js";
import { relayerAccount } from "../chain/arc.js";
import { verifyArcUsdcPayment, payContributorsOnArc, type OnArcPayout } from "./x402Settle.js";
import { whitelistContributors } from "./splitEngine.js";
import type { Store } from "../db/store.js";

const badPayment = (msg: string) => new ArcaneError("VALIDATION_FAILED", msg, 400);

/** Whether the real wallet-payment flow is available, plus the params a wallet needs. */
export function walletPaymentInfo() {
  if (!config.liveX402 || !relayerAccount) {
    return { enabled: false as const };
  }
  return {
    enabled: true as const,
    /** Where the reader sends USDC (the platform settlement wallet). */
    payTo: relayerAccount.address as string,
    /** USDC ERC-20 on Arc (6dp). */
    usdc: USDC as string,
    chainId: ARC_TESTNET.chainId,
    rpcUrl: ARC_TESTNET.rpcHttp,
    explorer: ARC_TESTNET.explorer,
  };
}

export interface WalletClaimResult {
  ok: true;
  /** The verified on-chain payer (the buyer's wallet) — also the entitlement key. */
  payer: string;
  paymentTx: string;
  priceUSDC: string;
  /** Gated content, delivered now that the real payment is verified. */
  content: string | null;
  payouts: OnArcPayout[];
  explorer: string;
  pieceUnlocks: number;
}

/**
 * Verify a reader's real USDC payment for a piece and, on success, grant a
 * wallet-keyed entitlement and settle the split to contributors on Arc.
 */
export async function claimWalletPayment(
  store: Store,
  piece: Piece,
  txHash: string,
): Promise<WalletClaimResult> {
  if (!config.liveX402 || !relayerAccount) {
    throw errors.internal("real wallet payments are not enabled (need LIVE_X402 + a funded relayer)");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw badPayment("a 0x transaction hash is required");
  }
  const key = txHash.toLowerCase();
  if (store.x402SettledTxHashes.has(key)) {
    throw badPayment("this payment was already claimed");
  }

  const payTo = relayerAccount.address;
  const verified = await verifyArcUsdcPayment(txHash, payTo, piece.price6);
  if (!verified.ok || !verified.from) {
    throw badPayment(verified.reason ?? "payment could not be verified on Arc");
  }

  // Burn the tx hash (anti-replay) and grant access keyed to the real payer.
  store.x402SettledTxHashes.add(key);
  store.grantEntitlement(piece.id, verified.from);
  store.recordBuyer(verified.from);
  store.recordRealBuyer(verified.from); // real USDC verified on Arc
  whitelistContributors(store, piece);

  // Fan the verified payment out to every contributor in real USDC on Arc.
  const shares6 = computeSplit(piece.price6, piece.contributors);
  const payouts = await payContributorsOnArc(piece.contributors, shares6);

  store.recordUnlock(piece.id, piece.price6);
  store.recordOnchainSettlement({
    pieceId: piece.id,
    title: piece.title,
    kind: piece.kind,
    price6: piece.price6,
    payer: verified.from,
    paymentTx: txHash,
    payouts: payouts
      .filter((p) => p.status === "paid" && p.txHash)
      .map((p) => ({ role: p.role, address: p.address, share6: BigInt(p.share6), txHash: p.txHash! })),
    at: new Date().toISOString(),
  });

  return {
    ok: true,
    payer: verified.from,
    paymentTx: txHash,
    priceUSDC: formatUsdc6(piece.price6),
    content: piece.kind === "api" ? null : piece.content ?? null,
    payouts,
    explorer: ARC_TESTNET.explorer,
    pieceUnlocks: store.getPiece(piece.id)!.unlocks,
  };
}
