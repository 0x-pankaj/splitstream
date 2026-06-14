# Phase 4 — Live Proof on Arc

SplitStream rides the **same proven rails** the parent engine already shipped:
real contracts on Arc Testnet (chain `5042002`), real CCTP (Arc→Base settlement
with captured tx hashes — see the root `README.md`), and the Circle Gateway
instant path. Phase 4 is about producing **one captured, real per-piece split**
for the demo video.

## The one command

```bash
# Mirror (no keys — proves the flow, used in the demo path):
pnpm --filter @arcane/server prove:split

# Live (real Arc Testnet settlement):
RELAYER_PRIVATE_KEY=0x... VAULT_ADDRESS=0x... COMPLIANCE_GUARD_ADDRESS=0x... \
LIVE_GATEWAY=true \
pnpm --filter @arcane/server prove:split
```

It runs one real unlock of the seeded `$0.05` piece through the **exact engine
the storefront uses** (`payForPiece` → `processBulkPayout`) and prints each
contributor's settlement with Arc explorer links.

## What is already real vs. what the funded run adds

| Layer | Status |
|---|---|
| Contracts deployed on Arc Testnet (`ArcaneTreasuryVault`, `ArcaneComplianceGuard`) | ✅ live (addresses in root README) |
| CCTP whale-path settlement (Arc burn → destination mint) | ✅ proven with real tx hashes (README) |
| Gateway instant-path code (`gatewayUnifiedBalance.ts`) | ✅ implemented, gated by `LIVE_GATEWAY` |
| SplitStream unlock → cross-chain split, mirror mode | ✅ verified (tests + HTTP + `prove:split`) |
| SplitStream unlock settling **on-chain**, live mode | ⏳ needs the funded prerequisites below |

The live split path is **wired, not simulated** — booting with the live `.env`
makes the unlock submit a real `executeIntent` to the deployed vault. It reverts
today only because the on-chain vault state isn't yet provisioned for the demo
contributors (see prerequisites). That revert is proof the call is real, not a
stub.

## Live prerequisites (the funded run)

To make a live split settle successfully, the relayer (vault owner / deployer)
must, once:

1. **Fund the vault** for the publisher tenant — deposit USDC so the on-chain
   `tenantBalances` covers the split + fees. In live mode the demo publisher
   tenant binds to the relayer address (see `seedDemo` + `index.ts`).
2. **Whitelist each contributor on-chain** in `ArcaneComplianceGuard` for that
   tenant. The engine's `addTenantRecipient` performs the on-chain whitelist in
   live mode; `prove:split` calls it via `whitelistContributors`, but the call
   must be funded and the recipients valid for their chains.
3. **For sub-cent instant settlement**, top up the platform's Arc Gateway float
   (`pnpm --filter @arcane/server gateway:deposit`) and set `LIVE_GATEWAY=true`,
   so the instant path mints native USDC on the destination via the Forwarding
   Service. Pieces are tiny, so they always route the instant path.

Use a destination chain + recipient you control (e.g. a Base Sepolia EOA you
hold) so the minted USDC is verifiable. Capture the printed `dest tx` and
`arc tx` hashes for the demo.

## Why mirror mode is the demo path

The storefront and the agent demo run in **mirror mode** so the live URL never
depends on a funded wallet — judges can click and generate traction immediately.
The live proof (`prove:split` against the funded vault, plus the existing CCTP
Arc→Base proof) is what backs the claim that the rails are real. One captured
live split is worth more than a thousand simulated ones — but it is the
*evidence*, not the *demo*.
