/**
 * Real Circle Gateway settlement via App Kit's Unified Balance.
 *
 * The platform keeps a working USDC float in its Gateway unified balance on Arc
 * (topped up with `kit.unifiedBalance.deposit({ from: { adapter, chain:
 * "Arc_Testnet" }, amount })`). An instant payout spends from that Arc-side
 * balance and the Forwarding Service mints native USDC to the recipient on the
 * destination chain in <500ms — no destination wallet, no destination gas, no
 * kit key. App Kit is loaded lazily so it never affects the simulated path or
 * the test suite.
 */

import type { TargetChain } from "@arcane/shared";
import { config } from "../config.js";

/** Map our target chains to App Kit / Gateway testnet chain identifiers. */
const GATEWAY_CHAIN: Partial<Record<TargetChain, string>> = {
  base: "Base_Sepolia",
  ethereum: "Ethereum_Sepolia",
  arbitrum: "Arbitrum_Sepolia",
  // Solana spends require a USDC token account (ATA) recipient + the Solana
  // adapter; the instant path keeps Solana on the simulated rail for now.
};

/** The unified balance is funded on Arc — every spend draws from this source. */
const SOURCE_CHAIN = "Arc_Testnet";

export function gatewaySupported(chain: TargetChain): boolean {
  return chain in GATEWAY_CHAIN;
}

export interface GatewaySpendResult {
  /** Destination-chain mint tx hash (or forwarder reference) from the SDK. */
  txHash: string | undefined;
  /** Gateway transfer id for support/audit correlation. */
  transferId: string | undefined;
}

// Cached SDK handles (App Kit + viem adapter), created on first real spend.
interface AppKitSpend {
  unifiedBalance: {
    spend: (args: unknown) => Promise<{ txHash?: string; transferId?: string }>;
  };
}
let kit: AppKitSpend | undefined;
let adapter: unknown;

async function ensureKit(): Promise<void> {
  if (kit && adapter) return;
  if (!config.relayerPrivateKey) throw new Error("relayer key required for live Gateway");
  const appKitMod = (await import("@circle-fin/app-kit")) as {
    AppKit: new () => AppKitSpend;
  };
  const adapterMod = (await import("@circle-fin/adapter-viem-v2")) as {
    createViemAdapterFromPrivateKey: (o: { privateKey: string }) => unknown;
  };
  kit = new appKitMod.AppKit();
  adapter = adapterMod.createViemAdapterFromPrivateKey({
    privateKey: config.relayerPrivateKey,
  });
}

/**
 * Spend `amountHuman` USDC from the platform's Arc unified balance, minting to
 * `recipient` on `destChain` via the Forwarding Service. Returns the mint tx
 * hash and the Gateway transfer id. Throws on any failure so the caller can
 * surface it loudly rather than masking it as a simulated settlement.
 */
export async function spendViaGateway(input: {
  amountHuman: string;
  recipient: string;
  destChain: TargetChain;
}): Promise<GatewaySpendResult> {
  const chain = GATEWAY_CHAIN[input.destChain];
  if (!chain) throw new Error(`unsupported Gateway destination: ${input.destChain}`);
  await ensureKit();

  const result = await kit!.unifiedBalance.spend({
    from: {
      adapter,
      allocations: { amount: input.amountHuman, chain: SOURCE_CHAIN },
    },
    to: {
      chain,
      recipientAddress: input.recipient,
      useForwarder: true,
    },
    amount: input.amountHuman,
  });

  return { txHash: result.txHash, transferId: result.transferId };
}
