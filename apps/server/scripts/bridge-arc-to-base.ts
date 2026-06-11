/**
 * Standalone proof: a REAL CCTP burn on Arc Testnet → mint on Base Sepolia via
 * Circle App Kit's Bridge + Forwarding Service.
 *
 * - No kit key needed (bridge is free).
 * - No Base gas / destination wallet needed: useForwarder=true makes Circle's
 *   Forwarding Service submit the mint on Base. USDC is burned on Arc (real,
 *   signed by our relayer) and minted native on Base to the recipient.
 *
 * Run:  RELAYER_PRIVATE_KEY=0x... bun run apps/server/scripts/bridge-arc-to-base.ts [amount] [recipient]
 */

import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";

const amount = process.argv[2] ?? "0.50";
const recipient = process.argv[3] ?? "0x8984EF18c6d128C47463405fdd01f833f4D7154c";

const pk = process.env.RELAYER_PRIVATE_KEY;
if (!pk) throw new Error("RELAYER_PRIVATE_KEY required");

const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: pk });

console.log(`Bridging ${amount} USDC: Arc Testnet → Base Sepolia (forwarder) → ${recipient}`);

const result = await kit.bridge({
  from: { adapter, chain: "Arc_Testnet" },
  to: { recipientAddress: recipient, chain: "Base_Sepolia", useForwarder: true },
  amount,
});

console.log("RESULT", inspect(result, false, null, true));
