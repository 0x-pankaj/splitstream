/**
 * Real CCTP bridging via Circle App Kit's Bridge + Forwarding Service.
 *
 * Burns USDC on Arc (signed by the relayer) and has Circle's Forwarding Service
 * mint native USDC on the destination chain to the recipient — no destination
 * wallet, no destination gas, no kit key required. App Kit is loaded lazily so
 * it never affects the simulated path or the test suite.
 */

import type { TargetChain } from "@arcane/shared";
import { config } from "../config.js";

/** Map our target chains to App Kit testnet chain identifiers. */
const APPKIT_CHAIN: Partial<Record<TargetChain, string>> = {
  base: "Base_Sepolia",
  ethereum: "Ethereum_Sepolia",
  arbitrum: "Arbitrum_Sepolia",
  // Arc (EVM source) → Solana via the Forwarding Service: only the source
  // adapter is needed; Circle fetches the attestation and submits the Solana
  // mint. IMPORTANT: for Solana the `recipient` MUST be a USDC token account
  // (ATA), not a raw wallet address — minting to a non-token account fails.
  solana: "Solana_Devnet",
};

export function bridgeSupported(chain: TargetChain): boolean {
  return chain in APPKIT_CHAIN;
}

export interface BridgeResult {
  burnTxHash: string | undefined;
  mintTxHash: string | undefined;
  forwarded: boolean;
}

// Cached SDK handles (App Kit + viem adapter), created on first real bridge.
let kit:
  | { bridge: (args: unknown) => Promise<{ state?: string; steps?: BridgeStep[] }> }
  | undefined;
let adapter: unknown;

interface BridgeStep {
  name: string;
  state?: string;
  txHash?: string;
  error?: string;
  forwarded?: boolean;
}

async function ensureKit(): Promise<void> {
  if (kit && adapter) return;
  if (!config.relayerPrivateKey) throw new Error("relayer key required for live bridge");
  const appKitMod = (await import("@circle-fin/app-kit")) as {
    AppKit: new () => typeof kit & object;
  };
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as {
    createViemAdapterFromPrivateKey: (o: { privateKey: string }) => unknown;
  };
  kit = new appKitMod.AppKit() as never;
  adapter = adapterMod.createViemAdapterFromPrivateKey({
    privateKey: config.relayerPrivateKey,
  });
}

/**
 * Bridge `amountHuman` USDC from Arc Testnet to `destChain`, minting to
 * `recipient` via the Forwarding Service. Returns the real burn (Arc) and mint
 * (destination) tx hashes.
 */
export async function bridgeUsdcFromArc(input: {
  amountHuman: string;
  recipient: string;
  destChain: TargetChain;
}): Promise<BridgeResult> {
  const chain = APPKIT_CHAIN[input.destChain];
  if (!chain) throw new Error(`unsupported bridge destination: ${input.destChain}`);
  await ensureKit();

  const result = await kit!.bridge({
    from: { adapter, chain: "Arc_Testnet" },
    to: { recipientAddress: input.recipient, chain, useForwarder: true },
    amount: input.amountHuman,
  });

  const steps = result.steps ?? [];

  // CCTP can "soft fail": the call resolves with a result whose state is "error"
  // and a failed step, instead of throwing. Treat that as a hard failure so the
  // caller surfaces it loudly rather than reporting a live-but-unsettled payout.
  const failed = steps.find((s) => s.state === "error");
  if (result.state === "error" || failed) {
    throw new Error(
      `CCTP bridge failed at ${failed?.name ?? "unknown step"}: ${
        failed?.error ?? "transfer did not reach success state"
      }`,
    );
  }

  const burn = steps.find((s) => s.name === "burn");
  const mint = steps.find((s) => s.name === "mint");
  if (!burn?.txHash) {
    throw new Error("CCTP bridge returned no burn tx hash");
  }
  return {
    burnTxHash: burn.txHash,
    mintTxHash: mint?.txHash,
    forwarded: Boolean(mint?.forwarded),
  };
}
