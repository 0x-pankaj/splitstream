/**
 * Standalone helper: print the platform's Gateway unified USDC balance across
 * testnet chains (and the per-chain breakdown), so you can confirm the float
 * before/after a deposit or spend.
 *
 * Run:  RELAYER_PRIVATE_KEY=0x... bun run apps/server/scripts/gateway-balance.ts
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";

const pk = process.env.RELAYER_PRIVATE_KEY;
if (!pk) throw new Error("RELAYER_PRIVATE_KEY required");

const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: pk });

const balances = await kit.unifiedBalance.getBalances({
  sources: { adapter },
  networkType: "testnet",
});

console.log("UNIFIED BALANCE", inspect(balances, false, null, true));
