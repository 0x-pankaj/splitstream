/**
 * Phase 4 — live proof: run ONE real per-piece unlock and print the cross-chain
 * split settlement with Arc explorer links.
 *
 * This is the single command you run to capture the demo proof. It uses the
 * exact same engine the storefront uses (payForPiece → processBulkPayout), so a
 * green run here is a green run for the product.
 *
 *   Mirror mode (no keys, always works — proves the flow):
 *     bun run apps/server/scripts/prove-split.ts
 *
 *   Live mode (real Arc Testnet settlement):
 *     RELAYER_PRIVATE_KEY=0x... VAULT_ADDRESS=0x... \
 *     COMPLIANCE_GUARD_ADDRESS=0x... LIVE_GATEWAY=true \
 *     bun run apps/server/scripts/prove-split.ts
 *
 * Live prerequisites (see PHASE4_LIVE_PROOF.md): the relayer must have deposited
 * USDC into the vault for the publisher tenant, and each contributor address
 * must be whitelisted on-chain (the script whitelists them via the engine in
 * live mode, but the vault must hold a covering balance).
 */

import { ARC_TESTNET } from "@arcane/shared";
import { config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { seedDemo, DEMO_PIECE_ID } from "../src/db/seed.js";
import { relayerAccount } from "../src/chain/arc.js";
import { payForPiece } from "../src/services/splitEngine.js";

const store = new Store();
seedDemo(
  store,
  config.onchainEnabled && relayerAccount
    ? { onchainTenantAddress: relayerAccount.address, solverArcAddress: relayerAccount.address }
    : {},
);

const piece = store.getPiece(DEMO_PIECE_ID);
if (!piece) throw new Error("demo piece missing");

console.log(`\nSplitStream live proof — ${config.onchainEnabled ? "LIVE Arc Testnet" : "mirror (simulated)"}`);
console.log(`Piece: "${piece.title}"  price $${(Number(piece.price6) / 1e6).toFixed(2)}`);
console.log(`Contributors: ${piece.contributors.map((c) => `${c.role}/${c.targetChain}`).join(", ")}\n`);

const result = await payForPiece(store, piece, { payer: "prove-split" });

for (const c of result.contributors) {
  const dstHash = c.settlement.destinationTxHash;
  const arcHash = c.settlement.arcTxHash;
  console.log(`  ${c.role.padEnd(14)} ${c.targetChain.padEnd(9)} $${(Number(c.share6) / 1e6).toFixed(2).padStart(6)}  ${c.settlement.path}  ${c.settlement.latencyMs}ms`);
  console.log(`    dest tx: ${dstHash}`);
  console.log(`    arc  tx: ${ARC_TESTNET.explorer}/tx/${arcHash}`);
}

console.log(`\nSettled ${result.contributorCount} creators across ${result.chains.length} chains in mode "${result.batch.results[0]?.settlementMode}".`);
console.log(`Piece now: ${result.pieceUnlocks} unlocks · $${(Number(result.pieceTotalPaid6) / 1e6).toFixed(2)} paid to creators.\n`);

process.exit(0);
