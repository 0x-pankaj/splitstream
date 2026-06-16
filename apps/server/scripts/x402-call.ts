/**
 * x402 agent demo — performs the real challenge-response handshake against a
 * SplitStream paid-API piece, exactly as an x402-native AI agent would:
 *
 *   1. POST the resource with no payment   → receive 402 + PaymentRequirements
 *   2. "Pay" the USDC amount on Arc         → build the X-PAYMENT proof
 *   3. Retry with the X-PAYMENT header      → receive 200 + the upstream result
 *
 * Run (server must be up on :8787):
 *   bun run apps/server/scripts/x402-call.ts [pieceId]
 *
 * In mirror mode the "payment" is the issued single-use nonce echoed back (real
 * anti-replay). In live mode this is where the agent would settle USDC on Arc
 * and put the settlement reference in `authorization`.
 */

const BASE = process.env.SS_BASE ?? "http://localhost:8787";
const pieceId = process.argv[2] ?? "piece-fx-api-001";
const url = `${BASE}/api/v1/pieces/${pieceId}/call`;

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}
function fromB64(s: string): unknown {
  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}

console.log(`\nx402 agent → ${url}\n`);

// 1) No payment → expect 402 with requirements.
const challengeRes = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ payer: "0xAgentWalletDeadBeef" }),
});
console.log(`1. POST (no payment)        → ${challengeRes.status} ${challengeRes.status === 402 ? "Payment Required ✓" : "UNEXPECTED"}`);
const challenge = (await challengeRes.json()) as {
  x402Version: number;
  accepts: Array<{ network: string; maxAmountRequired: string; payTo: string; asset: string; nonce: string; extra: { humanAmount: string } }>;
};
const req = challenge.accepts[0]!;
console.log(`   requirements: pay ${req.extra.humanAmount} (${req.maxAmountRequired} atomic USDC) on ${req.network}`);
console.log(`   payTo: ${req.payTo}`);
console.log(`   asset: ${req.asset}`);
console.log(`   nonce: ${req.nonce}`);

// 2) Build the X-PAYMENT proof (in live mode: settle USDC on Arc first).
const xPayment = b64({
  x402Version: challenge.x402Version,
  scheme: "exact",
  network: req.network,
  payload: {
    nonce: req.nonce,
    from: "0xAgentWalletDeadBeef",
    authorization: "0xsettlement_reference_or_eip3009_signature",
  },
});
console.log(`\n2. (paid ${req.extra.humanAmount} USDC on Arc) → built X-PAYMENT proof`);

// 3) Retry with the proof → expect 200 + upstream result.
const paidRes = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payment": xPayment },
  body: JSON.stringify({ payer: "0xAgentWalletDeadBeef" }),
});
console.log(`\n3. POST + X-PAYMENT          → ${paidRes.status} ${paidRes.ok ? "OK ✓" : "FAILED"}`);
const settleHeader = paidRes.headers.get("x-payment-response");
if (settleHeader) console.log(`   X-PAYMENT-RESPONSE: ${JSON.stringify(fromB64(settleHeader))}`);
const result = (await paidRes.json()) as {
  paid?: boolean;
  unlock?: { chains: string[]; contributors: Array<{ role: string; targetChain: string; share6: string }> };
  upstream?: { ok: boolean; status: number; body: unknown };
};
if (result.unlock) {
  console.log(`   split paid to: ${result.unlock.contributors.map((x) => `${x.role}/${x.targetChain}`).join(", ")}`);
}
if (result.upstream) {
  console.log(`   upstream ${result.upstream.status}: ${JSON.stringify(result.upstream.body).slice(0, 160)}`);
}

// 4) Replay protection — reuse the same proof → must be rejected.
const replayRes = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payment": xPayment },
  body: JSON.stringify({ payer: "0xAgentWalletDeadBeef" }),
});
console.log(`\n4. replay same X-PAYMENT      → ${replayRes.status} ${replayRes.status === 402 ? "rejected (nonce already used) ✓" : "NOT BLOCKED ✗"}\n`);

process.exit(0);
