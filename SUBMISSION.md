# SplitStream — Lepton Agents Hackathon submission

**Pay-per-use for any API or piece of content, settled in real USDC on Arc — with
each payment auto-split across every contributor's chain.**

> Like pay.sh's x402 pay-per-call, plus instant cross-chain revenue splitting and
> no-KYC access to authenticated APIs. **Proven live on Arc Testnet with real USDC.**

## The problem (RFB 06 — Creator & Publisher Monetization)

Subscriptions and signups don't fit per-piece value. A reader shouldn't sign up
to pay $0.05 for one article; an AI agent shouldn't do KYC and manage an API key
to make one paid call. And when content has many contributors, paying each one —
on the chain they want — is a back-office nightmare. Sub-cent, per-use payment
was never economical… until Arc: USDC-native gas, sub-second deterministic
finality, USDC-native settlement.

## What we built

One engine, two front doors, every payment splits across chains:

1. **Per-piece content** — unlock an article/song/photo for a few cents; the
   price fans out to writer (Base), editor (Arbitrum), photographer (Solana)
   instantly.
2. **Pay-per-call APIs (x402)** — register any API by URL + price; an agent pays
   per call via the real HTTP **402 challenge-response** and gets the result.
   We hold + inject the seller's upstream key, so the agent buys access to an
   **authenticated** API **without an account or KYC** — and never sees the key.
3. **Autonomous AI buyer** — an agent with its own wallet discovers (MCP),
   decides (LLM via OpenRouter), and pays per use, with on-chain spend caps.

## Proven live on Arc Testnet (real USDC, no mock)

`scripts/x402-live-loop.ts` ran the entire loop on chain `5042002`:
autonomous agent funded → 402 → **real USDC payment** → **on-chain verification**
→ API owner **paid real USDC** → live result returned. Owner balance `0 → 0.01`.

| Leg | Arc Testnet tx |
|---|---|
| Fund buyer agent wallet | `0xfe6d4349…f7849ebf` |
| Agent pays for the call | `0xdf1ff4e1…ea8e5042` |
| Owner paid the split | `0x581fa957…e9457f10d` |

The agent signed every payment with its **own key** — autonomous, no human.

## How it maps to the judging rubric

- **Agentic sophistication (30%)** — an AI agent autonomously discovers, decides,
  and *pays real USDC on-chain* with its own wallet and spend caps. Agent-to-
  creator and agent-to-API commerce, no human in the loop.
- **Traction (30%)** — every unlock / paid call is a real payment to a creator or
  API owner; the storefront shows a live "total paid to creators" counter, and
  the live loop produces real on-chain Arc payouts you can verify on the explorer.
- **Circle / Arc usage (20%)** — Arc L1 (USDC-native gas, sub-second finality),
  USDC ERC-20 settlement on Arc, x402 standard, Circle CCTP (proven Arc→Base) and
  Gateway instant path for cross-chain legs. Live contracts on Arc Testnet.
- **Innovation (20%)** — *a payment that fans out.* pay.sh moves money A→B;
  SplitStream takes one sub-cent payment and pays N contributors across chains in
  one shot — plus no-KYC access to authenticated APIs via credential injection.

## Architecture (one engine)

```
Reader / AI agent ──pays sub-cent USDC──▶ SplitStream (x402 facilitator on Arc)
                                              │
                          verify payment on Arc · inject seller key · proxy
                                              │
        ┌──────────────────────────┬─────────┴───────────────┐
        ▼                          ▼                          ▼
  writer · Base            editor · Arbitrum         photographer · Solana
  (or: API owner gets paid real USDC on Arc; multi-owner APIs split too)
```

Built on the proven settlement spine: live contracts on Arc Testnet, real CCTP
Arc→Base, Circle Gateway instant path, agent spend-cap policies.

## Try it in 60 seconds

```bash
pnpm install
pnpm --filter @arcane/server dev      # backend :8787 (keyless mirror demo)
pnpm --filter @arcane/web dev         # storefront :3000
```

- `/` — unlock content (cross-chain split reveal) + the AI reading-agent + live counter
- `/publish` — register a content piece or a paid API (with optional upstream auth)
- Real x402 handshake: `pnpm --filter @arcane/server x402:call`
- Real on-chain settlement: see `LIVE_X402_RUNBOOK.md`

## Honest status

Real and proven: the x402 protocol, on-chain payment verification, real USDC
payout to EVM owners on Arc, cross-chain split math, credential injection, live
upstream calls. Mirror mode (default) simulates only the *settlement* so the demo
is keyless. Remaining before mainnet: encrypt upstream secrets at rest, native
Solana payout (EVM contributors paid directly; Solana via CCTP), and netting a
platform fee out of the price.

## Links

- Live URL: _add your deployment_
- Demo video (<3 min): _add Loom/YouTube_
- Repo: this repository
