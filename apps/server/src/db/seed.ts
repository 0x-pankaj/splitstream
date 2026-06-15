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

  // SplitStream: a demo piece whose $0.05 unlock fans out across three chains.
  // Contributor addresses reuse the already-whitelisted demo recipients so the
  // unlock path's compliance precheck passes out of the box.
  store.createPiece({
    id: DEMO_PIECE_ID,
    publisherTenantId: DEMO_TENANT_ID,
    title: "The Stablecoin Frontier: Inside Arc L1",
    kind: "article",
    price6: parseUsdc6("0.05"),
    contributors: [
      { role: "writer", address: "0x1111111111111111111111111111111111111111", targetChain: "base", splitBps: 6000 },
      { role: "editor", address: "0x2222222222222222222222222222222222222222", targetChain: "arbitrum", splitBps: 2500 },
      { role: "photographer", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", targetChain: "solana", splitBps: 1500 },
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
}

// CLI entry: `bun run src/db/seed.ts` seeds the singleton and reports.
if (import.meta.main) {
  seedDemo(singleton);
  console.log("Seeded demo world:");
  console.log(`  Tenant:   ${DEMO_TENANT_ID} (${singleton.tenants.get(DEMO_TENANT_ID)?.name})`);
  console.log(`  API key:  ${DEMO_API_KEY}`);
  console.log(`  Agent:    ${DEMO_AGENT_ID}`);
  console.log(`  Solvers:  ${singleton.solvers.map((s) => s.label).join(", ")}`);
}
