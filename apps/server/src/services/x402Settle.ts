/**
 * Real on-chain x402 settlement on Arc — the "real money" path.
 *
 * Two legs, both settling actual USDC on Arc Testnet when LIVE_X402 is enabled:
 *   1. verifyArcUsdcPayment — read the agent's payment tx on Arc and confirm a
 *      real USDC transfer of >= the price landed at the platform's payTo address.
 *      Nothing is served until this passes (real money in).
 *   2. payContributorsOnArc — the relayer transfers each contributor their split
 *      share in real USDC on Arc, so the API owner actually gets paid (money out).
 *
 * Solana contributors can't receive on Arc; on the Arc-native devnet payout path
 * they're reported as skipped (route them cross-chain via the CCTP path instead).
 * EVM addresses (base/arbitrum/ethereum/arc) are valid Arc recipients and are paid.
 */

import { parseEventLogs, type Hash } from "viem";
import { USDC, formatUsdc6, type Contributor } from "@arcane/shared";
import { publicClient, walletClient, relayerAccount } from "../chain/arc.js";
import { arcTestnet } from "@arcane/shared";
import { erc20Abi } from "../chain/abis.js";

const isEvm = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr);

/**
 * Serialize every relayer-signed send. The relayer is a single EOA, so two
 * concurrent settlements (or a fast loop of payouts) must not race for the same
 * nonce — that yields "replacement transaction underpriced". This promise chain
 * runs relayer batches one at a time; combined with explicit nonce sequencing
 * below, every transfer gets a distinct, monotonic nonce.
 */
let relayerQueue: Promise<unknown> = Promise.resolve();
function withRelayerLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = relayerQueue.then(fn, fn);
  relayerQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export interface PaymentVerification {
  ok: boolean;
  reason?: string;
  /** The on-chain payer (Transfer `from`). */
  from: string | null;
  /** USDC amount actually received at payTo (6dp). */
  received6: bigint;
}

/**
 * Verify a real USDC payment on Arc: the tx must have succeeded and emitted a
 * USDC `Transfer` to `payTo` for at least `amount6`. Read-only — safe to run
 * with just the public client (no funds needed).
 */
export async function verifyArcUsdcPayment(
  txHash: string,
  payTo: string,
  amount6: bigint,
): Promise<PaymentVerification> {
  const fail = (reason: string): PaymentVerification => ({ ok: false, reason, from: null, received6: 0n });

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return fail("authorization must be a 0x tx hash for live x402 settlement");
  }

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });
  } catch {
    return fail("payment tx not found on Arc");
  }
  if (receipt.status !== "success") return fail("payment tx reverted on Arc");

  let logs;
  try {
    logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  } catch {
    return fail("could not decode transfer logs from payment tx");
  }

  const want = payTo.toLowerCase();
  const usdc = USDC.toLowerCase();
  const match = logs.find(
    (l) =>
      l.address.toLowerCase() === usdc &&
      (l.args.to as string).toLowerCase() === want &&
      (l.args.value as bigint) >= amount6,
  );
  if (!match) {
    return fail(`no USDC transfer of >= ${formatUsdc6(amount6)} to ${payTo} found in tx`);
  }

  return { ok: true, from: (match.args.from as string) ?? null, received6: match.args.value as bigint };
}

export interface OnArcPayout {
  role: string;
  address: string;
  share6: string;
  /** Real Arc tx hash for the USDC transfer, or null if skipped. */
  txHash: string | null;
  status: "paid" | "skipped";
  reason?: string;
}

/**
 * Pay each contributor their split share in REAL USDC on Arc, from the relayer.
 * Requires a configured wallet client. EVM addresses are paid on Arc; non-EVM
 * (Solana) recipients are reported skipped for the Arc-native path.
 */
export async function payContributorsOnArc(
  contributors: Contributor[],
  shares6: bigint[],
): Promise<OnArcPayout[]> {
  const wallet = walletClient;
  const relayer = relayerAccount;
  if (!wallet || !relayer) {
    throw new Error("LIVE_X402 requires a configured relayer wallet");
  }
  return withRelayerLock(async () => {
    const payouts: OnArcPayout[] = [];
    // Fetch the relayer's next nonce ONCE, then assign explicitly and increment
    // per actually-sent tx. This avoids the node's pending-count lag handing two
    // back-to-back transfers the same nonce ("replacement transaction underpriced").
    let nonce = await publicClient.getTransactionCount({
      address: relayer.address,
      blockTag: "pending",
    });
    for (let i = 0; i < contributors.length; i++) {
      const c = contributors[i]!;
      const share6 = shares6[i]!;
      if (!isEvm(c.address)) {
        payouts.push({
          role: c.role,
          address: c.address,
          share6: share6.toString(),
          txHash: null,
          status: "skipped",
          reason: "non-EVM address — route cross-chain via CCTP for this contributor",
        });
        continue;
      }
      const txHash = await wallet.writeContract({
        account: relayer,
        chain: arcTestnet,
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [c.address as `0x${string}`, share6],
        nonce,
      });
      nonce += 1;
      payouts.push({ role: c.role, address: c.address, share6: share6.toString(), txHash, status: "paid" });
    }
    return payouts;
  });
}
