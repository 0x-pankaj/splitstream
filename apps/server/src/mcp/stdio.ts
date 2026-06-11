/**
 * MCP stdio entrypoint. Run with `bun run src/mcp/stdio.ts` and register in a
 * client (e.g. Claude Code:  claude mcp add arcane-treasury -- bun run <path>).
 *
 * Seeds the demo world so the tools have a live tenant, solvers, and an agent
 * wallet to operate on out of the box.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { store } from "../db/store.js";
import { seedDemo } from "../db/seed.js";
import { createMcpServer } from "./server.js";

seedDemo(store);

const server = createMcpServer(store);
const transport = new StdioServerTransport();
await server.connect(transport);

// stderr is safe for logs; stdout is reserved for the MCP protocol stream.
console.error("Arcane Treasury MCP server ready (stdio). Demo key: arc_test_sk_demo_0001");
