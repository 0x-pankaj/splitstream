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
import { rateLimit } from "./middleware/rateLimit.js";
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
import { liveAgentReady, liveRelayerStatus } from "./services/liveAgent.js";
import { ensureWalletPool, circleWalletsReady } from "./services/circleWallets.js";

// In live on-chain mode, bind the demo tenant + solvers to the funded,
// vault-whitelisted relayer address so server payouts settle on Arc L1.
seedDemo(
  store,
  config.onchainEnabled && relayerAccount
    ? { onchainTenantAddress: relayerAccount.address, solverArcAddress: relayerAccount.address }
    : {},
);
const persist = await initPersistence(store, config.databasePath);

// Pre-create a small pool of Circle wallets so creator signups are instant (no
// wallet-creation latency at signup time). Best-effort: never blocks boot.
if (circleWalletsReady()) {
  await ensureWalletPool(store, 5).catch((e) =>
    console.warn("Circle wallet pool warm-up skipped:", e instanceof Error ? e.message : e),
  );
}

const makeContext = makeContextFactory(store);

const app = new Hono();

// CORS: open by default so the public storefront + embeddable widget work from
// any origin (API auth is header-based, not cookie-based, so this is safe). Set
// CORS_ORIGINS to lock browser origins down for a hardened deployment.
app.use("*", config.corsOrigins.length > 0 ? cors({ origin: config.corsOrigins }) : cors());

// Per-IP rate limits to blunt abusive bursts (signup/OTP/payment floods).
app.use("*", rateLimit({ windowMs: 60_000, max: 600, name: "global" }));
app.use("/trpc/*", rateLimit({ windowMs: 60_000, max: 240, name: "trpc" }));
app.use("/api/v1/*", rateLimit({ windowMs: 60_000, max: 240, name: "rest" }));
app.use("/api/v1/tenants/signup", rateLimit({ windowMs: 60_000, max: 12, name: "signup" }));

app.get("/health", async (c) => {
  const relayer = await liveRelayerStatus().catch(() => ({ ready: false, balanceUSDC: "0", low: false }));
  return c.json({
    ok: true,
    service: "arcane-treasury",
    onchainEnabled: config.onchainEnabled,
    /** True when every payment path settles REAL USDC on Arc (no simulation). */
    allReal: liveAgentReady(),
    liveX402: config.liveX402,
    /** Creator custodial wallets (Circle dev-controlled) are configured. */
    circleWallets: circleWalletsReady(),
    /** Live-settlement relayer funding — warns before the URL silently fails. */
    relayer,
    chainId: 5042002,
    // Redact any per-user node token (e.g. the Canteen swrm_ token) — never
    // expose a secret RPC credential on a public endpoint.
    rpc: config.rpcHttp.replace(/swrm_[A-Za-z0-9]+/g, "swrm_***"),
  });
});

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
      makeContext(c.req.header("x-api-key"), c.req.header("x-creator-token"))) as never,
  }),
);

// Remote MCP over Streamable HTTP — ANY MCP client (Claude Code, Cursor, …) adds
// it by URL, no local clone or Bun needed:
//   claude mcp add --transport http splitstream https://<host>/mcp
// Session-based: `initialize` (no session header) spins up a server+transport
// bound to the LIVE store and returns an Mcp-Session-Id; subsequent requests
// carrying that id reuse the same initialized session. Agents discover and pay
// the real catalog (list_pieces / call_api / …).
const mcpSessions = new Map<string, StreamableHTTPTransport>();
app.all("/mcp", async (c) => {
  const sid = c.req.header("mcp-session-id");
  let transport = sid ? mcpSessions.get(sid) : undefined;
  if (!transport) {
    transport = new StreamableHTTPTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id: string) => {
        mcpSessions.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) mcpSessions.delete(transport!.sessionId);
    };
    const mcp = createMcpServer(store);
    await mcp.connect(transport);
  }
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
