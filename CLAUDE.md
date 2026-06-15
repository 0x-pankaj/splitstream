# SplitStream — per-piece creator monetization with instant cross-chain revenue splitting, on Circle Arc L1

> **Read this first, every session.** This file is the durable project brief. The
> live, evolving build status lives in **`SPLITSTREAM_PLAN.md`** — read that
> second to know exactly what is done and what to do next. The original treasury
> engine spec is preserved in `CLAUDE.arcane-treasury.md` for reference.

You are a Principal Engineer building **SplitStream** for the **Lepton Agents
Hackathon** (Canteen × Circle × Arc, June 15–29 2026). SplitStream is a pivot of
a proven corporate-treasury engine (`arcane-treasury`) into a **creator
monetization product**. The settlement engine is reused as-is; the product
surface on top is new.

---

## 1. The product in one sentence

**A reader (human or AI agent) pays a few cents to unlock a single article /
photo / song, and that payment is instantly split across every contributor —
each paid on the chain they prefer — settling in under 500ms on Arc.**

No subscription. No signup or KYC for the reader. Pay-per-piece.

### Why this wins the hackathon

The event is judged 30% **Agentic Sophistication** + 30% **Traction** + 20%
Circle usage + 20% Innovation. Our edges:

- **Traction (the deciding metric):** the RFB's metric is *"creators earning ·
  total creator payouts."* Every unlock is a real payment we can drive and show
  on a live counter. We generate volume ourselves (seeded creators + a buyer
  agent + a public link) — we never depend on outside adopters showing up.
- **Agentic:** an AI reading-agent that autonomously consumes content and pays
  each creator per piece, with on-chain spend caps. Agent-pays-creator and
  agent-pays-agent.
- **Circle usage:** already wired — Arc native-USDC gas, Circle Gateway instant
  path, CCTP whale path. Proven on Arc Testnet.
- **Innovation:** **cross-chain revenue splitting** is our moat. One $0.05
  payment fans out to writer (Base), editor (Arbitrum), photographer (Solana),
  instantly, no gas tokens. No other hackathon team's scaffold does this; ours
  does it natively because the engine was born a multi-recipient cross-chain
  payout splitter.

### Target RFB

> *"Monetize a single article, photo, or song, without forcing readers into a
> monthly commitment."* Example builds we map to: **SplitStream** (auto-split to
> every contributor — our headline), ReadPay (pay-per-article), TipJar (instant
> tips), NewsWallet (earn per reader), AI reading lists that auto-pay creators.

---

## 2. Hard rules (inherited from the engine — do not violate)

- **Absolute completeness.** Full, production-grade, human-scannable code. No
  `...`, no placeholders, no `// TODO`, no truncation.
- **The Arc Precision Duality.** USDC on Arc is one balance with two interfaces:
  native gas = **18 decimals**, ERC-20 (`0x3600…0000`) = **6 decimals**. ALL
  value/accounting math uses **6dp base units as `bigint`**. Only cross to 18dp
  through the explicit helpers in `packages/shared/src/decimals.ts`. Never mix
  precisions implicitly.
- **Isolated footprint.** On-chain (`/contracts`, Solidity ^0.8.24) and off-chain
  (`/apps`, `/packages`, TypeScript) stay strictly separated.
- **Hybrid routing.** Payouts `< $5,000` (configurable `INSTANT_PATH_THRESHOLD_USDC`)
  route the **instant path** (Gateway-backed solver mesh, sub-500ms). `≥ $5,000`
  route the **whale path** (CCTP V2). Per-piece nanopayments are always tiny, so
  splits ride the instant path — exactly the rail the hackathon rewards.
- **No `Math.random()` / `Date.now()` at import time.** Pass `now` in; engine
  functions already take a `now = Date.now()` parameter.

---

## 3. Architecture (monorepo: pnpm workspaces + Turbo)

```
splitstream/
├── contracts/                    Foundry. Live on Arc Testnet (chain 5042002).
│   └── src/ ArcaneTreasuryVault.sol, ArcaneComplianceGuard.sol   ← REUSE as-is
├── packages/
│   ├── shared/                   Zod schemas, Arc addresses, decimals, routing,
│   │   └── src/                  fee math, domain types.
│   │       ├── decimals.ts       6dp/18dp duality helpers (parseUsdc6/formatUsdc6)
│   │       ├── routing.ts        planPayout / computeFees / totalDebit6
│   │       ├── types.ts          PayoutItem, RoutedPayout, AuditEntry, AgentWallet
│   │       ├── schemas.ts        BulkPayoutSchema + SplitStream piece schemas
│   │       ├── splits.ts         ★ NEW: Piece/Contributor types + computeSplit()
│   │       └── index.ts          barrel export
│   └── sdk/                      thin TS client (extend into the embed widget)
└── apps/
    ├── server/                   Bun + Hono + tRPC backend (:8787)
    │   └── src/
    │       ├── index.ts          Hono app; mounts REST + tRPC; seeds demo world
    │       ├── config.ts         env → live/mirror mode switch
    │       ├── db/store.ts       in-memory store (+ pieces) → snapshots to sqlite
    │       ├── db/seed.ts        demo world (+ a demo piece)
    │       ├── routes/
    │       │   ├── payouts.ts    POST /api/v1/payouts/bulk (engine, reused)
    │       │   ├── tenants.ts    onboarding, payee mgmt, funding
    │       │   └── pieces.ts     ★ NEW: create/list/get/pay pieces
    │       ├── services/
    │       │   ├── payoutEngine.ts   processBulkPayout — THE settlement core
    │       │   ├── splitEngine.ts    ★ NEW: payForPiece — split→bulk payout
    │       │   ├── gatewayUnifiedBalance.ts  real Circle Gateway spend (LIVE_GATEWAY)
    │       │   ├── bridgeCctp.ts      real CCTP burn→mint (LIVE_BRIDGE)
    │       │   ├── solverMesh.ts      instant-path solver selection
    │       │   ├── agentTreasury.ts   per-agent spend caps (reused for reader-agent)
    │       │   └── …                  compliance, vault, stablefx, recipients
    │       └── mcp/server.ts     MCP tools for agents (extend: pay_for_piece)
    └── web/                      Next.js. Repurpose into the creator storefront +
                                  live traction counter + embed widget.
```

### The one insight that makes everything reuse cleanly

**A piece payment IS a bulk payout.** The piece's contributors become the payout
recipients; their `splitBps` become their share amounts. So `payForPiece()` just
builds a `BulkPayoutInput` from the piece and calls the existing, proven
`processBulkPayout()`. Cross-chain splitting, compliance, audit log, Arc
settlement, and the instant/whale routing all come for free.

---

## 4. Key flows

### Create a piece (publisher)
`POST /api/v1/pieces` (x-api-key) → validate `CreatePieceSchema` (contributors'
`splitBps` must sum to 10000) → auto-whitelist each contributor address on the
publisher tenant → store the piece.

### Unlock a piece (reader — human or agent)
`POST /api/v1/pieces/:id/pay` → `payForPiece()`:
1. `computeSplit(price6, contributors)` → per-contributor 6dp shares (remainder
   to the largest share so the sum is exact).
2. Credit the publisher tenant's vault balance for the reader's payment (mirror
   mode models the reader's funds landing in the vault; live mode = real deposit).
3. Build `BulkPayoutInput` (contributors as recipients) → `processBulkPayout()`
   splits + settles each contributor on their chain via the instant path.
4. Record the unlock (`unlocks++`, `totalPaid6 +=`) for the traction counter.
5. Return the unlock receipt + per-contributor settlement (tx hashes, latency).

### Live vs mirror mode + env files
- **`apps/server/.env` (demo default):** mirror mode (no relayer/vault →
  simulated settlement) **+ `OPENROUTER_API_KEY`** so the reading-agent runs in
  `llm` mode. This is the always-works demo path; `pnpm dev` uses it.
- **`apps/server/.env.live`:** the live Arc creds (`RELAYER_PRIVATE_KEY`,
  `VAULT_ADDRESS`, `COMPLIANCE_GUARD_ADDRESS`, `LIVE_GATEWAY`). For the on-chain
  proof: `cp .env.live .env` (or pass inline) then `prove:split`. Both `.env*`
  are gitignored — **never commit keys.**
- **Reading-agent LLM:** via **OpenRouter** (OpenAI SDK, `baseURL`
  `https://openrouter.ai/api/v1`), model `deepseek/deepseek-v4-pro` (override
  `OPENROUTER_MODEL`). No key → deterministic heuristic fallback. NOT Anthropic.

---

## 5. Working commands

```bash
pnpm install                      # from repo root
pnpm --filter @arcane/server dev  # backend on :8787  (mirror mode)
pnpm --filter @arcane/web dev     # storefront on :3000
pnpm test                         # Vitest (server) — keep green
pnpm typecheck                    # tsc across the workspace — keep clean
cd contracts && forge test -vvv   # 28 Foundry tests
```

Demo API key (seeded): `arc_test_sk_demo_0001`.

---

## 6. Discipline that wins this hackathon

1. **Traction is generated, not awaited.** Always have a live URL taking real
   (tiny) payments. Seed creators, run the buyer agent, share the link. Never
   build a feature whose traction depends on strangers integrating.
2. **Lead with the split.** Single-piece unlock + tipping are table stakes;
   cross-chain auto-split is the differentiator. Every demo shows the fan-out.
3. **Keep mirror mode working with zero keys** so the demo never depends on a
   funded wallet. Light up live rails for the *proof*, not the *demo path*.
4. **Keep `pnpm test` and `pnpm typecheck` green** before every commit.

When you finish a unit of work, update `SPLITSTREAM_PLAN.md` (the build-state
section) so the next session knows exactly where to resume.
