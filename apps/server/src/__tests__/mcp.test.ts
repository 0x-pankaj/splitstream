import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_API_KEY, DEMO_TENANT_ID, DEMO_RECIPIENTS } from "../db/seed.js";
import { createMcpServer } from "../mcp/server.js";
import { resetCursors } from "../services/solverMesh.js";
import { resetAgentWindows } from "../services/agentTreasury.js";

async function connectedClient() {
  const store = new Store();
  seedDemo(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, store };
}

function textOf(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text: string }> }).content;
  return content.map((c) => c.text).join("\n");
}

beforeEach(() => {
  resetCursors();
  resetAgentWindows();
});

describe("MCP server", () => {
  it("advertises the treasury tools", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_audit_log",
        "get_treasury_balance",
        "list_pieces",
        "pay_for_piece",
        "set_agent_policy",
        "simulate_route",
        "submit_bulk_payout",
      ].sort(),
    );
  });

  it("returns the treasury balance for a valid key", async () => {
    const { client } = await connectedClient();
    const res = await client.callTool({ name: "get_treasury_balance", arguments: { apiKey: DEMO_API_KEY } });
    const data = JSON.parse(textOf(res));
    expect(data.balanceUSDC).toBe("1000000");
    expect(data.instantThresholdUSDC).toBe("5000");
  });

  it("rejects an invalid api key", async () => {
    const { client } = await connectedClient();
    const res = await client.callTool({ name: "get_treasury_balance", arguments: { apiKey: "nope" } });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it("settles an agent-initiated payout within policy", async () => {
    const { client, store } = await connectedClient();
    const res = await client.callTool({
      name: "submit_bulk_payout",
      arguments: {
        apiKey: DEMO_API_KEY,
        idempotencyKey: "mcp-batch-0001",
        agentId: "agent-adbuyer-01",
        payouts: [
          { recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "500", currencyCode: "USD" },
        ],
      },
    });
    const data = JSON.parse(textOf(res));
    expect(data.accepted).toBe(1);
    expect(store.auditForTenant(DEMO_TENANT_ID)).toHaveLength(1);
  });

  it("blocks an agent payout that breaches the per-transaction cap", async () => {
    const { client } = await connectedClient();
    const res = await client.callTool({
      name: "submit_bulk_payout",
      arguments: {
        apiKey: DEMO_API_KEY,
        idempotencyKey: "mcp-overcap-1",
        agentId: "agent-adbuyer-01",
        payouts: [
          { recipientAddress: DEMO_RECIPIENTS[0]!.address, targetChain: "base", amountUSDC: "9999", currencyCode: "USD" },
        ],
      },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toContain("AGENT_POLICY_EXCEEDED");
  });
});
