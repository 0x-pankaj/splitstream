/**
 * viem clients for Arc Testnet. A public client is always available for reads;
 * a wallet client (relayer) is created only when a private key is configured,
 * gating real on-chain writes.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@arcane/shared";
import { config } from "../config.js";

export const publicClient: PublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.rpcHttp),
});

let _relayerAccount: Account | undefined;
let _walletClient: WalletClient | undefined;

if (config.relayerPrivateKey) {
  _relayerAccount = privateKeyToAccount(config.relayerPrivateKey);
  _walletClient = createWalletClient({
    account: _relayerAccount,
    chain: arcTestnet,
    transport: http(config.rpcHttp),
  });
}

export const relayerAccount = _relayerAccount;
export const walletClient = _walletClient;

/** True when the engine can sign + send Arc L1 transactions. */
export function hasRelayer(): boolean {
  return Boolean(_walletClient && _relayerAccount);
}
