# Live x402 settlement on Arc — runbook

This turns the x402 paid-call flow into **real money on Arc Testnet**: the agent
pays real devnet USDC, SplitStream verifies it on-chain before serving, and each
API owner is paid their split in real USDC on Arc.

It's gated by `LIVE_X402=true` + a funded relayer so the demo path (mirror mode)
always works keyless. The verification path is already proven live against Arc
RPC (chain `5042002`); this runbook is the funded end-to-end run.

## What's real vs. what you provide

| Piece | Status |
|---|---|
| Verify agent's USDC payment on Arc (`verifyArcUsdcPayment`) | ✅ real, reads Arc RPC |
| Single-use nonce + single-use tx-hash anti-replay | ✅ real |
| Pay each contributor real USDC on Arc (`payContributorsOnArc`) | ✅ real (relayer `transfer`) |
| **Funded relayer + faucet USDC + an agent wallet** | ⬅ you provide |

EVM contributor addresses receive on Arc directly. Solana contributors are
reported `skipped` on the Arc-native path (route them cross-chain via CCTP).

## Prerequisites

1. **Relayer key**, funded with Arc Testnet USDC (USDC is the gas token):
   - Faucet: <https://faucet.circle.com> → "Arc Testnet" → the relayer address.
   - This is the address in `apps/server/.env.live` (`RELAYER_PRIVATE_KEY`).
2. **An agent wallet** with some Arc Testnet USDC (it pays per call).
3. **An API piece whose contributors use EVM addresses** (so they're paid on Arc).

## Run

```bash
# 1. Boot the server in live x402 mode
cd apps/server
cp .env.live .env          # has RELAYER_PRIVATE_KEY + LIVE_X402=true
bun run src/index.ts        # /health → onchainEnabled: true

# 2. Register an API with EVM-address contributors (these get real USDC on Arc)
curl -X POST localhost:8787/api/v1/pieces -H 'content-type: application/json' \
  -H 'x-api-key: arc_test_sk_demo_0001' \
  -d '{"title":"My Live API","kind":"api","priceUSDC":"0.01",
       "endpoint":"https://api.frankfurter.app/latest?from=USD&to=EUR",
       "contributors":[{"role":"owner","address":"0xYourArcEvmAddress","targetChain":"base","splitBps":10000}]}'

# 3. AGENT: hit /call with no payment → get the 402 challenge (note payTo + amount)
curl -i -X POST localhost:8787/api/v1/pieces/<id>/call \
  -H 'content-type: application/json' -d '{}'
#    → 402 + accepts[0]: { maxAmountRequired, payTo:<relayer addr>, asset:<USDC>, nonce }

# 4. AGENT: send `maxAmountRequired` USDC on Arc to `payTo` (the relayer).
#    Use any wallet / viem / the Circle CLI. Capture the tx hash.

# 5. AGENT: retry with the X-PAYMENT proof carrying that tx hash:
PROOF=$(printf '{"x402Version":1,"scheme":"exact","network":"arc-testnet","payload":{"nonce":"<nonce>","from":"0xAgent","authorization":"<txHash>"}}' | base64 -w0)
curl -i -X POST localhost:8787/api/v1/pieces/<id>/call \
  -H 'content-type: application/json' -H "x-payment: $PROOF" -d '{}'
#    → 200, mode:"live-arc", payments:[{ txHash:<real Arc tx>, status:"paid" }], upstream:{…}
```

On success the response's `payments[].txHash` are **real Arc Testnet transfers**
to the API owners — look them up at <https://testnet.arcscan.app/tx/...>.

## How it works (the two real legs)

1. **Money in** — `verifyArcUsdcPayment` (`services/x402Settle.ts`) fetches the
   tx receipt on Arc, confirms a USDC `Transfer` to `payTo` for ≥ the price, and
   the tx hash is redeemed single-use. No verification → no service.
2. **Money out** — `payContributorsOnArc` has the relayer `transfer` each
   contributor their `computeSplit` share in real USDC on Arc.

## Hardening before mainnet

- **Encrypt stored upstream secrets** at rest (vault + rotation).
- **Confirmations / reorg safety** — Arc has deterministic BFT finality (1 conf),
  but verify `payTo`/amount exactly and consider waiting for the receipt block.
- **Fee** — today the full price is split to owners; take a platform fee out of
  the price if desired (net it in `computeSplit` inputs).
- **Cross-chain payout** for non-Arc contributors via the existing CCTP path.
