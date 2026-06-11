/**
 * Verified Arc Testnet contract addresses.
 *
 * Every address below is sourced directly from the official Arc documentation
 * (docs.arc.io/arc/references/contract-addresses) and the network configuration
 * pages. Do not edit without re-checking the docs — these drive real on-chain
 * calls and the grant proposal's integration matrix.
 *
 * Mainnet addresses are not yet published by Circle; this product targets the
 * Arc Public Testnet exclusively.
 */

import type { Address } from "viem";

/** Arc Testnet network parameters. */
export const ARC_TESTNET = {
  chainId: 5042002,
  name: "Arc Testnet",
  rpcHttp: "https://rpc.testnet.arc.network",
  rpcWs: "wss://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  /** Circle Cross-Chain Transfer Protocol domain for Arc. */
  cctpDomain: 26,
  /** Required confirmations — Arc has deterministic BFT finality (no reorgs). */
  confirmations: 1,
  /** EIP-1559 base fee floor, in USDC-denominated gwei. */
  minBaseFeeGwei: 20,
} as const;

/**
 * USDC is Arc's native gas token. The same underlying balance is exposed as an
 * 18-decimal native coin AND a 6-decimal ERC-20 interface at this address. All
 * contract/value math in this product uses the 6-decimal ERC-20 view. See
 * `decimals.ts` for the conversion helpers and the precision hazard notes.
 */
export const USDC: Address = "0x3600000000000000000000000000000000000000";

/** Euro-denominated Circle stablecoin, 6 decimals. */
export const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

/** Yield-bearing tokenized money-market fund (6 decimals). Gated by Entitlements. */
export const USYC = {
  token: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as Address,
  entitlements: "0xcc205224862c7641930c87679e98999d23c26113" as Address,
  /** Mints/redeems USYC from USDC once the caller is allowlisted (24–48h via Circle). */
  teller: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as Address,
} as const;

/** Circle CCTP V2 — the "whale path" rail for large, high-assurance transfers. */
export const CCTP_V2 = {
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
  tokenMinter: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192" as Address,
  message: "0xbaC0179bB358A8936169a63408C8481D582390C4" as Address,
} as const;

/** Circle Gateway — the instant (<500ms) unified-balance rail for the fast path. */
export const GATEWAY = {
  wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address,
  minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as Address,
} as const;

/** StableFX — enterprise RFQ FX engine settling USDC<->EURC swaps on Arc. */
export const STABLEFX = {
  fxEscrow: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8" as Address,
} as const;

/** Standard Ethereum-ecosystem contracts predeployed on Arc. */
export const COMMON = {
  create2Factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
  /** Required by StableFX for signature-based USDC approvals. */
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
} as const;

/**
 * Arc protocol precompiles (0x1800.. range). We do not call these directly, but
 * the PQ verifier underpins Arc's quantum-resilient wallet signatures — a key
 * security claim in the grant proposal.
 */
export const PRECOMPILES = {
  nativeCoinAuthority: "0x1800000000000000000000000000000000000000" as Address,
  nativeCoinControl: "0x1800000000000000000000000000000000000001" as Address,
  systemAccounting: "0x1800000000000000000000000000000000000002" as Address,
  callFrom: "0x1800000000000000000000000000000000000003" as Address,
  /** Post-quantum SLH-DSA-SHA2-128s signature verification. */
  pqSignatureVerify: "0x1800000000000000000000000000000000000004" as Address,
} as const;
