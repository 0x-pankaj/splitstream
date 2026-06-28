/**
 * Runtime configuration, derived from environment with safe defaults so the
 * engine boots and runs end-to-end out of the box (simulated rails), while
 * automatically upgrading to live Arc Testnet / Circle calls when credentials
 * are present.
 */

import {
  DEFAULT_FEE_POLICY,
  DEFAULT_INSTANT_THRESHOLD_6,
  parseUsdc6,
  type FeePolicy,
} from "@arcane/shared";
import type { Address, Hex } from "viem";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

function thresholdFromEnv(): bigint {
  const raw = env("INSTANT_PATH_THRESHOLD_USDC");
  if (!raw) return DEFAULT_INSTANT_THRESHOLD_6;
  return parseUsdc6(raw);
}

export interface AppConfig {
  port: number;
  databasePath: string;
  rpcHttp: string;
  rpcWs: string | undefined;
  /** Relayer key that signs executeIntent on Arc L1. */
  relayerPrivateKey: Hex | undefined;
  vaultAddress: Address | undefined;
  complianceGuardAddress: Address | undefined;
  platformFeeWallet: Address | undefined;
  circleKitKey: string | undefined;
  /**
   * Circle Developer-Controlled Wallets — used to pre-create a pool of custodial
   * USDC wallets on Arc and assign one to each creator on signup, so a creator can
   * receive and withdraw their split with just an email (no MetaMask/seed phrase).
   * Undefined → wallet provisioning is disabled and the creator flow falls back to
   * a clearly-labeled local dev wallet (mirror mode) or a bring-your-own address.
   */
  circleWallets:
    | { apiKey: string; entitySecret: string; walletSetId: string }
    | undefined;
  /**
   * Transactional email for sending creator login one-time codes. When unset, the
   * OTP is logged to stdout so the email→OTP flow still works with zero keys in
   * local dev (mirror-mode discipline).
   */
  email: { apiKey: string; from: string } | undefined;
  /**
   * Optional AES-256-GCM key (any string; hashed to 32 bytes) for encrypting the
   * persisted store snapshot at rest — so upstream API credentials, creator
   * emails, and API keys aren't stored in cleartext in D1/sqlite. Unset → snapshot
   * is plaintext (and existing plaintext snapshots remain readable either way).
   */
  snapshotEncKey: string | undefined;
  /** Comma-separated allowed browser origins for credentialed/admin CORS. */
  corsOrigins: string[];
  /** Autonomous demo-agent key that pays real USDC on Arc from the storefront. */
  demoAgentPrivateKey: Hex | undefined;
  /**
   * Cloudflare R2 (S3-compatible) for hosting uploaded media (photos/songs). When
   * set, a seller can upload a real file and its public URL becomes the piece's
   * gated content. Undefined → uploads are disabled (content stays text/URL only).
   */
  r2:
    | {
        endpoint: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucket: string;
        publicUrl: string;
      }
    | undefined;
  instantThreshold6: bigint;
  feePolicy: FeePolicy;
  /**
   * When true (env LIVE_BRIDGE=true) the whale path performs a REAL CCTP burn on
   * Arc → mint on the destination chain via Circle App Kit's Forwarding Service,
   * instead of a simulated receipt. Requires a funded relayer key.
   */
  liveBridge: boolean;
  /**
   * When true (env LIVE_GATEWAY=true) the instant path performs a REAL Circle
   * Gateway unified-balance spend: burn from the platform's Arc-side balance →
   * Forwarding Service mints native USDC to the recipient on the destination
   * chain in <500ms. Requires a funded relayer key whose Arc Gateway balance has
   * been topped up via `unifiedBalance.deposit`. No kit key required.
   */
  liveGateway: boolean;
  /**
   * When true (env LIVE_X402=true) the x402 paid-call flow settles for REAL on
   * Arc: the agent's USDC payment to the relayer is verified on-chain before the
   * call is served, and each contributor is paid their split via a real USDC
   * transfer on Arc. Requires a funded relayer key. Without it, x402 runs in
   * mirror mode (single-use nonce gating, simulated split) so the demo always works.
   */
  liveX402: boolean;
  /**
   * Live mode wires real on-chain Arc reads/writes and (when a kit key is set)
   * real Circle App Kit rails. Without a relayer key + vault address we run in
   * simulated mode so the product is always demoable.
   */
  onchainEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const relayerPrivateKey = env("RELAYER_PRIVATE_KEY") as Hex | undefined;
  const vaultAddress = env("VAULT_ADDRESS") as Address | undefined;

  const r2Endpoint = env("R2_ENDPOINT");
  const r2AccessKeyId = env("R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const r2PublicUrl = env("R2_PUBLIC_URL");
  const r2 =
    r2Endpoint && r2AccessKeyId && r2SecretAccessKey && r2PublicUrl
      ? {
          endpoint: r2Endpoint,
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
          bucket: env("R2_BUCKET") ?? "splitstream",
          publicUrl: r2PublicUrl,
        }
      : undefined;

  const circleApiKey = env("CIRCLE_API_KEY");
  const circleEntitySecret = env("CIRCLE_ENTITY_SECRET");
  const circleWalletSetId = env("CIRCLE_WALLET_SET_ID");
  const circleWallets =
    circleApiKey && circleEntitySecret && circleWalletSetId
      ? { apiKey: circleApiKey, entitySecret: circleEntitySecret, walletSetId: circleWalletSetId }
      : undefined;

  const emailApiKey = env("EMAIL_API_KEY");
  const email = emailApiKey
    ? { apiKey: emailApiKey, from: env("EMAIL_FROM") ?? "SplitStream <login@splitstream.app>" }
    : undefined;

  return {
    port: Number(env("PORT") ?? 8787),
    databasePath: env("DATABASE_PATH") ?? "./data/arcane.sqlite",
    rpcHttp: env("ARC_TESTNET_RPC_URL") ?? "https://rpc.testnet.arc.network",
    rpcWs: env("ARC_TESTNET_WS_URL"),
    relayerPrivateKey,
    vaultAddress,
    complianceGuardAddress: env("COMPLIANCE_GUARD_ADDRESS") as Address | undefined,
    platformFeeWallet: env("PLATFORM_FEE_WALLET") as Address | undefined,
    circleKitKey: env("CIRCLE_KIT_KEY"),
    circleWallets,
    email,
    snapshotEncKey: env("SNAPSHOT_ENC_KEY"),
    corsOrigins: (env("CORS_ORIGINS") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    demoAgentPrivateKey: env("DEMO_AGENT_PRIVATE_KEY") as Hex | undefined,
    r2,
    instantThreshold6: thresholdFromEnv(),
    feePolicy: DEFAULT_FEE_POLICY,
    liveBridge: (env("LIVE_BRIDGE") === "true" || env("LIVE_BRIDGE") === "1") && Boolean(relayerPrivateKey),
    liveGateway: (env("LIVE_GATEWAY") === "true" || env("LIVE_GATEWAY") === "1") && Boolean(relayerPrivateKey),
    liveX402: (env("LIVE_X402") === "true" || env("LIVE_X402") === "1") && Boolean(relayerPrivateKey),
    onchainEnabled: Boolean(relayerPrivateKey && vaultAddress),
  };
}

export const config = loadConfig();
