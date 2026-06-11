/**
 * Standalone proof (step 2 of 2): a REAL sub-500ms Circle Gateway settlement —
 * spend from the platform's Arc unified balance, minting native USDC to the
 * recipient on Base Sepolia via the Forwarding Service.
 *
 * - No kit key needed (unified balance is free).
 * - No Base gas / destination wallet needed: useForwarder=true makes Circle's
 *   Forwarding Service submit the mint on Base.
 * - Requires a funded Gateway float on Arc first — run gateway-deposit.ts once.
 *
 * This is the live equivalent of the engine's instant rail
 * (apps/server/src/services/gatewayUnifiedBalance.ts).
 *
 * Run:  RELAYER_PRIVATE_KEY=0x... bun run apps/server/scripts/gateway-spend-arc-to-base.ts [amount] [recipient]
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";

const amount = process.argv[2] ?? "0.25";
const recipient = process.argv[3] ?? "0x8984EF18c6d128C47463405fdd01f833f4D7154c";

const pk = process.env.RELAYER_PRIVATE_KEY;
if (!pk) throw new Error("RELAYER_PRIVATE_KEY required");

const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: pk });

console.log(`Gateway spend ${amount} USDC: Arc unified balance → Base Sepolia (forwarder) → ${recipient}`);

const started = Date.now();
const result = await kit.unifiedBalance.spend({
  from: { adapter, allocations: { amount, chain: "Arc_Testnet" } },
  to: { chain: "Base_Sepolia", recipientAddress: recipient, useForwarder: true },
  amount,
});

console.log(`Settled in ${Date.now() - started}ms`);
console.log("RESULT", inspect(result, false, null, true));
