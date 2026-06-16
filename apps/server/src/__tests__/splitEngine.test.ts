import { describe, it, expect, beforeEach } from "vitest";
import { computeSplit, parseUsdc6, type Contributor } from "@arcane/shared";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_TENANT_ID, DEMO_PIECE_ID } from "../db/seed.js";
import { payForPiece, callPaidService } from "../services/splitEngine.js";
import { serializePiece } from "../trpc/serialize.js";
import { resetCursors } from "../services/solverMesh.js";
import { resetAgentWindows } from "../services/agentTreasury.js";

function freshStore(): Store {
  const store = new Store();
  seedDemo(store);
  return store;
}

beforeEach(() => {
  resetCursors();
  resetAgentWindows();
});

describe("computeSplit", () => {
  it("splits exactly and assigns dust to the largest share", () => {
    const contributors: Contributor[] = [
      { role: "a", address: "0x1", targetChain: "base", splitBps: 6000 },
      { role: "b", address: "0x2", targetChain: "base", splitBps: 2500 },
      { role: "c", address: "0x3", targetChain: "base", splitBps: 1500 },
    ];
    // $0.05 = 50000 base units. 60/25/15 → 30000 / 12500 / 7500, sums exactly.
    const shares = computeSplit(parseUsdc6("0.05"), contributors);
    expect(shares).toEqual([30000n, 12500n, 7500n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(parseUsdc6("0.05"));
  });

  it("never loses or mints a base unit on indivisible prices", () => {
    const contributors: Contributor[] = [
      { role: "a", address: "0x1", targetChain: "base", splitBps: 3334 },
      { role: "b", address: "0x2", targetChain: "base", splitBps: 3333 },
      { role: "c", address: "0x3", targetChain: "base", splitBps: 3333 },
    ];
    const price = 1n; // 1 base unit, impossible to split evenly
    const shares = computeSplit(price, contributors);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(price);
    // The remainder lands on the largest-bps contributor (index 0).
    expect(shares[0]).toBe(1n);
  });

  it("rejects contributor sets whose bps do not sum to 10000", () => {
    const bad: Contributor[] = [
      { role: "a", address: "0x1", targetChain: "base", splitBps: 5000 },
    ];
    expect(() => computeSplit(100n, bad)).toThrow(/sum to 10000/);
  });
});

describe("payForPiece (read → pay → cross-chain split)", () => {
  it("fans a single unlock out to every contributor on their own chain", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;

    const result = await payForPiece(store, piece, { payer: "reader-001" }, 1_000_000);

    // One settlement per contributor.
    expect(result.contributors).toHaveLength(3);
    expect(result.batch.accepted).toBe(3);

    // Each contributor settled on the chain the piece assigned them.
    const byChain = Object.fromEntries(
      result.contributors.map((c) => [c.targetChain, c]),
    );
    expect(byChain.base!.role).toBe("writer");
    expect(byChain.arbitrum!.role).toBe("editor");
    expect(byChain.solana!.role).toBe("photographer");

    // Funds landed across three distinct chains.
    expect(new Set(result.chains).size).toBe(3);

    // Shares sum to exactly the unlock price.
    const sumShares = result.contributors.reduce((acc, c) => acc + BigInt(c.share6), 0n);
    expect(sumShares).toBe(parseUsdc6("0.05"));

    // Every leg settled and carries a destination tx hash.
    for (const c of result.contributors) {
      expect(c.settlement.status).toBe("settled");
      expect(c.settlement.destinationTxHash).toBeTruthy();
    }
  });

  it("increments the piece's traction stats on each unlock", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;

    await payForPiece(store, piece, {}, 1_000_000);
    await payForPiece(store, piece, {}, 2_000_000);

    const updated = store.getPiece(DEMO_PIECE_ID)!;
    expect(updated.unlocks).toBe(2);
    expect(updated.totalPaid6).toBe(parseUsdc6("0.10"));
  });
});

describe("authenticated API piece — credential injection without leak", () => {
  it("never serializes the upstream secret", () => {
    const store = freshStore();
    const piece = store.createPiece({
      publisherTenantId: DEMO_TENANT_ID,
      title: "Secret API",
      kind: "api",
      price6: parseUsdc6("0.02"),
      endpoint: "https://example.test/data",
      httpMethod: "GET",
      auth: { type: "bearer", secret: "TOP_SECRET_KEY" },
      contributors: [
        { role: "owner", address: "0x1111111111111111111111111111111111111111", targetChain: "base", splitBps: 10000 },
      ],
    });
    const view = JSON.stringify(serializePiece(piece));
    expect(view).not.toContain("TOP_SECRET_KEY");
    // ...but the view does disclose that it's authenticated, and how.
    expect(serializePiece(piece).authenticated).toBe(true);
    expect(serializePiece(piece).authType).toBe("bearer");
  });

  it("injects the secret into the upstream call (the agent never sees it)", async () => {
    const store = freshStore();
    // Stub fetch to capture the outbound request and echo the auth header back.
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers as Record<string, string>) ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const piece = store.createPiece({
        publisherTenantId: DEMO_TENANT_ID,
        title: "Secret API",
        kind: "api",
        price6: parseUsdc6("0.02"),
        endpoint: "https://example.test/data",
        httpMethod: "GET",
        auth: { type: "bearer", secret: "TOP_SECRET_KEY" },
        contributors: [
          { role: "owner", address: "0x1111111111111111111111111111111111111111", targetChain: "base", splitBps: 10000 },
        ],
      });
      const result = await callPaidService(store, piece, { payer: "agent" }, 1_000_000);
      // The upstream received the injected Bearer credential...
      expect(calls[0]!.headers["authorization"]).toBe("Bearer TOP_SECRET_KEY");
      // ...and the result returned to the agent never contains the secret.
      expect(JSON.stringify(result.upstream)).not.toContain("TOP_SECRET_KEY");
      expect(result.upstream.ok).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
