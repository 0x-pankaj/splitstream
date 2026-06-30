/**
 * Demo seed data — a realistic global marketplace tenant ("Acme Creators"),
 * an API key, a velocity-limited agent wallet, a whitelisted recipient set, and
 * a mesh of three institutional solvers with cross-chain hot-wallet reserves.
 *
 * Exported as a pure function so both the live server and the test suite seed
 * the same world.
 */

import { deriveRecipientKey, parseUsdc6, type Solver, type TargetChain } from "@arcane/shared";
import { Store, store as singleton, type Tenant } from "./store.js";

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_TENANT_ADDRESS = "0xAcME00000000000000000000000000000000Cafe" as const;
export const DEMO_API_KEY = "arc_test_sk_demo_0001";
export const DEMO_AGENT_ID = "agent-adbuyer-01";
export const DEMO_PIECE_ID = "piece-arc-frontier-001";
export const DEMO_API_ID = "piece-fx-api-001";

/**
 * Demo-piece creator addresses, overridable via env so the seeded showcase can
 * pay REAL recruited-creator wallets (and show up on the real-earnings
 * leaderboard) with zero code change. Defaults are EVM placeholders for the
 * keyless local demo. Every leg is EVM so a live unlock settles real USDC to all
 * three contributors on Arc — no contributor is ever skipped. (Solana payouts
 * route via CCTP; that's roadmap, not the default live split — see README.)
 */
function seedCreator(envKey: string, fallback: string): string {
  const v = process.env[envKey];
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? v : fallback;
}
const WRITER_ADDRESS = seedCreator("SEED_WRITER_ADDRESS", "0x1111111111111111111111111111111111111111");
const EDITOR_ADDRESS = seedCreator("SEED_EDITOR_ADDRESS", "0x2222222222222222222222222222222222222222");
const PHOTOGRAPHER_ADDRESS = seedCreator("SEED_PHOTOGRAPHER_ADDRESS", "0x3333333333333333333333333333333333333333");

// (Solana payouts route via CCTP — roadmap; the default live split is EVM-only so
// every leg settles real USDC on Arc with zero skips.)

/** Recipients the demo tenant has vetted/whitelisted. */
export const DEMO_RECIPIENTS: Array<{ address: string; chain: TargetChain }> = [
  { address: "0x1111111111111111111111111111111111111111", chain: "base" },
  { address: "0x2222222222222222222222222222222222222222", chain: "arbitrum" },
  { address: "0x3333333333333333333333333333333333333333", chain: "ethereum" },
  { address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", chain: "solana" },
  { address: "0x4444444444444444444444444444444444444444", chain: "base" },
];

function makeSolvers(): Solver[] {
  const full: Record<TargetChain, bigint> = {
    solana: parseUsdc6("250000"),
    base: parseUsdc6("250000"),
    arbitrum: parseUsdc6("250000"),
    ethereum: parseUsdc6("250000"),
  };
  return [
    {
      id: "solver-galaxy",
      label: "Galaxy Markets",
      arcAddress: "0x5010000000000000000000000000000000000001",
      supportedChains: ["base", "arbitrum", "ethereum", "solana"],
      reserves6: { ...full },
      online: true,
    },
    {
      id: "solver-wintermute",
      label: "Wintermute Liquidity",
      arcAddress: "0x5010000000000000000000000000000000000002",
      supportedChains: ["base", "arbitrum", "ethereum"],
      reserves6: { ...full, solana: 0n },
      online: true,
    },
    {
      id: "solver-jump",
      label: "Jump Crypto Desk",
      arcAddress: "0x5010000000000000000000000000000000000003",
      supportedChains: ["solana", "base"],
      reserves6: { ...full, arbitrum: 0n, ethereum: 0n },
      online: true,
    },
  ];
}

export interface SeedOptions {
  /** Initial simulated vault balance for the demo tenant (6dp). Default $1M. */
  initialBalance6?: bigint;
  /** Rolling 24h velocity cap (6dp). Default $500k. */
  dailyLimit6?: bigint;
  /**
   * Live mode: the on-chain address that funds the deployed vault and is keyed
   * in its tenantBalances. When set, the demo tenant binds to this address so
   * server-issued executeIntent calls debit a real, funded on-chain balance.
   */
  onchainTenantAddress?: `0x${string}`;
  /**
   * Live mode: the Arc address every solver is reimbursed to. Must be
   * vault-whitelisted on-chain (we use the deployer/relayer, which is).
   */
  solverArcAddress?: `0x${string}`;
}

export function seedDemo(store: Store, opts: SeedOptions = {}): void {
  const tenant: Tenant = {
    id: DEMO_TENANT_ID,
    name: "Acme Creators Marketplace",
    onchainAddress: opts.onchainTenantAddress ?? DEMO_TENANT_ADDRESS,
    createdAt: "2026-06-01T00:00:00.000Z",
  };
  store.upsertTenant(tenant);

  store.addApiKey({
    key: DEMO_API_KEY,
    tenantId: DEMO_TENANT_ID,
    label: "Demo platform key",
    scopes: new Set(["payouts:write", "treasury:read", "agents:manage"]),
  });

  store.setDailyLimit(DEMO_TENANT_ID, opts.dailyLimit6 ?? parseUsdc6("500000"));
  store.creditBalance(DEMO_TENANT_ID, opts.initialBalance6 ?? parseUsdc6("1000000"));

  for (const r of DEMO_RECIPIENTS) {
    store.addRecipient(DEMO_TENANT_ID, {
      recipientKey: deriveRecipientKey(r.address),
      address: r.address,
      targetChain: r.chain,
      label: `Demo ${r.chain} payee`,
      addedAt: "2026-06-01T00:00:00.000Z",
    });
  }

  store.solvers = makeSolvers();
  // In live mode, point every solver's reimbursement address at the on-chain
  // vault-whitelisted solver so any round-robin pick settles successfully.
  if (opts.solverArcAddress) {
    for (const s of store.solvers) s.arcAddress = opts.solverArcAddress;
  }

  store.upsertAgent({
    agentId: DEMO_AGENT_ID,
    tenantId: DEMO_TENANT_ID,
    label: "Programmatic Ad-Buyer Agent",
    policy: {
      perTransaction6: parseUsdc6("2500"),
      daily6: parseUsdc6("50000"),
      weekly6: parseUsdc6("250000"),
      monthly6: parseUsdc6("750000"),
    },
    spend: { daily6: 0n, weekly6: 0n, monthly6: 0n },
    enabled: true,
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  // SplitStream: a demo piece whose $0.05 unlock fans out across three EVM chains
  // (Base / Arbitrum / Ethereum), all settling real USDC on Arc — no skipped leg.
  // Contributor addresses default to the already-whitelisted demo recipients (so
  // the compliance precheck passes out of the box) and are overridable via env to
  // pay real recruited-creator wallets.
  store.createPiece({
    id: DEMO_PIECE_ID,
    publisherTenantId: DEMO_TENANT_ID,
    title: "The Stablecoin Frontier: Inside Arc L1",
    kind: "article",
    price6: parseUsdc6("0.05"),
    preview:
      "Arc makes USDC the native gas token — so the unit you transact in is the " +
      "unit you pay fees in. Here's what that unlocks for sub-cent, cross-chain " +
      "creator payments…",
    content: [
      "# The Stablecoin Frontier: Inside Arc L1",
      "",
      "Most chains ask you to hold a volatile gas token just to move a stablecoin.",
      "Arc collapses that: **USDC is the native gas token**, so the unit you",
      "transact in is the unit you pay fees in. Predictable cost, sub-second",
      "finality, and no second asset to manage.",
      "",
      "## Why it matters for creators",
      "",
      "A $0.05 unlock can be split three ways and settled on three different chains",
      "without anyone touching ETH for gas. The reader pays once; the writer is paid",
      "on Base, the editor on Arbitrum, the photographer on Ethereum — each in",
      "native USDC, in under 500ms.",
      "",
      "## The takeaway",
      "",
      "When the settlement layer speaks stablecoin natively, per-piece monetization",
      "stops being a rounding error eaten by fees and starts being a real business",
      "model. That's the frontier SplitStream is built on.",
      "",
      "*Thanks for paying to read — your $0.05 just fanned out to three creators.*",
    ].join("\n"),
    contributors: [
      { role: "writer", address: WRITER_ADDRESS, targetChain: "base", splitBps: 6000 },
      { role: "editor", address: EDITOR_ADDRESS, targetChain: "arbitrum", splitBps: 2500 },
      { role: "photographer", address: PHOTOGRAPHER_ADDRESS, targetChain: "ethereum", splitBps: 1500 },
    ],
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  // A demo paid API (x402): an agent pays $0.01 per call and gets a live
  // USD→EUR FX quote. Revenue goes to the API owner on Base. This is the
  // "register your own API so AI can pay per call" surface.
  store.createPiece({
    id: DEMO_API_ID,
    publisherTenantId: DEMO_TENANT_ID,
    title: "USD→EUR FX Rate API",
    kind: "api",
    price6: parseUsdc6("0.01"),
    endpoint: "https://api.frankfurter.app/latest?from=USD&to=EUR",
    httpMethod: "GET",
    contributors: [
      { role: "api owner", address: "0x4444444444444444444444444444444444444444", targetChain: "base", splitBps: 10000 },
    ],
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  // A small catalog of full-length articles, each splitting across the same
  // already-whitelisted creator wallets on Base / Arbitrum / Ethereum, so every
  // unlock settles real on Arc with no extra compliance setup.
  for (const a of CATALOG_ARTICLES) {
    store.createPiece({
      id: a.id,
      publisherTenantId: DEMO_TENANT_ID,
      title: a.title,
      kind: "article",
      price6: parseUsdc6(a.price),
      preview: a.preview,
      content: a.content.join("\n"),
      contributors: a.contributors,
      createdAt: a.createdAt,
    });
  }
}

/** Full-length seed articles for the storefront catalog. */
const CATALOG_ARTICLES: {
  id: string;
  title: string;
  price: string;
  preview: string;
  content: string[];
  contributors: { role: string; address: string; targetChain: "base" | "arbitrum" | "ethereum"; splitBps: number }[];
  createdAt: string;
}[] = [
  {
    id: "piece-no-floor-001",
    title: "The Payment Floor: Why a Paragraph Was Never Worth Selling",
    price: "0.05",
    preview:
      "For thirty years the smallest thing you could sell online was a $9.99 " +
      "subscription. Everything cheaper cost more to charge for than it earned. " +
      "Here's how that floor was built — and why it just fell.",
    content: [
      "# The Payment Floor: Why a Paragraph Was Never Worth Selling",
      "",
      "Every payment you have ever made online sat on top of a hidden minimum. Swipe",
      "a card for a dollar and roughly thirty cents vanishes into interchange, gateway,",
      "and processing fees before the merchant sees a thing. Below a few dollars the",
      "math simply inverts: the cost of collecting the money is larger than the money.",
      "",
      "That single fact shaped the entire internet economy. It is why news lives behind",
      "$15/month walls instead of $0.10 articles, why music became all-you-can-stream",
      "instead of pay-per-song, and why the only viable alternative to subscriptions",
      "turned out to be advertising — selling the reader instead of the writing.",
      "",
      "## The floor was a cost, not a law",
      "",
      "There was never anything natural about a five-dollar minimum. It was an artifact",
      "of rails built for a different era: card networks designed for retail purchases,",
      "settlement systems that took days, and currencies that needed a bank on each end.",
      "Stack enough fixed costs under a transaction and a price floor emerges whether",
      "anyone intended it or not.",
      "",
      "When the rail changes, the floor moves. A stablecoin transfer that settles in",
      "under a second, in the same unit on both ends, with fees measured in fractions",
      "of a cent, has no thirty-cent toll booth in the middle. Suddenly a paragraph,",
      "a photo, or a single API call is a sellable unit again.",
      "",
      "## What a vanished floor unlocks",
      "",
      "- **Pay-per-piece, not per-month.** Readers buy the one thing they came for.",
      "- **The long tail gets paid.** A niche essay read by two hundred people can earn,",
      "  where a subscription never could.",
      "- **Splits become trivial.** If collecting a nickel is cheap, splitting it five",
      "  ways across five contributors is cheap too.",
      "",
      "## The takeaway",
      "",
      "The subscription bundle and the ad-funded feed were never the destination — they",
      "were detours forced by an expensive rail. Remove the toll and the original",
      "promise of the web returns: sell the work itself, for what it's worth, to whoever",
      "wants it. You just paid five cents to read this. Thirty years ago, no one could",
      "have taken it.",
      "",
      "*Your payment just split between the writer on Base and the editor on Arbitrum.*",
    ],
    contributors: [
      { role: "writer", address: WRITER_ADDRESS, targetChain: "base", splitBps: 7000 },
      { role: "editor", address: EDITOR_ADDRESS, targetChain: "arbitrum", splitBps: 3000 },
    ],
    createdAt: "2026-06-12T00:00:00.000Z",
  },
  {
    id: "piece-unbundling-001",
    title: "The Great Re-Unbundling: Life After the Monthly Subscription",
    price: "0.06",
    preview:
      "Subscriptions solved a billing problem, not a reader problem. As the cost of a " +
      "single transaction collapses, the bundle is quietly coming apart again — and " +
      "the people who make the work are the ones who benefit.",
    content: [
      "# The Great Re-Unbundling: Life After the Monthly Subscription",
      "",
      "The subscription was a brilliant answer to the wrong question. Faced with a rail",
      "that punished small payments, publishers asked: *how do we charge once and stop",
      "paying fees on every article?* The answer was to bundle a hundred pieces a reader",
      "didn't want around the three they did, and bill it monthly. It worked — for the",
      "billing department.",
      "",
      "But readers never wanted bundles. They wanted *that* article, *that* song, *that*",
      "dataset. Every \"cancel your subscription\" flow is a small confession that the",
      "bundle was a tax we tolerated because the alternative — paying per piece — wasn't",
      "technically possible.",
      "",
      "## Bundling is a symptom of expensive payments",
      "",
      "Cable bundled channels because per-channel billing was uneconomical. Newspapers",
      "bundled sections because per-article billing was uneconomical. Streaming bundled",
      "catalogs because per-song billing was uneconomical. The pattern is identical, and",
      "the cause is identical: the transaction cost more than the unit.",
      "",
      "Flip that cost to near-zero and the logic reverses. When charging for one piece",
      "is as cheap as charging for a thousand, the bundle stops being a necessity and",
      "becomes a choice — and most readers will choose to pay for exactly what they use.",
      "",
      "## What changes for creators",
      "",
      "Under a subscription, a contributor's pay is an opaque slice of a pooled monthly",
      "fee, divided by some internal formula they never see. Under per-piece payments,",
      "the link is direct: this reader paid for this piece, and the split is on-chain.",
      "A photographer who shot one viral image is paid for that image, in real time,",
      "not averaged into irrelevance across a catalog.",
      "",
      "## The takeaway",
      "",
      "Re-unbundling isn't nostalgia for à la carte — it's what happens automatically",
      "once the payment floor disappears. The monthly commitment was scaffolding around",
      "a broken rail. Replace the rail, and the scaffolding comes down on its own.",
      "",
      "*This unlock paid a writer, an editor, and a photographer at once — each on their",
      "own chain.*",
    ],
    contributors: [
      { role: "writer", address: WRITER_ADDRESS, targetChain: "base", splitBps: 6000 },
      { role: "editor", address: EDITOR_ADDRESS, targetChain: "arbitrum", splitBps: 2500 },
      { role: "photographer", address: PHOTOGRAPHER_ADDRESS, targetChain: "ethereum", splitBps: 1500 },
    ],
    createdAt: "2026-06-15T00:00:00.000Z",
  },
  {
    id: "piece-crosschain-001",
    title: "One Payment, Three Chains: How Cross-Chain Splitting Actually Works",
    price: "0.04",
    preview:
      "A reader pays a nickel on one chain; three creators get paid on three different " +
      "chains, seconds later, with no bridge to babysit. Here's the plumbing under the " +
      "magic trick — explained without the jargon.",
    content: [
      "# One Payment, Three Chains: How Cross-Chain Splitting Actually Works",
      "",
      "The demo looks like sleight of hand. You pay five cents on Arc. A moment later a",
      "writer has been paid on Base, an editor on Arbitrum, and a photographer on",
      "Ethereum — each in real USDC, none of them holding a gas token, nobody clicking",
      "a bridge. No magic. Just a settlement layer doing the boring work correctly.",
      "",
      "## Step one: the split is just arithmetic",
      "",
      "When the payment lands, the price is divided by basis points — say 60/25/15 — into",
      "exact integer shares. The only subtlety is rounding: fractions of the smallest",
      "unit are handed to the largest share so the parts always sum back to the whole.",
      "No cent is invented; no cent is lost. That guarantee matters more than it sounds",
      "when you're doing it ten thousand times a day.",
      "",
      "## Step two: routing each leg to its home chain",
      "",
      "Each contributor wants to be paid somewhere specific. Small payouts take the",
      "**instant path** — a solver mesh backed by a unified cross-chain balance fronts",
      "the funds on the destination chain immediately and reconciles on the settlement",
      "layer behind the scenes. Larger movements take the **canonical path**, burning on",
      "one chain and minting on the other. The reader never sees either; they just see",
      "\"paid.\"",
      "",
      "## Step three: no gas tokens, anywhere",
      "",
      "The reason this feels effortless is that the unit of value and the unit of fees",
      "are the same — USDC. Nobody has to acquire a volatile token just to receive a",
      "stablecoin. The writer on Base doesn't think about ETH; the payout arrives in the",
      "currency they actually wanted, ready to spend.",
      "",
      "## Why it's hard, and why it's the moat",
      "",
      "Most pay-per-article demos pay one person on one chain. The hard part isn't the",
      "payment — it's the **fan-out**: exact splits, multiple destinations, sub-second",
      "finality, and no skipped contributor, every single time. Get that right and",
      "per-piece monetization stops being a toy and starts being infrastructure.",
      "",
      "*Thanks for reading — this four-cent unlock just fanned out across two chains.*",
    ],
    contributors: [
      { role: "writer", address: WRITER_ADDRESS, targetChain: "base", splitBps: 5500 },
      { role: "editor", address: EDITOR_ADDRESS, targetChain: "arbitrum", splitBps: 4500 },
    ],
    createdAt: "2026-06-18T00:00:00.000Z",
  },
  {
    id: "piece-agent-readers-001",
    title: "Agents Are Your New Best Readers",
    price: "0.07",
    preview:
      "The most reliable customer for a piece of writing in 2026 might not be a human " +
      "at all. Autonomous agents read, decide, and pay — no cart, no account, no churn. " +
      "What that means for anyone who makes things worth reading.",
    content: [
      "# Agents Are Your New Best Readers",
      "",
      "For two decades the unit of demand online was a human with attention to spare and",
      "a credit card they were reluctant to use. That reader is fickle, ad-blocked, and",
      "allergic to friction. A new kind of reader has quietly arrived, and it has none of",
      "those traits: the autonomous agent.",
      "",
      "An agent doesn't bounce at a paywall. It reads a catalog, decides whether a piece",
      "is worth its budget, pays the few cents, consumes the content, and moves on —",
      "thousands of times, without a signup flow or an abandoned cart. If your work is",
      "useful, an agent is the most decisive customer you will ever have.",
      "",
      "## Why agents need a payment-native web",
      "",
      "Agents can't fill in a checkout form, complete a KYC flow, or wait for an email",
      "confirmation. What they *can* do is sign a payment. A protocol where a request",
      "returns \"402 Payment Required,\" the agent pays on-chain, and the resource is then",
      "served, fits an agent perfectly — it's a machine handshake, not a human funnel.",
      "",
      "## Spend caps make it safe",
      "",
      "The obvious fear — an agent draining a wallet — is a solved problem. Agents carry",
      "budgets and per-piece ceilings enforced before any money moves. A reading agent",
      "with a fifty-cent budget and a five-unlock cap is as bounded as a vending machine",
      "with a coin slot. Autonomy and control aren't opposites here; the caps are what",
      "make the autonomy usable.",
      "",
      "## What it means for creators",
      "",
      "- **A new demand curve.** Pieces too niche for human subscriptions can still be",
      "  worth an agent's nickel — at scale.",
      "- **No marketing funnel.** Agents discover through structured catalogs and APIs,",
      "  not through ads and SEO games.",
      "- **Instant, honest settlement.** The agent pays per use; you're paid per use,",
      "  on-chain, the moment it happens.",
      "",
      "## The takeaway",
      "",
      "Writing for agents isn't writing for robots instead of people — it's writing for",
      "people and letting their agents handle the boring part of paying you. The work",
      "still has to be good. It just finally gets paid the instant it's used.",
      "",
      "*An agent may well have paid the seven cents that unlocked this — split three ways,",
      "in real time, on Arc.*",
    ],
    contributors: [
      { role: "writer", address: WRITER_ADDRESS, targetChain: "base", splitBps: 5000 },
      { role: "editor", address: EDITOR_ADDRESS, targetChain: "arbitrum", splitBps: 3000 },
      { role: "researcher", address: PHOTOGRAPHER_ADDRESS, targetChain: "ethereum", splitBps: 2000 },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
  },
];

// CLI entry: `bun run src/db/seed.ts` seeds the singleton and reports.
if (import.meta.main) {
  seedDemo(singleton);
  console.log("Seeded demo world:");
  console.log(`  Tenant:   ${DEMO_TENANT_ID} (${singleton.tenants.get(DEMO_TENANT_ID)?.name})`);
  console.log(`  API key:  ${DEMO_API_KEY}`);
  console.log(`  Agent:    ${DEMO_AGENT_ID}`);
  console.log(`  Solvers:  ${singleton.solvers.map((s) => s.label).join(", ")}`);
}
