/**
 * One-shot Circle Developer-Controlled Wallets setup for SplitStream.
 *
 * YOU run this (it needs YOUR Circle Sandbox API key) — it never runs on a
 * server and commits no secrets. It:
 *   1. generates a 32-byte entity secret (or reuses CIRCLE_ENTITY_SECRET if set),
 *   2. registers its ciphertext with Circle + writes a recovery file to ~/.circle,
 *   3. creates a wallet set for SplitStream creators,
 * then prints the three env vars the server reads (CIRCLE_API_KEY /
 * CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID). Add them to apps/server/.env
 * (local) and your Railway service (prod), keep the recovery file safe, and
 * never commit either.
 *
 *   1. Get a SANDBOX (testnet) API key at https://console.circle.com
 *   2. cd apps/server && CIRCLE_API_KEY=TEST_API_KEY:... bun run scripts/circle-setup.ts
 *
 * Re-running: pass the SAME CIRCLE_ENTITY_SECRET back in to skip re-registration
 * (a secret can only be registered once) and just mint another wallet set.
 *
 * Docs: https://developers.circle.com/wallets/dev-controlled/register-entity-secret
 */

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";

async function main(): Promise<void> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error(
      "✗ Set CIRCLE_API_KEY first (a Sandbox/testnet key from https://console.circle.com).\n" +
        "  e.g.  CIRCLE_API_KEY=TEST_API_KEY:... bun run scripts/circle-setup.ts",
    );
    process.exit(1);
  }

  const sdk = await import("@circle-fin/developer-controlled-wallets");

  // 1. Entity secret — reuse if provided (already registered), else generate.
  const provided = process.env.CIRCLE_ENTITY_SECRET;
  const entitySecret = provided ?? crypto.randomBytes(32).toString("hex");
  const isFresh = !provided;

  // 2. Register the ciphertext (only for a fresh secret) + write the recovery file.
  if (isFresh) {
    // NOTE: the SDK treats recoveryFileDownloadPath as a DIRECTORY — it writes
    // recovery_file_<uuid>.dat inside it — so it must exist and be a folder.
    const recoveryDir = path.join(os.homedir(), ".circle");
    mkdirSync(recoveryDir, { recursive: true });
    try {
      await sdk.registerEntitySecretCiphertext({
        apiKey,
        entitySecret,
        recoveryFileDownloadPath: recoveryDir,
      });
      console.log(`✓ Entity secret registered. Recovery file saved under: ${recoveryDir}`);
      console.log("  KEEP THAT FILE SAFE and OUT of git — it's your only recovery path.");
    } catch (err) {
      console.error("✗ Entity secret registration failed:", (err as Error).message);
      console.error("  If this key already has a secret registered, re-run with that");
      console.error("  secret: CIRCLE_ENTITY_SECRET=<hex> CIRCLE_API_KEY=... bun run scripts/circle-setup.ts");
      process.exit(1);
    }
  } else {
    console.log("• Reusing the provided CIRCLE_ENTITY_SECRET (skipping registration).");
  }

  // 3. Create a wallet set for SplitStream's creator wallets.
  const client = sdk.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  const res = await client.createWalletSet({
    name: "SplitStream creators",
    idempotencyKey: crypto.randomUUID(),
  });
  const walletSetId = res.data?.walletSet?.id;
  if (!walletSetId) {
    console.error("✗ createWalletSet returned no id:", JSON.stringify(res.data));
    process.exit(1);
  }
  console.log(`✓ Wallet set created: ${walletSetId}`);

  // 4. Print the env block to paste into apps/server/.env + Railway.
  console.log("\n──────────── Add these to apps/server/.env and Railway ────────────");
  console.log(`CIRCLE_API_KEY=${apiKey}`);
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log("───────────────────────────────────────────────────────────────────");
  console.log("Then restart the server — /health will show \"circleWallets\":true and");
  console.log("new creators get a real custodial Arc wallet (balance + withdraw live).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
