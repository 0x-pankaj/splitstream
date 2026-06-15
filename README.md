# SplitStream

**Per-piece creator monetization with instant cross-chain revenue splitting, on Circle's Arc L1.**

A reader — or an AI agent — pays a few cents to unlock a single article, photo,
or song. That payment is **split instantly across every contributor**, each paid
on the chain they prefer (Base, Arbitrum, Ethereum, Solana), settling in under
500ms on Arc. No subscription. No signup or KYC for the reader. No gas tokens.

> Built for the **Lepton Agents Hackathon** (Canteen × Circle × Arc).
> RFB: *"Monetize a single article, photo, or song, without forcing readers into
> a monthly commitment."* Traction metric: **creators earning · total creator payouts.**

## Why it's different

Most pay-per-article demos pay one creator. SplitStream's headline is the one
thing that's hard: **a single $0.05 unlock fans out to the writer (Base), the
editor (Arbitrum), and the photographer (Solana) — instantly, no gas tokens, no
payroll batch.** It runs natively because the settlement engine underneath was
built as a multi-recipient, cross-chain payout splitter.

Three things, all live and demoable with zero keys:

1. **Unlock → split.** Pay per piece; the price fans out to every contributor on
   their own chain via Arc Gateway (instant) / CCTP. (`POST /api/v1/pieces/:id/pay`)
2. **Storefront + live traction counter.** A public page anyone can browse and
   pay from, with a running **total-creator-payouts** counter — the hackathon
   metric, front and center.
3. **AI reading agent.** An autonomous agent reads the catalog, *decides* what's
   worth unlocking within a budget, and pays the creators per piece — agent-to-
   creator commerce, no human in the loop. Also exposed over **MCP** so external
   agents can discover and pay creators.

## Quick start (the demo path — no keys needed)

```bash
pnpm install

# Backend on :8787 (mirror mode — simulated settlement, always works)
pnpm --filter @arcane/server dev

# Storefront on :3000
pnpm --filter @arcane/web dev
```

Open <http://localhost:3000>:
- The **live traction counter** (total creators paid, unlocks, chains).
- **Unlock for $0.05** on a piece → watch the cross-chain fan-out reveal (each
  creator, their chain, tx hash, latency).
- **"Let the agent read & pay"** → the AI agent autonomously unlocks and pays.

Shareable single-piece link: `/piece/<id>`. The old B2B treasury console (this
project's origin) still lives at `/dashboard`.

### Try the API directly

```bash
# Unlock a piece — splits across contributors on their chains
curl -X POST localhost:8787/api/v1/pieces/piece-arc-frontier-001/pay \
  -H 'content-type: application/json' -d '{"payer":"demo"}'

# Let the reading agent read & pay creators autonomously
curl -X POST localhost:8787/trpc/agent.read -H 'content-type: application/json' \
  -d '{"interests":["stablecoin","arc"],"maxUnlocks":5,"budgetUSDC":"0.50"}'
```

## Register your own API for agents to pay per call (x402 / pay.sh-style)

A piece can be a **paid API service** (`kind: "api"`): you register your app's
endpoint with a per-call price and a revenue split; an AI agent discovers it,
**pays the sub-cent price on Arc, and the platform proxies one call to your
endpoint and returns the response.** No API keys to issue, no billing setup —
stablecoin pay-per-call.

```bash
# SELLER: register your API (price + upstream endpoint + who gets paid)
curl -X POST localhost:8787/api/v1/pieces -H 'content-type: application/json' \
  -H 'x-api-key: arc_test_sk_demo_0001' \
  -d '{"title":"My App: FX Rates","kind":"api","priceUSDC":"0.01",
       "endpoint":"https://api.frankfurter.app/latest?from=USD&to=EUR","httpMethod":"GET",
       "contributors":[{"role":"api owner","address":"0x4444…","targetChain":"base","splitBps":10000}]}'

# AGENT (or anyone): pay $0.01 and get the live upstream result back
curl -X POST localhost:8787/api/v1/pieces/piece-fx-api-001/call \
  -H 'content-type: application/json' -d '{"payer":"agent-bob"}'
# → { "unlock": {…paid+split…}, "upstream": { "ok": true, "status": 200, "body": { "rates": { "EUR": 0.86 } } } }
```

Sellers can do this from the UI too — **`/publish`** registers either a content
piece or a paid API. Agents discover and pay via the MCP tools `list_pieces` +
`call_api`. The payment still splits across chains, so an API with multiple
owners is paid out automatically.

## The split engine (reuses a proven Arc settlement spine)

A piece payment *is* a bulk payout — the contributors are the recipients, their
`splitBps` are the amounts. So `payForPiece` builds a `BulkPayoutInput` and calls
the proven `processBulkPayout`, getting cross-chain routing, compliance, the
audit log, and Arc settlement for free.

| | Instant path | Whale path |
|---|---|---|
| Range | < $5,000 (per-piece is always tiny → here) | ≥ $5,000 |
| Rail | Solver mesh → **Circle Gateway** (unified balance) | **Native CCTP V2** |
| Latency | < 500 ms | ~1–15 min |
| Settlement | reimbursed on Arc via `executeIntent` | canonical burn / mint |

`computeSplit` distributes the price by basis points and assigns the rounding
dust to the largest share, so contributor shares always sum to the price exactly.

## The reading agent (agentic layer)

`apps/server/src/services/readingAgent.ts` decides which pieces to unlock and
pays creators within a budget and unlock ceiling (enforced in code; the model
only chooses). Two modes:

- **heuristic** (default) — deterministic interest-keyword scoring. Always runs.
- **llm** — when `OPENROUTER_API_KEY` is set, an LLM via **OpenRouter** (model
  `deepseek/deepseek-v4-pro`, override `OPENROUTER_MODEL`) ranks the catalog and
  explains each choice. Falls back to the heuristic on any error.

MCP tools for external agents:

```bash
claude mcp add splitstream -- bun run apps/server/src/mcp/stdio.ts
```

`list_pieces`, `pay_for_piece` (+ the inherited treasury tools). Any agent can
discover a piece and pay its creators, bounded by optional on-chain spend caps.

## Live proof on Arc Testnet (chain `5042002`)

SplitStream rides the parent engine's **already-deployed, already-proven** rails:

| Contract | Address |
|---|---|
| ArcaneComplianceGuard | [`0xf9E0117e2506182690e009B9dB78456DE270368f`](https://testnet.arcscan.app/address/0xf9E0117e2506182690e009B9dB78456DE270368f) |
| ArcaneTreasuryVault | [`0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5`](https://testnet.arcscan.app/address/0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5) |

Real cross-chain settlement, proven Arc → Base Sepolia via CCTP V2 + Circle's
Forwarding Service (no destination gas, no pre-funded liquidity):

- burn on Arc: [`0x2a7c97cb…`](https://testnet.arcscan.app/tx/0x2a7c97cbc6772d3f2a89235f78547857eb3e9d38f7399f201371e87da7516011)
- mint on Base: [`0x1105e368…`](https://sepolia.basescan.org/tx/0x1105e368ceb4ef5390bbfe2aeaae6db6d00b1612bdba14b077283833a9531b7c)

**Capture a live split** (one command):

```bash
# mirror (keyless) — proves the flow:
pnpm --filter @arcane/server prove:split

# live Arc settlement:
cp apps/server/.env.live apps/server/.env   # funded relayer + vault
pnpm --filter @arcane/server prove:split
```

See [`PHASE4_LIVE_PROOF.md`](./PHASE4_LIVE_PROOF.md) for the funded prerequisites.

## Configuration

`apps/server/.env` (gitignored) is the demo default: **mirror mode** +
`OPENROUTER_API_KEY` (so the agent runs in `llm` mode). Live Arc creds live in
`apps/server/.env.live`. **Never commit keys.**

## Tests

```bash
pnpm test            # Vitest: server (incl. split + agent) + shared — 40 + 12
pnpm typecheck       # tsc across the workspace
pnpm contracts:test  # Foundry (28)
```

## Monorepo layout

```
splitstream/
├── packages/shared/   Arc chain def + verified addresses, Zod schemas, the
│                      6/18 decimal-duality utils, routing/fees, splits.ts
├── contracts/         Foundry — vault + compliance guard (live on Arc), 28 tests
└── apps/
    ├── server/        Bun + Hono + tRPC — split engine, reading agent, hybrid
    │                  router (Gateway/CCTP), MCP server, prove:split
    └── web/           Next.js storefront (/), shareable /piece/[id], /dashboard
```

## The Arc precision duality (important)

USDC on Arc is one balance with two interfaces: **18 decimals native** (gas) and
**6 decimals ERC-20**. All value math uses 6dp base units (`bigint`); conversions
go through `@arcane/shared/decimals`. Never mix the two precisions.

---

*Note: internal package names are still `@arcane/*` (the proven engine's
namespace). Renaming to `@splitstream/*` is cosmetic and deferred.*
