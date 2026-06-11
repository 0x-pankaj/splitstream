# Arcane Treasury

**Stripe for cross-chain payouts, built natively on Circle's Arc L1.**

A single API lets a global platform fund once in USDC and instantly pay out
thousands of creators, contractors, or suppliers across Ethereum, Base,
Arbitrum, and Solana — **zero gas tokens, zero bridging, sub-second delivery** —
with a clean single-currency audit log for the CFO. The same engine exposes an
**MCP server** so AI agents can stream payouts within scoped, velocity-limited
policies.

> Network: **Arc Testnet** (chain id `5042002`). See [`GRANT_PROPOSAL.md`](./GRANT_PROPOSAL.md)
> for the full architecture and Arc integration matrix.

## How customers use Arcane Treasury (three surfaces)

The same engine — open an account, fund a vault once in USDC, pay out across
chains — is reachable three ways. All three drive the identical hybrid router
(Gateway instant rail < $5k, CCTP whale rail ≥ $5k) and write to the same
single-currency CFO audit log.

### 1. Directly — the web dashboard (no code)

For a CFO / ops team. Open the dashboard, click **“Open a corporate treasury
account”** (issues an API key once), fund the vault from your registered Arc
wallet, add vetted payees, build a batch, and hit **Settle**. The audit log
shows each leg with its real burn→mint **“Settled in”** time and explorer links.

```bash
pnpm --filter @arcane/web dev      # → http://localhost:3000
```

### 2. Programmatically — REST API + TypeScript SDK

For a platform integrating payouts into its own backend. Every call is a scoped
`x-api-key` REST request; the [`@arcane/sdk`](./packages/sdk) package is a thin,
zero-dependency typed wrapper.

```ts
import { ArcaneClient } from "@arcane/sdk";

// One-time: open an account and get an API key
const acct = await ArcaneClient.signup({ name: "Globex Inc.", onchainAddress: "0x…" });

const arcane = new ArcaneClient({ apiKey: acct.apiKey });
await arcane.recipients.add({ address: "0x1111…", targetChain: "base" });

const batch = await arcane.payouts.create({
  idempotencyKey: "payroll-2026-06",
  payouts: [
    { recipientAddress: "0x1111…", targetChain: "base",     amountUSDC: "250"   }, // instant · Gateway
    { recipientAddress: "0x3333…", targetChain: "ethereum", amountUSDC: "75000" }, // whale · CCTP
  ],
});
console.log(batch.results[0].destinationTxHash, batch.results[0].settlementMode);
```

Or hit the raw endpoint with `curl` — see [Try the REST gateway directly](#try-the-rest-gateway-directly).

### 3. Autonomously — MCP for AI agents

For an AI agent (Claude, etc.) running treasury operations within a scoped,
velocity-limited policy. The server is also an MCP server exposing
`submit_bulk_payout`, `get_treasury_balance`, `simulate_route`, `get_audit_log`,
and `set_agent_policy`. See [MCP server](#mcp-server-autonomous-treasury-for-ai-agents).

## Monorepo layout

```
arcane-treasury/
├── packages/shared/     @arcane/shared — Arc chain def + verified addresses,
│                        Zod schemas, the 6/18 decimal-duality utils, routing/fees
├── contracts/           Foundry — ArcaneTreasuryVault, ArcaneComplianceGuard,
│                        mocks, 28 tests, deploy + live-demo scripts
└── apps/
    ├── server/          Bun + Hono + tRPC — hybrid router, solver mesh (Gateway),
    │                    CCTP whale path, StableFX swap, agent treasury, MCP server
    └── web/             Next.js CFO dashboard (audit log, routing visualizer,
                         agent-wallet monitor, solver mesh, USYC yield)
```

## The hybrid split-routing engine

| | Instant path | Whale path |
|---|---|---|
| Range | < $5,000 (configurable) | ≥ $5,000 |
| Rail | Solver Mesh → **Circle Gateway** (unified balance) | **Native CCTP V2** |
| Latency | < 500 ms | ~1–15 min |
| Settlement | reimbursed on Arc via `executeIntent` | canonical burn/mint |

EUR recipients are auto-converted USDC→EURC via **StableFX / App Kit Swap**.
Idle vault float can be swept into **USYC** for yield.

## Prerequisites

- Node ≥ 22, **pnpm** ≥ 10, **Bun** ≥ 1.3
- **Foundry** (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)

## Quick start

```bash
pnpm install

# 1. Contracts — compile + run the 28-test Foundry suite
pnpm contracts:build
pnpm contracts:test

# 2. Backend engine (Bun + Hono + tRPC) on :8787 — runs in simulated mode
#    out of the box (no keys needed); upgrades to live Arc calls when configured
pnpm --filter @arcane/server dev

# 3. CFO dashboard on :3000
pnpm --filter @arcane/web dev
```

Open <http://localhost:3000>. The demo API key is `arc_test_sk_demo_0001`.

### Try the REST gateway directly

```bash
curl -X POST localhost:8787/api/v1/payouts/bulk \
  -H 'content-type: application/json' \
  -H 'x-api-key: arc_test_sk_demo_0001' \
  -d '{
    "tenantId":"00000000-0000-4000-8000-000000000001",
    "idempotencyKey":"readme-demo-0001",
    "payouts":[
      {"recipientAddress":"0x1111111111111111111111111111111111111111","targetChain":"base","amountUSDC":"250","currencyCode":"USD"},
      {"recipientAddress":"0x3333333333333333333333333333333333333333","targetChain":"ethereum","amountUSDC":"75000","currencyCode":"USD"}
    ]
  }'
```

The $250 routes to the instant (Gateway) path via the solver mesh; the $75,000
routes to the whale (CCTP) path.

## Tests

```bash
pnpm test                 # turbo: server (Vitest, 23) + shared (Vitest, 12)
pnpm contracts:test       # Foundry (28)
```

## MCP server (Autonomous Treasury for AI agents)

```bash
# register with Claude Code
claude mcp add arcane-treasury -- bun run apps/server/src/mcp/stdio.ts
```

Tools: `submit_bulk_payout`, `get_treasury_balance`, `simulate_route`,
`get_audit_log`, `set_agent_policy`. Agent-initiated payouts are checked against
the agent wallet's per-transaction / daily / weekly / monthly USDC caps.

## Live deployment to Arc Testnet

**✅ Already deployed & round-tripped live** (chain `5042002`):

| Contract | Address |
|---|---|
| ArcaneComplianceGuard | [`0xf9E0117e2506182690e009B9dB78456DE270368f`](https://testnet.arcscan.app/address/0xf9E0117e2506182690e009B9dB78456DE270368f) |
| ArcaneTreasuryVault | [`0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5`](https://testnet.arcscan.app/address/0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5) |
| Live `executeIntent` tx | [`0x12c8b4…0c6954`](https://testnet.arcscan.app/tx/0x12c8b4fa8d6fe11ba63ee60b9af6347454f02db2fb4bac352a9f88f5960c6954) |

The deposit → `executeIntent` → yield lifecycle is fully proven by the Foundry
suite. To reproduce the live deployment yourself:

```bash
# 1. A throwaway deployer key is in contracts/.env. Fund its address with Arc
#    Testnet USDC (USDC is the gas token) at the Circle Faucet:
#    https://faucet.circle.com  →  select "Arc Testnet"
#    Address: 0x8984EF18c6d128C47463405fdd01f833f4D7154c

# 2. Deploy the stack AND run a real deposit + executeIntent round-trip,
#    logging every tx hash:
bash scripts/deploy-live.sh
#
#    (We use forge create + cast send rather than `forge script` because Arc's
#    native USDC calls an on-chain blocklist precompile that Foundry's LOCAL EVM
#    can't simulate — see the script header.)
```

### Live backend mode (proven)

`apps/server/.env` is already configured with the relayer key + deployed
`VAULT_ADDRESS` / `COMPLIANCE_GUARD_ADDRESS`, so `pnpm --filter @arcane/server dev`
boots in **live on-chain mode** (`/health` shows `onchainEnabled: true`). A
`POST /api/v1/payouts/bulk` then drives a real `executeIntent` on Arc L1 — the
tenant's on-chain vault balance debits for real. Proven live:
[`0x85609be3…d76af7dc`](https://testnet.arcscan.app/tx/0x85609be3de9435e026bdb671488151d33129064a7d924ada2cac638cd76af7dc).
Delete `apps/server/.env` to fall back to mirror/simulated mode.

### Real cross-chain delivery (CCTP, `LIVE_BRIDGE=true`)

The **whale path is real end-to-end**: a payout burns USDC on Arc via CCTP V2 and
Circle's **Forwarding Service** mints native USDC on the destination chain — no
pre-funded destination liquidity, no destination gas, no kit key. Proven Arc →
Base Sepolia, driven by the REST API:

- burn on Arc: [`0x2a7c97cb…`](https://testnet.arcscan.app/tx/0x2a7c97cbc6772d3f2a89235f78547857eb3e9d38f7399f201371e87da7516011)
- mint on Base: [`0x1105e368…`](https://sepolia.basescan.org/tx/0x1105e368ceb4ef5390bbfe2aeaae6db6d00b1612bdba14b077283833a9531b7c)

With `LIVE_BRIDGE=true`, payouts ≥ the threshold to **Base / Ethereum / Arbitrum**
settle for real via CCTP. Set `INSTANT_PATH_THRESHOLD_USDC=0` to force every
payout through the real CCTP path. The standalone proof is
`bun run apps/server/scripts/bridge-arc-to-base.ts <amount> <recipient>`.

**Solana delivery** is now wired into the same real CCTP path (Arc → Solana
Devnet via the Forwarding Service). Note: for Solana the recipient must be a USDC
token account (ATA), not a raw wallet address.

### Instant rail (Circle Gateway, `LIVE_GATEWAY=true`)

The sub-500ms instant path is now a **real Circle Gateway unified-balance spend**
(`apps/server/src/services/gatewayUnifiedBalance.ts`): the platform funds a USDC
float in its Gateway balance on Arc once (`unifiedBalance.deposit`), and each
below-threshold payout burns from that Arc balance → Forwarding Service mints
native USDC to the recipient on the destination chain in <500ms — no destination
wallet, no destination gas, no kit key. Enable with `LIVE_GATEWAY=true` (requires
a funded relayer Gateway balance on Arc). Without it, the instant path returns a
deterministic sub-500ms simulated receipt so the engine stays demoable.

Standalone proofs (set `RELAYER_PRIVATE_KEY`, fund it with Arc Testnet USDC):

```bash
make gateway-deposit AMOUNT=1.00          # one-time: fund the Gateway float on Arc
make prove-gateway   AMOUNT=0.25 TO=0x…   # real <500ms Arc → Base Sepolia spend
make gateway-balance                      # inspect the unified balance
make prove-cctp      AMOUNT=0.50 TO=0x…   # real ~8s CCTP whale-path settlement
```

Both live rails now **fail loudly**: a live CCTP or Gateway settlement error
throws instead of silently downgrading to a simulated receipt, so the audit log
never reports an unsettled payout as settled.

## The Arc precision duality (important)

USDC on Arc is one balance with two interfaces: **18 decimals native** (gas) and
**6 decimals ERC-20**. All value math in this codebase uses 6dp base units;
conversions go through `@arcane/shared/decimals` (`to6`/`to18`). Never mix the
two precisions. (`PREVRANDAO` is also always `0` on Arc — solver selection is
deterministic round-robin, never random.)
