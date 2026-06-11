# Engineering Specification: Arcane Treasury (Arc L1 B2B SaaS)

You are a Principal Software Engineer specializing in institutional payment engines, cryptographic finality, and Circle's stablecoin-native financial infrastructure. You are tasked with implementing the full, production-ready codebase for **Arcane Treasury**—a B2B SaaS corporate treasury and programmatic hybrid payout layer built natively on Circle's Arc L1 blockchain.

## 1. System Guardrails & Execution Constraints
- **Absolute Completeness:** Write full, production-grade, human-scannable implementations. Do not use truncated blocks, placeholders (`...`), short-circuit returns, or `// TODO` comments.
- **Strict Isolated Footprint:** Maintain a rigid boundary between the on-chain smart contract environment (`/contracts`) and the off-chain TypeScript runtime engine (`/server`).
- **The Arc Precision Duality:** Inside the EVM layer of Arc L1, native gas accounting uses **18 decimals** of precision. However, standard interaction with the Native USDC system contract (`0x3600000000000000000000000000000000000000`) and target ecosystem bridge endpoints uses **6 decimals**. Never conflate these precisions during transfers or state mutations.
- **Architectural Routing Mandate:** All transactions under a configurable threshold (e.g., $5,000) must route through the off-chain **Intent-Based Solver Mesh** for instantaneous sub-500ms clearing. Any transaction above this limit must bypass the mesh and settle natively via asynchronous **Circle CCTP / Bridge Kit** to ensure absolute cryptographic settlement safety for large capital blocks.

---

## 2. On-Chain Smart Contract Architecture (`/contracts`)

Initialize an enterprise-grade Foundry suite. Target Solidity compiler version `^0.8.24` utilizing advanced EVM optimization flags compatible with the Circle Arc Testnet (Chain ID: `5042002`).

### 2.1 `ArcaneTreasuryVault.sol`
A robust, multi-tenant corporate vault contract. Because this runs natively on Arc L1, all transaction gas overhead is settled automatically in USDC.
- **State Framework & Security:**
  - Inherit OpenZeppelin's `Ownable2Step` and `ReentrancyGuard`.
  - Maintain a ledger tracking segregated enterprise balances: `mapping(address => uint256) public tenantBalances;` (6 decimals).
  - Maintain an explicit registry of institutional market-makers: `mapping(address => bool) public whitelistedSolvers;`
- **Core Methods:**
  - `depositUSDC(uint256 amount)`: Pulls application-grade USDC from the tenant using `transferFrom` into the vault. Updates `tenantBalances`.
  - `executeIntent(bytes32 intentId, address tenant, address destinationSolver, uint256 grossAmount, uint256 networkFee, uint256 convenienceFee)`: Called strictly by the platform's trusted relayer key. Deducts the complete aggregate sum (`grossAmount + networkFee + convenienceFee`) from the tenant’s balance.
    - Credits `grossAmount` directly to the `destinationSolver`'s balance within the system contract or releases an instant internal push transfer.
    - Credits `convenienceFee` directly to the SaaS protocol platform fee wallet.
    - Locks `networkFee` inside the contract pool to fund ongoing autonomous relayer operations.
  - `sweepToYield(uint256 amount)`: Interfaces directly with the native Circle tokenized treasury yield fund (**USYC**) Teller on Arc L1. Programmatically deposits idle vault USDC to capture low-risk compliance-cleared yield.
  - `unwindYield(uint256 amount)`: Triggers immediate redemption of USYC shares back into liquid application USDC to satisfy immediate bulk payout queues.

### 2.2 `ArcaneComplianceGuard.sol`
A defensive, programmable risk-management circuit breaker contract.
- Tracks sliding rolling 24-hour transaction volumes per corporate tenant.
- Enforces an immutable `dailyVolumeLimit` set by enterprise compliance profiles. If a batch execution causes a tenant to breach this threshold, the contract must revert using a custom error: `error VelocityLimitExceeded()`.
- Implements an explicit `whitelistedRecipients` address registry per tenant to block non-vetted or sanctioned target addresses at the smart contract level.

---

## 3. Backend Engine & Circle API Integration Layer (`/server`)

Implement a highly structured, enterprise-grade TypeScript server using Hone trpc bun/pnpm whatever you thought is perfect 

### 3.1 REST API Pipeline (`src/routes/payouts.ts`)
- Expose a public enterprise gateway endpoint: `POST /api/v1/payouts/bulk`.
- Secure access using scoped, role-based API keys (`x-api-key`) verified against a secure database cache.
- Enforce rigid validation on incoming payroll packets using **Zod**:
```typescript
  const PayoutSchema = z.object({
    tenantId: z.string().uuid(),
    payouts: z.array(z.object({
      recipientAddress: z.string(),
      targetChain: z.enum(['solana', 'base', 'arbitrum', 'ethereum']),
      amountUSDC: z.string(),
      currencyCode: z.enum(['USD', 'EUR']).default('USD')
    }))
  });
Execution Workflow Engine:

Parse the incoming payload and perform an asynchronous eth_call to ArcaneComplianceGuard to verify velocity limits and recipient whitelisting.

For payouts targeting European recipients requiring local currencies (currencyCode: 'EUR'), programmatically dispatch an RFQ call to the Arc L1 StableFX API module to lock in the USDC -> EURC currency conversion spread on-chain before transaction serialization.

3.2 The Hybrid Payout & Solver Orchestrator (src/services/solverMesh.ts)
Maintain active WebSocket state pools connecting the backend to vetted, institutional market makers ("Solvers").

For items routed to the instant path: Broadcast the payment intents to the Solver mesh.

The designated Solver instantly fulfills the target payout using their localized hot-wallet pools directly on the destination chain (e.g., transmitting native Solana USDC to the creator).

The Solver signs and submits the target-chain execution receipt hash back to your API backend.

The service validates the transaction state against an independent RPC node on that target chain. Upon successful cryptographic confirmation, it submits a signed payload to Arc L1 executing executeIntent() on ArcaneTreasuryVault.sol, reimbursing the Solver's pool natively on the L1.

Asynchronously dispatch a background Circle CCTP / Bridge Kit execution loop to slowly rebalance, burn, and replenish the Solvers' global remote chain hot-wallet reserves over time.

4. Testing Protocols & Circle Grant Documentation
Foundry Testing (/test): Write explicit Forge unit tests mapping out complete vault life cycles: deposit flows, multi-tenant accounting isolation, mocking a USYC Teller contract behavior, and forcing compliance failures when velocity caps are simulated to breach.

Backend Testing (/server/__tests__): Implement comprehensive integration tests using Vitest to mock the Circle Developer API endpoints (StableFX quote structures, CCTP attestation relays, and Gateway webhook ingestion).

Ecosystem Grant Submission (/GRANT_PROPOSAL.md): Generate a publication-ready markdown file engineered for the Circle Arc Grant Review Board detailing:

The Enterprise Friction: How fragmented gas tracking and multichain accounting keep Web2 corporate CFOs off-chain.

The Arc Integration Matrix: Technical breakdown of how Arcane Treasury maps directly onto Arc L1 Native USDC Gas, Circle Gateway, CCTP, StableFX, and USYC.

Developer Experience Feedback: A detailed analysis of integrating the Arc L1 double-decimal structure alongside actionable recommendations for improving Circle's Anthropic Claude Agent Stack integrations.


Feel free to use MonoRepo turborepo if here possible as it more managed so i thought of. 


```
Final project we want 

Multi-Chain "Invisible Treasury" for Global Platforms (B2B SaaS)

The Concept: A plug-and-play corporate treasury and payout management engine for global Web2 companies (like marketplaces, gig-economy platforms, or SaaS providers) that abstracts away all blockchain mechanics.

How it leverages Arc: Large enterprises struggle to adopt crypto because of gas token volatility and cross-chain fragmentation. By utilizing Arc, your SaaS platform allows companies to open corporate treasury accounts where all fees are strictly paid in USDC.

The Product: Your startup provides an API that hooks into a platform's backend. When a platform needs to pay out 10,000 global creators or suppliers across Ethereum, Base, Solana, and Arbitrum, they fund your smart contract on Arc once. Your platform uses Arc Gateway / CCTP to split, clear, and instantly teleport those funds across multiple target chains in under 500 milliseconds.

Why it wins: It completely solves the CFO's accounting nightmare (no holding native gas assets like ETH or SOL) and offers programmatic, sub-second automated payouts
```
