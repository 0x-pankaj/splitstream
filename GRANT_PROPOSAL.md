# Arcane Treasury — Arc Ecosystem Grant Proposal

> **Stripe for cross-chain payouts.** A single API that lets global platforms
> instantly pay out thousands of creators, contractors, and suppliers across
> multiple blockchains. The platform funds once in stable, predictable USDC;
> Arcane Treasury abstracts away every piece of crypto complexity — **zero gas
> tokens, zero bridging, sub-second delivery** — and hands the CFO a clean,
> single-currency audit log.

Submitted to: **Circle / Arc Ecosystem Grant Review Board**
Category: Payments · Treasury · Agentic Economy infrastructure
Network: **Arc Testnet** (chain id `5042002`)

---

## 1. The Enterprise Friction

Web2 platforms that need to pay a global, long-tail supply base — marketplaces,
gig-economy apps, ad networks, creator platforms — are structurally blocked from
adopting crypto rails by three CFO-level problems:

1. **Gas-token volatility & operational drag.** Paying out on Ethereum, Base,
   Arbitrum, and Solana means holding and continuously rebalancing ETH and SOL
   just to cover gas. That is an unhedged commodity position and a reconciliation
   nightmare no finance team wants on its balance sheet.
2. **Multichain accounting fragmentation.** Funds, fees, and balances scatter
   across N chains in N volatile units. There is no single source of truth, so
   month-end close becomes a forensic exercise.
3. **No programmable controls.** Treasury teams cannot safely delegate payout
   authority to software (let alone to AI agents) without hard, enforceable
   velocity and recipient controls.

The result: enormous demand for "pay everyone, everywhere, instantly" sits
stranded off-chain because the **unit of account and the gas token are not the
dollar.**

## 2. Why Arc Solves Exactly This

Arc is the first L1 where the friction above simply disappears, because **USDC is
the native gas token** and the chain is purpose-built for stablecoin finance:

- **USDC-denominated gas at a stable ~$0.01/tx** (EIP-1559 + EWMA smoothing) —
  the CFO never holds a volatile gas asset again.
- **Deterministic sub-second BFT finality** — payouts are irreversibly settled
  with no reorg risk, the precondition for "instant."
- **Native multi-currency stablecoins** — USDC, EURC, and yield-bearing USYC are
  first-class, enabling FX and idle-cash yield without wrapping or bridging.
- **A complete crosschain toolkit** — Circle Gateway (instant unified balance),
  CCTP V2 (canonical burn/mint), and StableFX/Swap — that Arcane Treasury
  composes into one API.

Arcane Treasury is the productized treasury layer that turns these primitives
into a drop-in **"fund once, pay everyone"** endpoint.

## 3. The Architecture — Hybrid Split-Routing

```
              POST /api/v1/payouts/bulk   (scoped x-api-key, Zod-validated)
                                 │
                    ComplianceGuard (recipient allowlist + rolling 24h velocity)
                                 │
                 EUR recipients → StableFX / App Kit Swap  (USDC → EURC, on Arc)
                                 │
                   ┌─────────────┴──────────────┐
        amount <  $5,000                amount ≥ $5,000        (configurable)
        INSTANT PATH                    WHALE PATH
        Solver Mesh, settled            Native CCTP V2 burn/mint
        via Circle Gateway              (~1–15 min, absolute
        (< 500 ms)                       cryptographic settlement)
                   └─────────────┬──────────────┘
                                 │
                   executeIntent() on ArcaneTreasuryVault (Arc L1)
                                 │
                    Single-currency CFO audit log (USDC)
```

We deliberately **split traffic by size and urgency** rather than forcing one
rail:

| | Instant path | Whale path |
|---|---|---|
| Range | $5 – $5,000 | $50,000+ |
| Rail | Solver Mesh → **Circle Gateway** unified balance | **Native CCTP V2** |
| Latency | < 500 ms | ~1–15 min |
| Risk posture | bounded by low per-tx value | absolute, Circle-guaranteed |

A creator earning $200 wants it *now*; a CFO moving a $200k supplier payment
gladly accepts a 10-minute window for cryptographic certainty. The router gives
each the right rail automatically.

> **Engineering honesty for reviewers.** The **whale path is REAL end-to-end**:
> a payout burns USDC on Arc via CCTP V2 and Circle's Forwarding Service mints
> native USDC on the destination chain (proven Arc → Base Sepolia below) — no
> pre-funded destination liquidity, no destination gas, no kit key. The **Arc L1
> settlement (`executeIntent`) is also real and on-chain.** The **instant path is
> now a real Circle Gateway unified-balance spend** (`unifiedBalance.spend`,
> `LIVE_GATEWAY=true`) — the platform pre-funds a USDC float in its Gateway
> balance on Arc once, then each sub-$5k payout settles in <500ms; the
> standalone proof scripts are `make gateway-deposit` / `make prove-gateway`.
> Both live rails fail loudly (no silent downgrade to a simulated receipt), and
> every receipt is labelled `live` or `simulated` in the audit log so nothing is
> overstated. A *third-party* solver mesh remains future work — we run as the
> first-party solver, fronting via Gateway, until payout volume justifies opening
> the mesh. Solver selection is round-robin, never random, because **Arc's
> `PREVRANDAO` always returns 0** (see §6).

## 4. The Arc Integration Matrix

Every address below is the real Arc Testnet deployment, verified against
`docs.arc.io`. Arcane Treasury touches the full stablecoin stack:

| Arc / Circle primitive | Address (Arc Testnet) | How Arcane Treasury uses it |
|---|---|---|
| **Native USDC gas** (18dp native / 6dp ERC-20) | `0x3600…0000` | Vault accounting + gas; the "fund once in USDC" asset |
| **EURC** | `0x89B5…D72a` | EUR recipient settlement currency |
| **USYC** yield token / Teller | `0xe918…b86C` / `0x9fdF…105A` | `sweepToYield` / `unwindYield` on idle treasury float |
| **CCTP V2** TokenMessenger / MessageTransmitter | `0x8FE6…2DAA` / `0xE737…CE275` | Whale-path burn/mint settlement (domain **26**) |
| **Gateway** Wallet / Minter | `0x0077…19B9` / `0x0022…2475B` | Instant-path sub-500ms unified-balance settlement |
| **StableFX** FxEscrow (+ Permit2 `0x0000…78BA3`) | `0x8676…a9f8` | Enterprise RFQ USDC↔EURC FX |
| **PQ Signature Verify** precompile | `0x1800…0004` | Underpins Arc's quantum-resilient wallet signatures (§5) |

On-chain, Arcane Treasury adds two purpose-built contracts:

- **`ArcaneTreasuryVault.sol`** — multi-tenant vault (`Ownable2Step` +
  `ReentrancyGuard`): segregated `tenantBalances`, idempotent `executeIntent`
  (compliance-gated solver reimbursement + protocol/network fee split), and
  `sweepToYield`/`unwindYield` into USYC.
- **`ArcaneComplianceGuard.sol`** — programmable circuit breaker enforcing a
  rolling 24h per-tenant velocity cap (`VelocityLimitExceeded`) and a
  chain-agnostic recipient allowlist (`RecipientNotWhitelisted`), enforced
  atomically inside `executeIntent` and queryable off-chain via `eth_call`.

**28 Foundry tests** cover the full lifecycle: deposits, multi-tenant isolation,
fee distribution, idempotency, every compliance revert, and the USYC
sweep/unwind yield cycle.

## 5. Security Posture — Built for a Fortune 500 CISO

Arcane Treasury is designed to pass an enterprise security audit on day one:

- **Post-quantum resilience (inherited from Arc L1).** Arc wallet signatures use
  **SLH-DSA-SHA2-128s** (NIST FIPS 205, verified by the `0x1800…0004`
  precompile), and Arc's opt-in confidential execution (ArcaneVM) uses **X-Wing
  hybrid KEM (X25519 + ML-KEM-768)** with AES-256-GCM. This makes the treasury
  engine defensible against **"Harvest Now, Decrypt Later"** quantum threats —
  a claim we can make *correctly*, citing the exact NIST schemes Arc ships.
- **Institutional clearing via Circle Gateway & CCTP.** Large-value settlement
  rides Circle's canonical, attested transfer protocol — no third-party bridge
  risk.
- **Defense-in-depth controls.** Velocity caps and recipient allowlists are
  enforced *on-chain* (atomic, in `executeIntent`) and re-checked off-chain,
  with `Ownable2Step` admin and `ReentrancyGuard` throughout.

## 6. Developer Experience Feedback for Circle

Building this on Arc surfaced concrete, actionable DX findings:

1. **The 6/18 decimal duality is the #1 footgun.** USDC's native (18dp) vs
   ERC-20 (6dp) interfaces share one balance. We centralized every conversion in
   a single audited module (`@arcane/shared/decimals`) with explicit `to6`/`to18`
   helpers that surface dropped sub-1e-6 dust. **Recommendation:** ship a Circle
   reference "decimal-safety" helper for Solidity + TS and lead the docs with it.
2. **`PREVRANDAO` always returns 0 on Arc.** Any naive on-chain randomness
   (e.g. relay/solver selection) silently degenerates. We use deterministic
   round-robin instead. **Recommendation:** a prominent warning + a recommended
   VRF/round-robin pattern in the "deploy on Arc" guide.
3. **USYC allowlisting is a 24–48h human-in-the-loop gate** ($100k min, non-US
   institutions). It blocks a clean end-to-end yield demo. We ship a faithful
   `MockUSYCTeller` so the lifecycle is fully testable today. **Recommendation:**
   a permissionless testnet USYC sandbox Teller for developers.
4. **App Kit ↔ Claude Agent Stack.** The Arc MCP server and Circle Skills are
   excellent. The natural next step — and the thrust of §7 — is **first-class MCP
   tools for treasury/agent-wallet operations**, so an AI agent can transact
   within scoped, velocity-limited policies out of the box. Arcane Treasury ships
   exactly such an MCP server; we'd love to upstream the patterns.

## 7. Expansion: The Autonomous Treasury API for AI Agents

Arc is positioning itself as the settlement layer for the agentic economy
(ERC-8004 identity, ERC-8183 job settlement, x402, agent wallets). Arcane
Treasury rides that wave: the same engine that serves human finance teams also
exposes an **MCP server** so an enterprise can hand an AI agent — a programmatic
ad-buyer, an automated supply-chain manager — a **scoped, velocity-limited
wallet** (per-transaction / daily / weekly / monthly USDC caps).

The agent autonomously authorizes and streams cross-chain payouts based on
performance metrics, while every dollar lands in the CFO's single-currency audit
log and every cap is enforced both off-chain and on-chain. MCP tools shipped:
`submit_bulk_payout`, `get_treasury_balance`, `simulate_route`, `get_audit_log`,
`set_agent_policy`.

This turns a standard B2B treasury dashboard into **autonomous financial
infrastructure for the agentic economy** — a large market expansion that is only
possible because Arc makes USDC the native, gas-free unit of account.

## 8. What We're Requesting & Deliverables

A grant to harden Arcane Treasury from this working testnet implementation toward
a production pilot with a design-partner marketplace:

- Real solver-mesh integration with ≥2 institutional market makers.
- Mainnet readiness (pending Arc mainnet) + USYC allowlisting for live yield.
- A third-party security audit of the vault + compliance contracts.
- Open-sourcing the Arc treasury MCP toolkit for the agentic-economy ecosystem.

### Live deployment artifacts

The full deposit → `executeIntent` → yield lifecycle is proven by 28 passing
Foundry tests. A one-command live proof on Arc Testnet
(`script/DeployAndDemo.s.sol`) deploys the stack against real native USDC and
performs an on-chain deposit + `executeIntent` round-trip.

**✅ Deployed and verified live on Arc Testnet** (chain `5042002`). A real
deposit + `executeIntent` round-trip settled on-chain: 0.20 USDC deposited,
`executeIntent` debited gross 0.10 + network 0.01 + convenience 0.005, leaving a
0.085 tenant balance and 0.01 in the network-fee pool — matching the unit tests
exactly, on real chain.

| Artifact | Value |
|---|---|
| Network | Arc Testnet (`5042002`) |
| Deployer / owner / relayer | [`0x8984EF18c6d128C47463405fdd01f833f4D7154c`](https://testnet.arcscan.app/address/0x8984EF18c6d128C47463405fdd01f833f4D7154c) |
| **ArcaneComplianceGuard** | [`0xf9E0117e2506182690e009B9dB78456DE270368f`](https://testnet.arcscan.app/address/0xf9E0117e2506182690e009B9dB78456DE270368f) |
| **ArcaneTreasuryVault** | [`0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5`](https://testnet.arcscan.app/address/0x72dC5bFeb7f12c36ACac9A8FE7986dB656e7fAF5) |
| MockUSYCTeller | [`0x4f55a678e7519D0BCd3366bDED5a10234be161DD`](https://testnet.arcscan.app/address/0x4f55a678e7519D0BCd3366bDED5a10234be161DD) |
| Live `depositUSDC` tx | [`0x0f19af127b60610880dc6cd6c3c49679920f2f403ea3fd0b4a04b7f42ee86c9c`](https://testnet.arcscan.app/tx/0x0f19af127b60610880dc6cd6c3c49679920f2f403ea3fd0b4a04b7f42ee86c9c) |
| Live `executeIntent` tx (script) | [`0x12c8b4fa8d6fe11ba63ee60b9af6347454f02db2fb4bac352a9f88f5960c6954`](https://testnet.arcscan.app/tx/0x12c8b4fa8d6fe11ba63ee60b9af6347454f02db2fb4bac352a9f88f5960c6954) |
| **Live `executeIntent` tx (driven by the REST API)** | [`0x85609be3de9435e026bdb671488151d33129064a7d924ada2cac638cd76af7dc`](https://testnet.arcscan.app/tx/0x85609be3de9435e026bdb671488151d33129064a7d924ada2cac638cd76af7dc) |

**End-to-end live proof (Arc L1 settlement):** a `POST /api/v1/payouts/bulk`
request to the running backend (live on-chain mode) settled a real
`executeIntent` on Arc L1 — the tenant's on-chain vault balance debited and the
intent was recorded on-chain, all driven by the production API, not a script.

**End-to-end live proof (REAL cross-chain delivery, Arc → Base):** the whale
path performs a real CCTP V2 burn on Arc → mint on Base Sepolia via Circle's
Forwarding Service. A `POST /api/v1/payouts/bulk` for a Base recipient produced:

| Leg | Tx |
|---|---|
| CCTP burn on **Arc** | [`0x2a7c97cbc6772d3f2a89235f78547857eb3e9d38f7399f201371e87da7516011`](https://testnet.arcscan.app/tx/0x2a7c97cbc6772d3f2a89235f78547857eb3e9d38f7399f201371e87da7516011) |
| Native USDC mint on **Base Sepolia** (forwarder) | [`0x1105e368ceb4ef5390bbfe2aeaae6db6d00b1612bdba14b077283833a9531b7c`](https://sepolia.basescan.org/tx/0x1105e368ceb4ef5390bbfe2aeaae6db6d00b1612bdba14b077283833a9531b7c) |

No pre-funded USDC liquidity on Base, no Base gas, and no kit key were required —
Circle's CCTP burn-and-mint provides native USDC on the destination.

_Reproduce with `bash scripts/deploy-live.sh` (deploy) then run the backend with
`apps/server/.env` configured for live mode (see `README.md`)._

---

*Arcane Treasury — fund once in USDC, pay the world. Built natively on Arc.*
