# @arcane/sdk

Official TypeScript SDK for **Arcane Treasury** — Stripe for cross-chain payouts, built natively on Circle's Arc L1. Fund a corporate vault once in USDC and pay out to creators and suppliers across Base, Arbitrum, Ethereum, and Solana — no native gas tokens, real CCTP settlement.

Zero runtime dependencies. Works in Node ≥ 18, Bun, Deno, edge runtimes, and the browser (uses the platform `fetch`).

## Install

```bash
npm install @arcane/sdk
```

## Quick start

```ts
import { ArcaneClient } from "@arcane/sdk";

// 1. Open a treasury account (returns a one-time API key).
const account = await ArcaneClient.signup({
  baseUrl: "https://api.arcanetreasury.xyz",
  name: "Globex Payments Inc.",
  onchainAddress: "0xYourArcWallet…", // funds the vault
});
console.log("Save this key:", account.apiKey);

// 2. Construct a client with the key.
const arcane = new ArcaneClient({
  apiKey: account.apiKey!,
  baseUrl: "https://api.arcanetreasury.xyz",
});

// 3. Fund the vault from your wallet, then check the balance.
const info = await arcane.treasury.depositInfo();
console.log(`Deposit USDC to ${info.vaultAddress}; balance: $${info.balance}`);

// 4. Vet the payees you'll pay (required — on-chain allowlist).
await arcane.recipients.add({ address: "0x1111…", targetChain: "base", label: "Creator #1" });

// 5. Pay out — one array, many chains.
const batch = await arcane.payouts.create({
  idempotencyKey: "payroll-2026-06",
  payouts: [
    { recipientAddress: "0x1111…", targetChain: "base", amountUSDC: "250" },
    { recipientAddress: "0x2222…", targetChain: "arbitrum", amountUSDC: "1200" },
    { recipientAddress: "9xQe…", targetChain: "solana", amountUSDC: "100", currencyCode: "EUR" },
  ],
});

for (const r of batch.results) {
  console.log(`${r.recipientAddress} → ${r.path} · ${r.destinationTxHash}`);
}
```

## Error handling

Every non-2xx response throws an `ArcaneApiError` carrying the API's stable `code`:

```ts
import { ArcaneApiError } from "@arcane/sdk";

try {
  await arcane.payouts.create({ payouts: [...] });
} catch (err) {
  if (err instanceof ArcaneApiError) {
    // e.g. RECIPIENT_NOT_WHITELISTED, INSUFFICIENT_VAULT_BALANCE, VELOCITY_LIMIT_EXCEEDED
    console.error(err.code, err.status, err.details);
  }
}
```

## API

| Method | Description |
| --- | --- |
| `ArcaneClient.signup(opts)` | Create a tenant; returns a one-time API key. |
| `client.me()` | The tenant this key belongs to. |
| `client.treasury.depositInfo()` | Vault address, your wallet, live balance, funding steps. |
| `client.recipients.list()` | List vetted payees. |
| `client.recipients.add(input)` | Vet + allowlist a payee (on-chain in live mode). |
| `client.recipients.remove(recipientKey)` | Revoke a payee. |
| `client.payouts.create(opts)` | Submit a bulk cross-chain payout. |

`payouts.create` resolves your tenant id automatically via `me()` and caches it. Pass an `idempotencyKey` so a retried batch is never paid twice.

## Routing

Payouts below the configured threshold (default $5,000) take the instant Gateway path; at/above it they settle via native **Circle CCTP** for cryptographic finality. The `path` field on each result (`instant` | `whale`) and `settlementMode` (`live` | `simulated`) tell you which rail ran.
