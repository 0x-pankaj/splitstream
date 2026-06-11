/**
 * viem chain definition for Arc Testnet.
 *
 * Arc is fully EVM-compatible (Prague hard fork target) and uses USDC as the
 * native gas token. The native currency is represented with 18 decimals
 * internally (like ETH/wei), while the linked ERC-20 interface at `USDC` uses
 * 6 decimals. We model the native currency with 18 decimals here so viem builds
 * EIP-1559 (type-2) transactions correctly; value math elsewhere uses 6dp.
 */

import { defineChain } from "viem";
import { ARC_TESTNET } from "./addresses.js";

export const arcTestnet = defineChain({
  id: ARC_TESTNET.chainId,
  name: ARC_TESTNET.name,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [ARC_TESTNET.rpcHttp],
      webSocket: [ARC_TESTNET.rpcWs],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: ARC_TESTNET.explorer,
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: true,
});
