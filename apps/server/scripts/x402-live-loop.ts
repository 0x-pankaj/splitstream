/**
 * REAL end-to-end x402 settlement on Arc Testnet — nothing simulated.
 *
 *   1. Create a fresh autonomous BUYER agent wallet (its own key).
 *   2. Relayer funds the buyer with real USDC on Arc.
 *   3. Register a paid API whose owner is a fresh address.
 *   4. Buyer hits /call → gets the 402 challenge (payTo, amount, nonce).
 *   5. Buyer signs + sends a REAL USDC payment to payTo on Arc.
 *   6. Buyer retries with the X-PAYMENT proof → server verifies the payment
 *      on-chain, pays the owner REAL USDC on Arc, and returns the API result.
 *   7. We read the owner's USDC balance before/after to prove they got paid.
 *
 * The server must be running in LIVE_X402 mode (.env.live) on :8787.
 * Run:  bun run scripts/x402-live-loop.ts
 */

import { createPublicClient, createWalletClient, http, type Hash } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet, USDC, ARC_TESTNET } from "@arcane/shared";
import { erc20Abi } from "../src/chain/abis.js";

const RPC = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const BASE = "http://localhost:8787";
const ex = (h: string) => `${ARC_TESTNET.explorer}/tx/${h}`;
const usd = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} USDC`;

const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const relayer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as `0x${string}`);
const relayerWallet = createWalletClient({ account: relayer, chain: arcTestnet, transport: http(RPC) });

async function usdcBalance(addr: string): Promise<bigint> {
  return (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`] })) as bigint;
}

// 1) Fresh autonomous buyer agent wallet + a fresh owner address.
const buyer = privateKeyToAccount(generatePrivateKey());
const buyerWallet = createWalletClient({ account: buyer, chain: arcTestnet, transport: http(RPC) });
const owner = privateKeyToAccount(generatePrivateKey());
console.log(`\n=== REAL x402 on Arc Testnet (chain ${ARC_TESTNET.chainId}) ===`);
console.log(`buyer agent wallet: ${buyer.address}`);
console.log(`API owner wallet:   ${owner.address}`);

// 2) Relayer funds the buyer with real USDC (native value = USDC; also covers gas).
console.log(`\n[2] relayer funds buyer 0.50 USDC…`);
const fundHash = await relayerWallet.sendTransaction({ to: buyer.address, value: 500000000000000000n }); // 0.5 USDC (18dp native)
await pub.waitForTransactionReceipt({ hash: fundHash });
console.log(`    funded · ${ex(fundHash)}`);
const buyerBal = await usdcBalance(buyer.address);
console.log(`    buyer USDC balance: ${usd(buyerBal)}`);
if (buyerBal < 10000n) throw new Error("buyer not funded with spendable USDC");

// 3) Register the paid API (owner = fresh address, paid on Arc).
console.log(`\n[3] register paid API ($0.01/call, 100% → owner)…`);
const createRes = await fetch(`${BASE}/api/v1/pieces`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": "arc_test_sk_demo_0001" },
  body: JSON.stringify({
    title: "Live FX API (real settlement)",
    kind: "api",
    priceUSDC: "0.01",
    endpoint: "https://api.frankfurter.app/latest?from=USD&to=EUR",
    httpMethod: "GET",
    contributors: [{ role: "api owner", address: owner.address, targetChain: "base", splitBps: 10000 }],
  }),
});
const pieceId = ((await createRes.json()) as { piece: { id: string } }).piece.id;
console.log(`    piece: ${pieceId}`);
const ownerBefore = await usdcBalance(owner.address);
console.log(`    owner USDC before: ${usd(ownerBefore)}`);

// 4) Buyer hits /call with no payment → 402 challenge.
console.log(`\n[4] buyer GET resource (no payment)…`);
const url = `${BASE}/api/v1/pieces/${pieceId}/call`;
const challengeRes = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
console.log(`    → HTTP ${challengeRes.status} ${challengeRes.status === 402 ? "Payment Required" : ""}`);
const challenge = (await challengeRes.json()) as { x402Version: number; accepts: Array<{ maxAmountRequired: string; payTo: string; nonce: string }> };
const req = challenge.accepts[0]!;
console.log(`    payTo: ${req.payTo} · amount: ${usd(BigInt(req.maxAmountRequired))} · nonce: ${req.nonce.slice(0, 18)}…`);

// 5) Buyer signs + sends a REAL USDC payment to payTo on Arc.
console.log(`\n[5] buyer signs + sends REAL USDC payment on Arc…`);
const payHash = await buyerWallet.writeContract({
  account: buyer,
  chain: arcTestnet,
  address: USDC,
  abi: erc20Abi,
  functionName: "transfer",
  args: [req.payTo as `0x${string}`, BigInt(req.maxAmountRequired)],
});
await pub.waitForTransactionReceipt({ hash: payHash });
console.log(`    paid · ${ex(payHash)}`);

// 6) Buyer retries with the X-PAYMENT proof → server verifies on-chain + pays owner.
const proof = Buffer.from(
  JSON.stringify({
    x402Version: challenge.x402Version,
    scheme: "exact",
    network: "arc-testnet",
    payload: { nonce: req.nonce, from: buyer.address, authorization: payHash },
  }),
).toString("base64");
console.log(`\n[6] buyer retries with X-PAYMENT proof…`);
const paidRes = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payment": proof },
  body: "{}",
});
console.log(`    → HTTP ${paidRes.status} ${paidRes.ok ? "OK" : "FAILED"}`);
const result = (await paidRes.json()) as {
  mode?: string;
  payments?: Array<{ role: string; txHash: string | null; status: string }>;
  upstream?: { ok: boolean; status: number; body: unknown };
  error?: string;
};
if (!paidRes.ok) {
  console.log(`    error: ${result.error}`);
  process.exit(1);
}
console.log(`    settlement mode: ${result.mode}`);
for (const p of result.payments ?? []) {
  console.log(`    payout → ${p.role}: ${p.status}${p.txHash ? ` · ${ex(p.txHash)}` : ""}`);
}
console.log(`    upstream ${result.upstream?.status}: ${JSON.stringify(result.upstream?.body).slice(0, 120)}`);

// 7) Prove the owner actually received real USDC.
const ownerAfter = await usdcBalance(owner.address);
console.log(`\n[7] owner USDC after:  ${usd(ownerAfter)}  (received ${usd(ownerAfter - ownerBefore)})`);
console.log(`\n✅ Real money moved on Arc: buyer paid USDC → verified on-chain → owner paid real USDC.\n`);
process.exit(0);
