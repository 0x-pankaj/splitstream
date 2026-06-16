/**
 * x402 — the HTTP "402 Payment Required" challenge-response flow for paid APIs,
 * the standard AI agents use to pay for a resource in USDC (the same model
 * pay.sh exposes). SplitStream speaks x402 as the facilitator: the seller's API
 * stays a plain origin, and we issue the challenge, verify the payment, settle
 * the cross-chain split, inject the seller's credential, and proxy the call.
 *
 * The wire shape follows the x402 spec so x402-native clients interoperate:
 *   1. Caller hits the resource with no `X-PAYMENT` header.
 *   2. We reply 402 with `{ x402Version, accepts: [PaymentRequirements] }` —
 *      scheme/network/maxAmountRequired/payTo/asset/resource/nonce.
 *   3. Caller pays (USDC on Arc) and retries with a base64 `X-PAYMENT` header
 *      carrying the issued nonce + payer + settlement reference.
 *   4. We verify (single-use nonce; on-chain settlement seam for live mode),
 *      run the paid call, and return 200 with a base64 `X-PAYMENT-RESPONSE`.
 *
 * Mirror mode verifies the nonce we issued (real anti-replay) and treats the
 * settlement reference as proof — the same "works keyless, upgrades live" stance
 * as the rest of the engine. The on-chain verification seam is `verifyOnChain`.
 */

import { randomBytes } from "node:crypto";
import { ARC_TESTNET, USDC, formatUsdc6 } from "@arcane/shared";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import type { Piece } from "@arcane/shared";
import { relayerAccount } from "../chain/arc.js";
import { verifyArcUsdcPayment } from "./x402Settle.js";

/** x402 protocol version this facilitator implements. */
export const X402_VERSION = 1;
/** x402 network identifier for Arc Testnet. */
export const X402_NETWORK = "arc-testnet";
/** How long an issued challenge stays valid. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Demo settlement address used when no platform fee wallet is configured (mirror mode). */
const DEMO_PAY_TO = "0x5pL175734e000000000000000000000000Ca7e".replace(/[^0-9a-fA-F]/g, "0");

/**
 * Where the agent pays. In live x402 mode this MUST be an address the platform
 * controls so it can verify receipt and pay out the split — the relayer. In
 * mirror mode it's the configured fee wallet or a demo address.
 */
function settlementPayTo(): string {
  if (config.liveX402 && relayerAccount) return relayerAccount.address;
  return config.platformFeeWallet ?? config.vaultAddress ?? DEMO_PAY_TO;
}

/** One acceptable way to pay for the resource (x402 `accepts[]` entry). */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Price in atomic USDC units (6dp), as a string. */
  maxAmountRequired: string;
  /** The resource being paid for. */
  resource: string;
  description: string;
  mimeType: string;
  /** Address the payment settles to. */
  payTo: string;
  /** USDC contract on Arc (6dp ERC-20 interface). */
  asset: string;
  maxTimeoutSeconds: number;
  /** Single-use nonce the caller must echo back in X-PAYMENT. */
  nonce: string;
  /** Chain/precision context for clients. */
  extra: { chainId: number; decimals: number; humanAmount: string };
}

export interface PaymentRequiredBody {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

/** Decoded X-PAYMENT payload a caller sends to prove payment. */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    nonce: string;
    /** Payer address (the agent/wallet that paid). */
    from?: string;
    /** Settlement reference — an on-chain tx hash / authorization signature. */
    authorization?: string;
  };
}

/**
 * Build the 402 challenge for a paid API piece and persist its single-use nonce.
 * Returns the body to send with HTTP 402.
 */
export function issueChallenge(store: Store, piece: Piece, now = Date.now()): PaymentRequiredBody {
  const nonce = `0x${randomBytes(16).toString("hex")}`;
  const payTo = settlementPayTo();
  store.putX402Challenge({
    nonce,
    pieceId: piece.id,
    amount6: piece.price6,
    payTo,
    expiresAt: now + CHALLENGE_TTL_MS,
    consumed: false,
  });

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: piece.price6.toString(),
    resource: `/api/v1/pieces/${piece.id}/call`,
    description: `Pay-per-call: ${piece.title}`,
    mimeType: "application/json",
    payTo,
    asset: USDC,
    maxTimeoutSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
    nonce,
    extra: { chainId: ARC_TESTNET.chainId, decimals: 6, humanAmount: `$${formatUsdc6(piece.price6)}` },
  };

  return {
    x402Version: X402_VERSION,
    error: "X-PAYMENT header is required to access this resource",
    accepts: [requirements],
  };
}

/** Decode a base64 `X-PAYMENT` header into a PaymentPayload (or null if malformed). */
export function decodePaymentHeader(header: string | undefined | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json) as PaymentPayload;
    if (!parsed?.payload?.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Encode a settlement result into a base64 `X-PAYMENT-RESPONSE` header value. */
export function encodePaymentResponse(result: {
  success: boolean;
  transaction: string;
  network: string;
  payer: string | null;
}): string {
  return Buffer.from(JSON.stringify(result)).toString("base64");
}

/**
 * On-chain verification. In mirror mode the issued single-use nonce is the gate
 * (no real funds move). When LIVE_X402 is enabled, this verifies a REAL USDC
 * payment on Arc: the `authorization` must be a tx hash whose receipt shows a
 * USDC transfer of >= `amount6` to `payTo`, and that tx hash is redeemed
 * single-use so one payment can't fund two calls.
 */
async function verifyOnChain(
  store: Store,
  payload: PaymentPayload,
  amount6: bigint,
  payTo: string,
): Promise<{ ok: boolean; reason?: string; from?: string | null }> {
  if (!config.liveX402) return { ok: true }; // mirror: nonce redemption is the gate

  const txHash = payload.payload.authorization;
  if (!txHash) return { ok: false, reason: "live x402 requires a settlement tx hash in authorization" };
  if (!store.redeemTxHash(txHash)) return { ok: false, reason: "payment tx already redeemed" };

  const result = await verifyArcUsdcPayment(txHash, payTo, amount6);
  return { ok: result.ok, reason: result.reason, from: result.from };
}

export interface VerifiedPayment {
  ok: boolean;
  reason?: string;
  payer: string | null;
  /** Settlement reference returned to the caller. */
  transaction: string;
  amount6: bigint;
}

/**
 * Verify an X-PAYMENT payload against the issued challenge for a piece. Redeems
 * the nonce single-use, checks scheme/network/amount, and runs the on-chain
 * seam. Returns a structured result; never throws.
 */
export async function verifyPayment(
  store: Store,
  piece: Piece,
  payload: PaymentPayload,
  now = Date.now(),
): Promise<VerifiedPayment> {
  const fail = (reason: string): VerifiedPayment => ({ ok: false, reason, payer: null, transaction: "", amount6: 0n });

  if (payload.scheme !== "exact") return fail(`unsupported scheme "${payload.scheme}"`);
  if (payload.network !== X402_NETWORK) return fail(`wrong network "${payload.network}", expected ${X402_NETWORK}`);

  const redeem = store.redeemX402Challenge(payload.payload.nonce, now);
  if (!redeem.ok) return fail(redeem.reason);
  const challenge = redeem.challenge;

  if (challenge.pieceId !== piece.id) return fail("payment nonce is for a different resource");
  if (challenge.amount6 !== piece.price6) return fail("price changed since challenge was issued");

  const onchain = await verifyOnChain(store, payload, challenge.amount6, challenge.payTo);
  if (!onchain.ok) return fail(onchain.reason ?? "on-chain settlement could not be verified");

  const transaction =
    payload.payload.authorization ?? `x402-${challenge.nonce.slice(2, 18)}`;
  const payer = onchain.from ?? payload.payload.from ?? null;
  return { ok: true, payer, transaction, amount6: challenge.amount6 };
}
