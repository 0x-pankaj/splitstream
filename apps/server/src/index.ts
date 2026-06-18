/**
 * Arcane Treasury backend entrypoint (Bun + Hono).
 *
 * Mounts:
 *   - REST gateway   POST /api/v1/payouts/bulk
 *   - tRPC           /trpc/*           (consumed by the CFO dashboard)
 *   - health         GET  /health
 *
 * Seeds the demo world on boot and snapshots to bun:sqlite for durability.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createMcpServer } from "./mcp/server.js";
import { config } from "./config.js";
import { store } from "./db/store.js";
import { seedDemo, DEMO_API_KEY } from "./db/seed.js";
import { initPersistence } from "./db/persistence.js";
import { payoutRoutes } from "./routes/payouts.js";
import { tenantRoutes } from "./routes/tenants.js";
import { pieceRoutes } from "./routes/pieces.js";
import { appRouter } from "./trpc/router.js";
import { makeContextFactory } from "./trpc/context.js";
import { relayerAccount } from "./chain/arc.js";

// In live on-chain mode, bind the demo tenant + solvers to the funded,
// vault-whitelisted relayer address so server payouts settle on Arc L1.
seedDemo(
  store,
  config.onchainEnabled && relayerAccount
    ? { onchainTenantAddress: relayerAccount.address, solverArcAddress: relayerAccount.address }
    : {},
);
const persist = await initPersistence(store, config.databasePath);

const makeContext = makeContextFactory(store);

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "arcane-treasury",
    onchainEnabled: config.onchainEnabled,
    chainId: 5042002,
    rpc: config.rpcHttp,
  }),
);

// REST enterprise gateway.
app.route("/api/v1/payouts", payoutRoutes(store));
// SplitStream: per-piece creator monetization (create / browse / unlock).
app.route("/api/v1/pieces", pieceRoutes(store));
// Onboarding, payee management, and funding.
app.route("/api/v1", tenantRoutes(store));

// tRPC for the dashboard; api key flows through the x-api-key header.
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: ((_opts: unknown, c: { req: { header: (k: string) => string | undefined } }) =>
      makeContext(c.req.header("x-api-key"))) as never,
  }),
);

// Remote MCP over Streamable HTTP — ANY MCP client (Claude Code, Cursor, …) adds
// it by URL, no local clone or Bun needed:
//   claude mcp add --transport http splitstream https://<host>/mcp
// Stateless: a fresh MCP server + transport per request, bound to the LIVE store,
// so remote agents discover and pay the real catalog (list_pieces / call_api / …).
app.all("/mcp", async (c) => {
  const mcp = createMcpServer(store);
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return (await transport.handleRequest(c)) ?? c.body(null, 204);
});

// Persist on a light interval and on shutdown.
const interval = setInterval(persist, 5_000);
async function shutdown() {
  clearInterval(interval);
  await persist(); // flush the final snapshot (awaits the async D1 backend)
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Arcane Treasury listening on :${config.port}`);
console.log(`  on-chain mode: ${config.onchainEnabled ? "LIVE (Arc Testnet)" : "mirror (simulated)"}`);
console.log(`  demo api key:  ${DEMO_API_KEY}`);

export default {
  port: config.port,
  fetch: app.fetch,
};

export { app };
