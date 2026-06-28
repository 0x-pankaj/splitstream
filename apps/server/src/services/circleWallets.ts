/**
 * Circle Developer-Controlled Wallets — custodial USDC wallets on Arc, one per
 * creator, provisioned with just an email (no MetaMask, no seed phrase, no KYC).
 *
 * The headline production unlock for SplitStream: a creator's assigned wallet
 * address becomes their payout address, so every revenue split lands in a real
 * wallet they can see and withdraw from. This is the literal RFB-06 metric
 * ("creators earning") made self-serve.
 *
 * Flow (per Circle's "pre-create wallets" guide):
 *   1. ensureWalletPool   — createWallets({ count }) ahead of time (no metadata)
 *   2. provisionCreatorWallet — pop a pool wallet + updateWallet({ name, refId })
 *      to assign it instantly on signup (or create one on demand if the pool is dry)
 *   3. getWalletBalance6 / createWithdrawal — show + move the creator's USDC
 *
 * The Circle SDK is dynamic-imported and the whole module is gated on
 * `config.circleWallets`, so zero-key local dev still boots: there, a creator gets
 * a clearly-labeled `local-dev` wallet (a throwaway EVM address, stable once
 * stored) so the end-to-end flow is demoable without real custody.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseUsdc6 } from "@arcane/shared";
import { config } from "../config.js";
import type { Store } from "../db/store.js";

/** Which custody backend produced a creator's payout wallet. */
export type WalletProvider = "circle" | "local-dev" | "byo";

export interface ProvisionedWallet {
  walletId: string;
  address: string;
  provider: WalletProvider;
}

/** True when real Circle developer-controlled wallets are configured. */
export function circleWalletsReady(): boolean {
  return Boolean(config.circleWallets);
}

// ── Circle SDK client (memoized, dynamic-imported) ──────────────────────────

type CircleClient = {
  createWallets: (input: {
    walletSetId: string;
    blockchains: string[];
    count: number;
    accountType?: string;
  }) => Promise<{ data?: { wallets?: Array<{ id: string; address: string }> } }>;
  updateWallet: (input: {
    id: string;
    name?: string;
    refId?: string;
  }) => Promise<{ data?: { wallet?: { id: string; address: string } } }>;
  getWalletTokenBalance: (input: {
    id: string;
  }) => Promise<{
    data?: { tokenBalances?: Array<{ amount: string; token: { id: string; symbol?: string } }> };
  }>;
  createTransaction: (input: {
    walletId: string;
    tokenId: string;
    destinationAddress: string;
    amount: string[];
    fee: { type: "level"; config: { feeLevel: "LOW" | "MEDIUM" | "HIGH" } };
  }) => Promise<{ data?: { id?: string; state?: string } }>;
};

let _client: CircleClient | undefined;

async function getClient(): Promise<CircleClient> {
  const creds = config.circleWallets;
  if (!creds) throw new Error("Circle developer-controlled wallets are not configured");
  if (!_client) {
    const mod = await import("@circle-fin/developer-controlled-wallets");
    _client = mod.initiateDeveloperControlledWalletsClient({
      apiKey: creds.apiKey,
      entitySecret: creds.entitySecret,
    }) as unknown as CircleClient;
  }
  return _client;
}

/** The Arc Testnet blockchain id Circle uses for wallet creation. */
const ARC_BLOCKCHAIN = "ARC-TESTNET";

/**
 * Pre-create a pool of unassigned Arc wallets so signups are instant. No-ops when
 * Circle isn't configured or the pool already holds at least `minCount`. Pool
 * wallets carry no metadata until assigned (per Circle's pre-create guidance).
 */
export async function ensureWalletPool(store: Store, minCount: number): Promise<number> {
  if (!circleWalletsReady()) return 0;
  const have = store.circleWalletPoolSize();
  if (have >= minCount) return have;
  const need = Math.min(minCount - have, 200); // Circle caps createWallets at 200
  const client = await getClient();
  const res = await client.createWallets({
    walletSetId: config.circleWallets!.walletSetId,
    blockchains: [ARC_BLOCKCHAIN],
    count: need,
    accountType: "EOA",
  });
  const wallets = res.data?.wallets ?? [];
  store.pushCircleWallets(wallets.map((w) => ({ id: w.id, address: w.address })));
  return store.circleWalletPoolSize();
}

/**
 * Assign a payout wallet to a creator. With Circle configured, pops a pre-created
 * pool wallet (creating one on demand if the pool is dry) and stamps it with the
 * creator's name + refId. Otherwise mints a labeled local-dev EVM address so the
 * flow is fully demoable with zero keys.
 */
export async function provisionCreatorWallet(
  store: Store,
  opts: { creatorId: string; label: string },
): Promise<ProvisionedWallet> {
  if (!circleWalletsReady()) {
    // Zero-key dev: a stable throwaway EVM address (no custody, clearly labeled).
    const address = privateKeyToAccount(generatePrivateKey()).address;
    return { walletId: `dev-${opts.creatorId}`, address, provider: "local-dev" };
  }

  const client = await getClient();
  let pooled = store.popCircleWallet();
  if (!pooled) {
    // Pool exhausted — create one wallet on demand so signup never blocks.
    const res = await client.createWallets({
      walletSetId: config.circleWallets!.walletSetId,
      blockchains: [ARC_BLOCKCHAIN],
      count: 1,
      accountType: "EOA",
    });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error("Circle createWallets returned no wallet");
    pooled = { id: w.id, address: w.address };
  }

  await client.updateWallet({ id: pooled.id, name: opts.label, refId: opts.creatorId });
  return { walletId: pooled.id, address: pooled.address, provider: "circle" };
}

/** USDC balance (6dp) of a Circle wallet. Returns 0 for dev/BYO wallets. */
export async function getWalletBalance6(walletId: string): Promise<bigint> {
  if (!circleWalletsReady() || walletId.startsWith("dev-")) return 0n;
  const client = await getClient();
  const res = await client.getWalletTokenBalance({ id: walletId });
  const usdc = (res.data?.tokenBalances ?? []).find(
    (b) => (b.token.symbol ?? "").toUpperCase().startsWith("USDC"),
  );
  if (!usdc) return 0n;
  // Circle returns a human amount string (e.g. "1.23"); convert to 6dp base units.
  return parseUsdc6(Number(usdc.amount).toFixed(6));
}

export interface WithdrawalResult {
  /** Circle transaction id, when a real transfer was initiated. */
  transactionId: string;
  state: string;
}

/**
 * Withdraw USDC from a creator's Circle wallet to an external EVM address. Real
 * Circle wallets only — dev/BYO wallets throw (there is no custodial balance to
 * move). `amount6` is 6dp USDC base units.
 */
export async function createWithdrawal(
  walletId: string,
  to: string,
  amount6: bigint,
): Promise<WithdrawalResult> {
  if (!circleWalletsReady() || walletId.startsWith("dev-")) {
    throw new Error("Withdrawals require a real Circle wallet (live mode)");
  }
  const client = await getClient();
  const balances = await client.getWalletTokenBalance({ id: walletId });
  const usdc = (balances.data?.tokenBalances ?? []).find(
    (b) => (b.token.symbol ?? "").toUpperCase().startsWith("USDC"),
  );
  if (!usdc) throw new Error("No USDC token balance on this wallet");
  // amount6 → human string with 6dp (Circle expects human units).
  const human = (Number(amount6) / 1_000_000).toFixed(6);
  const res = await client.createTransaction({
    walletId,
    tokenId: usdc.token.id,
    destinationAddress: to,
    amount: [human],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  return { transactionId: res.data?.id ?? "", state: res.data?.state ?? "INITIATED" };
}
