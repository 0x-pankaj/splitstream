# Using SplitStream from the CLI / an AI agent

SplitStream is built for agents: an AI discovers a piece or paid API, pays a
sub-cent price in USDC, and gets the content / upstream response back — no API
key, no signup, no KYC. There are three ways to drive it from a terminal.

Live API base: **`https://splitstream-api-production.up.railway.app`**
(set `SS_BASE` to point the bundled scripts at it).

---

## 1. The fastest path — Claude Code MCP (local)

Register SplitStream as an MCP server and Claude Code gets tools to browse and
pay creators directly in chat:

```bash
claude mcp add splitstream -- bun run /home/pankaj/turbine/splitstream/apps/server/src/mcp/stdio.ts
```

Tools exposed: `list_pieces`, `pay_for_piece`, `call_api`,
`get_treasury_balance`, `set_agent_policy`. Try:

> "List the SplitStream pieces, then pay for the FX API and show me the result."

This runs a local, self-contained instance (its own seeded catalog, simulated
settlement) — perfect for demoing the agent loop offline. For **real** on-chain
settlement against the deployed service, use path 2 or 3.

---

## 2. Real money — pay the live x402 endpoint with a Circle agent wallet

This is the production path: an autonomous agent pays **real USDC on Arc** and is
served only after the payment is verified on-chain.

```bash
# A) Give your agent a funded Circle wallet (USDC on Arc) — once.
circle wallet login            # email + OTP
circle wallet create
circle wallet balance          # confirm it holds Arc USDC (fund from the faucet)

# B) Discover a paid API, then pay per call. The endpoint speaks HTTP 402:
#    no payment → 402 + PaymentRequirements; pay the USDC on Arc; retry with the
#    X-PAYMENT proof → 200 + the upstream result.
curl -i -X POST https://splitstream-api-production.up.railway.app/api/v1/pieces/piece-fx-api-001/call
```

The 402 response carries `accepts[].payTo`, `maxAmountRequired`, `asset` (USDC),
`network` (`arc-testnet`), and a single-use `nonce`. Your agent sends that much
USDC to `payTo` on Arc, then retries the POST with a base64 `X-PAYMENT` header
referencing the settlement tx. On success you get `200` + an `X-PAYMENT-RESPONSE`
header, and the API owner is paid their split in real USDC — which then shows up
on the storefront's **"Real USDC settled on Arc"** panel with a clickable tx.

> Rescue tip: if an agent ever says "I can't search that / I'm behind a paywall /
> I have no API key", that is exactly what this endpoint solves — pay-per-call in
> stablecoin removes the key/account/billing blockers.

---

## 3. Reproduce the whole loop with the bundled scripts

Point the scripts at the live API and run the same handshake an x402 agent does:

```bash
# The x402 challenge → pay → serve handshake (replay-protected):
SS_BASE=https://splitstream-api-production.up.railway.app \
  bun run apps/server/scripts/x402-call.ts piece-fx-api-001

# The fully autonomous real-USDC loop on Arc (needs a funded wallet + LIVE_X402):
bun run apps/server/scripts/x402-live-loop.ts
```

`x402-live-loop.ts` funds a fresh agent wallet, has it pay real USDC for a call,
verifies the payment on-chain, and pays the owner their split — printing every
Arc tx hash. That is the "nothing simulated" proof.

---

## What an agent pays for vs what a human pays for

- **Agent (x402):** pays **per call**. Metered consumption is the point — each
  call buys one fresh upstream response. The agent carries no reader identity.
- **Human (storefront):** pays **once per piece** and keeps access. The unlock
  grants a durable entitlement (keyed to a wallet / browser id), so refreshes and
  return visits re-read for free.

Same settlement engine underneath; the presence of a reader id is the switch.
