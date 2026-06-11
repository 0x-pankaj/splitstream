# Arcane Treasury — Roadmap

Status legend: ✅ shipped & proven live · 🟡 partial / simulated · ⛔ not started

---

## v1 — The real CCTP spine (✅ shipped)

**One-liner:** A Web2 platform funds an Arc vault once, then bulk-pays global
creators across EVM chains. Settlement is real CCTP; all fees are paid in USDC.

```
[ Web2 Client ERP / API ]
        │  POST /api/v1/payouts/bulk  (Zod-validated, x-api-key scoped)
        ▼
[ ArcaneTreasuryVault @ Arc L1 ]  ── executeIntent() debits tenant, pays solver,
        │                            routes convenience fee, locks network fee
        │  (ArcaneComplianceGuard: 24h velocity + per-tenant recipient allowlist)
        ▼  CCTP V2 burn on Arc (domain 26)
[ Circle Forwarding Service ]  ── mints native USDC on destination, no dest gas,
        │                          no pre-funded dest liquidity, no kit key
        ▼
[ Creator wallet on Base / Ethereum / Arbitrum ]
```

What's real (proofs in [`README.md`](./README.md#live-deployment-to-arc-testnet)):

| Capability | Status |
|---|---|
| Contracts deployed live on Arc Testnet (`5042002`) | ✅ Vault `0x72dC…fAF5`, Guard `0xf9E0…368f` |
| Live `executeIntent` round-trip on Arc | ✅ |
| Backend live mode (`onchainEnabled: true`) drives real on-chain debits | ✅ |
| Real CCTP delivery Arc → Base / Ethereum / Arbitrum (`LIVE_BRIDGE=true`) | ✅ proven Arc→Base Sepolia |
| Compliance guard (velocity + recipient allowlist) | ✅ enforced in `executeIntent` |
| USYC yield sweep/unwind interface | ✅ (MockUSYCTeller in demo; real Teller is Entitlements-gated) |
| Sub-500ms **instant/Gateway** path | ✅ implemented — real `unifiedBalance.spend` (`LIVE_GATEWAY=true`); pending a funded live proof |
| **Solana** delivery | ✅ wired into the real CCTP path (Arc → Solana Devnet, forwarder); recipient must be a USDC ATA; pending a funded live proof |
| StableFX EUR→EURC | 🟡 hardcoded 0.92 fallback rate |

**v1 hardening before an investor demo:**
- Remove/flag the silent `catch {}` in `cctp.ts` so a live bridge failure is
  loud, not quietly downgraded to a simulated receipt. A demo must provably run
  `mode: "live"` with a real `burnTxHash`.
- For an all-real demo set `INSTANT_PATH_THRESHOLD_USDC=0` so every payout takes
  the real CCTP path (no simulated legs).
- Surface real burn/mint explorer links per payout leg on the web dashboard.

---

## v2 — Intent-based solver mesh, genuine sub-500ms (🟡 next)

**The target flow (as designed):**

```
[ Web2 Client ERP / API ]
        │  (Triggers Payout Request JSON)
        ▼
[ Arc Vault Smart Contract (Source Chain) ]
        │
        ├───────────────────┬───────────────────┐
        ▼ (Intent Routing)  ▼ (Intent Routing)  ▼ (Intent Routing)
  [ Solver Mesh ]      [ Solver Mesh ]      [ Solver Mesh ]
        │ (Sub-500ms Fill)  │ (Sub-500ms Fill)  │ (Sub-500ms Fill)
        ▼                   ▼                   ▼
  (Target: Base)      (Target: Arbitrum)  (Target: Solana)
        ▼                   ▼                   ▼
 [ Creator Wallet A ] [ Creator Wallet B ] [ Creator Wallet C ]
        │                   │                   │
        └─────── solver reimbursed on Arc via executeIntent() ◄──────┘
                 (after destination receipt is RPC-verified)
```

The on-chain reimbursement leg already exists and is proven (`executeIntent`).
The closed loop above adds the missing front half: the instant fill and the
verification before reimbursement.

**Engineering plan (don't recruit a market-maker network on day one):**

- **2a — Make the instant rail real via Circle Gateway. ✅ DONE (code).**
  Implemented in `apps/server/src/services/gatewayUnifiedBalance.ts` as a real
  `kit.unifiedBalance.spend` (burn from the Arc float → Forwarding Service mint),
  gated by `LIVE_GATEWAY=true`. Proof scripts: `make gateway-deposit` then
  `make prove-gateway`. Remaining: run it once against a funded float to capture
  live tx hashes (no code left).
- **2b — Run yourself as solver #1.** Front your own liquidity (the way
  Across / UniswapX bootstrapped). The `solverMesh.ts` round-robin already
  models this; you are simply the only solver until volume justifies more.
- **2c — Real destination receipt verification.** `solverMesh.verifyReceipt()`
  must query an independent destination-chain RPC and confirm the transfer
  *before* `executeIntent` reimburses the solver on Arc. Today it only checks a
  hash exists — that's the trust gap to close.
- **2d — Solana delivery. ✅ DONE (CCTP path).** `bridgeCctp.ts` now maps
  `solana → Solana_Devnet` via the Forwarding Service (recipient must be a USDC
  ATA). Gateway-Solana for the instant path is still TODO. Pending a funded proof.

**Why a third-party solver mesh is v3, not v2:** the hard part is liquidity and
business development (institutional market-makers with pre-funded hot wallets on
every chain), not code. Open the WebSocket mesh in `solverMesh.ts` to external
solvers only once there is payout volume to attract them. Until then, Circle
Gateway + first-party liquidity delivers the same sub-500ms UX with far less
operational risk.
