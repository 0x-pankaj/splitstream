/**
 * Standalone proof (step 1 of 2): fund the platform's Gateway unified-balance
 * float on Arc Testnet.
 *
 * Gateway is pre-funded: you deposit USDC into your Gateway balance on Arc ONCE,
 * and afterwards every instant payout spends from it in <500ms (see
 * gateway-spend-arc-to-base.ts). This script does that one-time deposit.
 *
 * - No kit key needed (unified balance is free).
 * - USDC is the gas token on Arc, so the relayer only needs Arc Testnet USDC.
 * - Withdrawing the float back out later is a 7-day delayed withdrawal, so only
 *   deposit a modest working float.
 *
 * Run:  RELAYER_PRIVATE_KEY=0x... bun run apps/server/scripts/gateway-deposit.ts [amount]
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";

const amount = process.argv[2] ?? "1.00";

const pk = process.env.RELAYER_PRIVATE_KEY;
if (!pk) throw new Error("RELAYER_PRIVATE_KEY required");

const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: pk });

console.log(`Depositing ${amount} USDC into the Gateway unified balance on Arc Testnet…`);

const result = await kit.unifiedBalance.deposit({
  from: { adapter, chain: "Arc_Testnet" },
  amount,
});

console.log("RESULT", inspect(result, false, null, true));
console.log(
  "\nNext: prove an instant spend with\n  bun run apps/server/scripts/gateway-spend-arc-to-base.ts <amount> <recipient>",
);
