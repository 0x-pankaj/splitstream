/**
 * Real wallet payments from the browser. A reader connects an injected EVM
 * wallet (MetaMask, etc.), pays a piece price in real USDC on Arc to the platform
 * payTo, and the server verifies that tx before granting access. No SDK — just
 * the EIP-1193 provider plus viem for ABI encoding.
 */

import { encodeFunctionData, type Hex } from "viem";
import { ARC_TESTNET } from "@arcane/shared";

/** Arc Testnet network params for `wallet_addEthereumChain`. USDC is the gas token. */
export const ARC_NETWORK = {
  chainId: ARC_TESTNET.chainId,
  chainIdHex: `0x${ARC_TESTNET.chainId.toString(16)}`,
  chainName: ARC_TESTNET.name,
  rpcUrl: ARC_TESTNET.rpcHttp,
  explorer: ARC_TESTNET.explorer,
  currency: { name: "USDC", symbol: "USDC", decimals: 18 },
} as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
}

function getProvider(): Eip1193Provider {
  const eth = typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum : undefined;
  if (!eth) throw new Error("No Ethereum wallet found — install MetaMask (or any injected wallet) to pay with real USDC.");
  // When several wallet extensions are installed they expose an array; the one
  // bound to `window.ethereum` may be a different (non-popping) wallet. Prefer
  // MetaMask, else the first injected provider — this is the usual cause of
  // "confirm in your wallet" with no popup.
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0]!;
  }
  return eth;
}

/** Turn a raw wallet/provider error into something actionable for the reader. */
export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number; message?: string } | undefined;
  switch (e?.code) {
    case 4001:
      return "You rejected the request in your wallet.";
    case -32002:
      return "A wallet request is already open — click your wallet extension icon to finish or dismiss it, then try again.";
    case 4900:
    case 4901:
      return "Your wallet is disconnected — open the extension, unlock it, and connect to this site.";
    default:
      return e?.message || "Wallet request failed. Open your wallet extension (make sure it's unlocked) and try again.";
  }
}

/** True if an injected wallet is present. */
export function hasWallet(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

/** One-click: add Arc Testnet to the user's wallet (most people don't have it). */
export async function addArcToWallet(): Promise<void> {
  const eth = getProvider();
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: ARC_NETWORK.chainIdHex,
        chainName: ARC_NETWORK.chainName,
        nativeCurrency: ARC_NETWORK.currency,
        rpcUrls: [ARC_NETWORK.rpcUrl],
        blockExplorerUrls: [ARC_NETWORK.explorer],
      },
    ],
  });
}

/** The currently-connected address, if the wallet has already been authorized. */
export async function connectedAddress(): Promise<string | null> {
  if (!hasWallet()) return null;
  try {
    const accounts = (await getProvider().request({ method: "eth_accounts" })) as string[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

/** The wallet's currently-selected chain id (decimal), or null. */
export async function connectedChainId(): Promise<number | null> {
  if (!hasWallet()) return null;
  try {
    const hex = (await getProvider().request({ method: "eth_chainId" })) as string;
    return Number.parseInt(hex, 16);
  } catch {
    return null;
  }
}

interface Eip1193ProviderWithEvents extends Eip1193Provider {
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Subscribe to wallet account / network changes — fires `cb` whenever the user
 * switches the active account or chain in their wallet, so the UI can show which
 * account is about to pay. Returns an unsubscribe fn (no-op if events aren't
 * supported).
 */
export function onWalletChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const eth = (window as unknown as { ethereum?: Eip1193ProviderWithEvents }).ethereum;
  if (!eth?.on || !eth.removeListener) return () => {};
  const handler = () => cb();
  eth.on("accountsChanged", handler);
  eth.on("chainChanged", handler);
  return () => {
    eth.removeListener?.("accountsChanged", handler);
    eth.removeListener?.("chainChanged", handler);
  };
}

// Remember the wallet a reader last paid from — a plain string in localStorage —
// so we can re-check entitlements on load WITHOUT ever touching the wallet (no
// connect popup on refresh). Set only after an explicit, user-initiated payment.
const PAID_WALLET_KEY = "splitstream_wallet";

export function rememberWallet(address: string): void {
  if (typeof window !== "undefined" && address) {
    window.localStorage.setItem(PAID_WALLET_KEY, address.toLowerCase());
  }
}

export function rememberedWallet(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PAID_WALLET_KEY);
}

/** First line of the ownership message — MUST match the server's OWNERSHIP_DOMAIN. */
const OWNERSHIP_DOMAIN =
  "SplitStream: prove wallet ownership to restore your unlocked content.";

/** Build the exact message the wallet signs to prove it controls `address`. */
export function buildOwnershipMessage(address: string, issuedISO: string): string {
  return `${OWNERSHIP_DOMAIN}\n\nWallet: ${address}\nIssued: ${issuedISO}`;
}

/** Prompt the wallet to connect and return the selected address. */
export async function connectWallet(): Promise<string> {
  const eth = getProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("No wallet account selected.");
  return address;
}

/**
 * Prove ownership of the connected wallet by signing a fresh, timestamped message
 * (gasless — no chain switch, no fee). The server recovers the signer from this
 * to return the wallet's unlocked content ("restore purchases"). Returns the
 * exact (address, message, signature) triple the server needs.
 */
export async function signOwnership(): Promise<{ address: string; message: string; signature: string }> {
  const eth = getProvider();
  const address = await connectWallet();
  const message = buildOwnershipMessage(address, new Date().toISOString());
  const signature = (await eth.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return { address, message, signature };
}

export interface PayParams {
  payTo: string;
  usdc: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  /** Price in 6dp USDC base units, as a string (e.g. "50000" for $0.05). */
  price6: string;
}

/**
 * Pay `price6` USDC to `payTo` on Arc from the connected wallet. Ensures the
 * wallet is on Arc (adds the chain if missing), sends the ERC-20 transfer, waits
 * for the receipt, and returns the tx hash + payer address.
 */
export async function payPieceOnchain(p: PayParams): Promise<{ txHash: string; from: string }> {
  const eth = getProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("No wallet account selected.");

  const chainIdHex = `0x${p.chainId.toString(16)}`;
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() !== chainIdHex.toLowerCase()) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      // 4902 = chain not added to the wallet yet.
      if ((err as { code?: number })?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: "Arc Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [p.rpcUrl],
              blockExplorerUrls: [p.explorer],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [p.payTo as Hex, BigInt(p.price6)],
  });
  const txHash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: p.usdc, data }],
  })) as string;

  // Arc finalizes sub-second; poll briefly for the receipt before we hand the
  // hash to the server to verify.
  for (let i = 0; i < 30; i++) {
    const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] })) as
      | { status?: string }
      | null;
    if (receipt) {
      if (receipt.status && receipt.status !== "0x1") throw new Error("payment transaction reverted on Arc");
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { txHash, from };
}
