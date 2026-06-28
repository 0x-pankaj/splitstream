/**
 * Agent-to-agent (A2A) demo — an autonomous BUYER agent discovers a SELLER
 * "creator agent" and pays it per piece, with the money landing in the seller
 * agent's own Circle wallet on Arc.
 *
 * This is the agentic loop the hackathon rewards: agent-pays-agent, settled in
 * real USDC, into a real wallet a creator can withdraw from. It reuses the exact
 * production primitives — a Circle-assigned wallet (provisionCreatorWallet), the
 * split/settlement engine (payForPiece / payLiveForPiece), and the real-earnings
 * rollup (creatorEarnings) — so a green run here mirrors the live product.
 *
 *   Mirror mode (no keys, always works — proves the flow):
 *     bun run apps/server/scripts/a2a-demo.ts
 *
 *   Live mode (real Arc settlement into the seller agent's Circle wallet):
 *     LIVE_X402=true RELAYER_PRIVATE_KEY=0x... DEMO_AGENT_PRIVATE_KEY=0x... \
 *     CIRCLE_API_KEY=... CIRCLE_ENTITY_SECRET=... CIRCLE_WALLET_SET_ID=... \
 *     bun run apps/server/scripts/a2a-demo.ts
 */

import { parseUsdc6 } from "@arcane/shared";
import { config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { provisionCreatorWallet, circleWalletsReady } from "../src/services/circleWallets.js";
import { payForPiece, whitelistContributors } from "../src/services/splitEngine.js";
import { payLiveForPiece, liveAgentReady } from "../src/services/liveAgent.js";
import { creatorEarnings } from "../src/services/creatorEarnings.js";

const store = new Store();

// 1) Stand up a SELLER "creator agent" with its own custodial wallet on Arc.
const sellerId = "creator-agent-001";
const wallet = await provisionCreatorWallet(store, { creatorId: sellerId, label: "creator-agent" });
console.log(`\nA2A demo — ${liveAgentReady() ? "LIVE Arc Testnet" : "mirror (simulated)"}`);
console.log(`Seller wallet: ${wallet.address}  (${circleWalletsReady() ? "Circle dev-controlled" : "local-dev"})`);

// The seller agent needs a publisher tenant to own its piece.
const tenant = store.createTenant({ name: "Creator Agent", onchainAddress: wallet.address as `0x${string}` });
store.setDailyLimit(tenant.id, parseUsdc6("500000"));
store.creditBalance(tenant.id, parseUsdc6("1000000"));

// 2) The seller agent lists a piece — its wallet is the sole contributor.
const piece = store.createPiece({
  publisherTenantId: tenant.id,
  title: "Realtime Arc Gas Oracle (agent-served)",
  kind: "article",
  price6: parseUsdc6("0.05"),
  preview: "A machine-readable snapshot of Arc gas + USDC throughput.",
  content: "# Arc Gas Oracle\n\nArc gas is USDC-denominated and stable. (agent-served payload)",
  contributors: [{ role: "creator-agent", address: wallet.address, targetChain: "base", splitBps: 10000 }],
});
whitelistContributors(store, piece);
console.log(`Seller listed: "${piece.title}" @ $0.05\n`);

// 3) The BUYER agent discovers the catalog and pays per piece.
console.log("Buyer agent: scanning catalog → deciding to pay…");
if (liveAgentReady()) {
  const r = await payLiveForPiece(store, piece, { reader: "buyer-agent-001" });
  console.log(`  paid REAL USDC on Arc — payment tx ${r.paymentTx}`);
  for (const p of r.payouts) console.log(`  → ${p.role} ${p.address} $${p.share6 ? (Number(p.share6) / 1e6).toFixed(2) : "?"} tx ${p.txHash ?? "(skipped)"}`);
} else {
  const r = await payForPiece(store, piece, { payer: "buyer-agent-001" });
  for (const c of r.contributors) console.log(`  → ${c.role} ${c.recipientAddress} $${(Number(c.share6) / 1e6).toFixed(2)} (${c.settlement.path}, ${c.settlement.latencyMs}ms)`);
}

// 4) Show the seller agent's earnings — money the agent now holds in its wallet.
const earnings = creatorEarnings(store, wallet.address);
console.log(`\nSeller agent earnings: $${earnings.totalEarnedUSDC} across ${earnings.payoutCount} payout(s).`);
console.log(liveAgentReady()
  ? "These are real, on-chain, and withdrawable from the agent's Circle wallet.\n"
  : "(mirror mode — run with live keys to settle real USDC into the Circle wallet)\n");

process.exit(0);
