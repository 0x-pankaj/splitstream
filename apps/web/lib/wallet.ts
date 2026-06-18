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
}

function getProvider(): Eip1193Provider {
  const eth = typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum : undefined;
  if (!eth) throw new Error("No Ethereum wallet found — install MetaMask (or any injected wallet) to pay with real USDC.");
  return eth;
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
