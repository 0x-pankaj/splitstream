import { describe, it, expect, beforeEach } from "vitest";
import { computeSplit, parseUsdc6, type Contributor } from "@arcane/shared";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_TENANT_ID, DEMO_PIECE_ID, DEMO_API_ID } from "../db/seed.js";
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

  it("gates content: hidden in catalog views, delivered only after payment", async () => {
    const store = freshStore();
    const SECRET_BODY = "# Members only\n\nThe full gated article body.";
    const piece = store.createPiece({
      publisherTenantId: DEMO_TENANT_ID,
      title: "Gated piece",
      kind: "article",
      price6: parseUsdc6("0.03"),
      preview: "A free teaser anyone can read.",
      content: SECRET_BODY,
      contributors: [
        { role: "writer", address: "0x1111111111111111111111111111111111111111", targetChain: "base", splitBps: 10000 },
      ],
    });

    // Catalog view: the teaser + a paywall flag are public; the body is NOT.
    const view = serializePiece(piece);
    expect(view.preview).toBe("A free teaser anyone can read.");
    expect(view.hasContent).toBe(true);
    expect(JSON.stringify(view)).not.toContain("Members only");

    // Paying reveals the body in the unlock receipt.
    const receipt = await payForPiece(store, piece, { payer: "reader" }, 3_000_000);
    expect(receipt.content).toBe(SECRET_BODY);
  });

  it("returns null content for an unlocked piece that has no body", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_API_ID)!; // api kind — no content body
    const receipt = await payForPiece(store, piece, {}, 4_000_000);
    expect(receipt.content).toBeNull();
  });

  it("grants the payer a durable entitlement (pay once, keep access)", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    const reader = "reader_abc";

    expect(store.hasEntitlement(piece.id, reader)).toBe(false);
    await payForPiece(store, piece, { payer: reader }, 5_000_000);

    // The reader now owns it — case-insensitively, and an anonymous reader does not.
    expect(store.hasEntitlement(piece.id, reader)).toBe(true);
    expect(store.hasEntitlement(piece.id, "READER_ABC")).toBe(true);
    expect(store.hasEntitlement(piece.id, "someone_else")).toBe(false);
  });

  it("does not grant an entitlement to an anonymous (no-payer) unlock", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    await payForPiece(store, piece, {}, 6_000_000);
    expect(store.hasEntitlement(piece.id, "")).toBe(false);
    expect(store.entitlements.size).toBe(0);
  });
});

describe("real wallet payments (env-gated)", () => {
  it("reports disabled when no live relayer is configured (test env)", async () => {
    const { walletPaymentInfo, claimWalletPayment } = await import("../services/walletPayment.js");
    expect(walletPaymentInfo()).toEqual({ enabled: false });

    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    await expect(claimWalletPayment(store, piece, "0x" + "ab".repeat(32))).rejects.toThrow(/not enabled/i);
  });
});

describe("on-chain traction ledger (verifiable real settlements)", () => {
  it("records real settlements and sums the real USDC paid to creators", () => {
    const store = freshStore();
    store.recordOnchainSettlement({
      pieceId: DEMO_PIECE_ID,
      title: "Real piece",
      kind: "article",
      price6: parseUsdc6("0.05"),
      payer: "0xagent",
      paymentTx: "0xpay1",
      payouts: [
        { role: "writer", address: "0x1111111111111111111111111111111111111111", share6: parseUsdc6("0.03"), txHash: "0xtx1" },
        { role: "editor", address: "0x2222222222222222222222222222222222222222", share6: parseUsdc6("0.02"), txHash: "0xtx2" },
      ],
      at: "2026-06-19T00:00:00.000Z",
    });

    expect(store.onchainSettlements).toHaveLength(1);
    // Real USDC total sums every payout leg's share.
    expect(store.onchainPaidTotal6()).toBe(parseUsdc6("0.05"));
    const recent = store.listOnchainSettlements();
    expect(recent[0]!.payouts[0]!.txHash).toBe("0xtx1");
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

describe("sponsoredUnlock (walletless / relayer-sponsored buy)", () => {
  it("simulated fallback grants a remembered entitlement and reveals content", async () => {
    const { sponsoredUnlock } = await import("../services/liveAgent.js");
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    const reader = "reader-phone-123";

    // No LIVE_X402 / relayer in tests → falls back to simulated settlement.
    const result = await sponsoredUnlock(store, piece, reader);

    expect(result.mode).toBe("simulated");
    expect(result.paymentTx).toBeNull();
    expect(result.payouts).toHaveLength(piece.contributors.length);
    // The reader is remembered: access persists without paying again.
    expect(store.hasEntitlement(DEMO_PIECE_ID, reader)).toBe(true);
    // A different reader is NOT entitled.
    expect(store.hasEntitlement(DEMO_PIECE_ID, "someone-else")).toBe(false);
    // The gated content is delivered to the buyer.
    expect(result.content).toBe(piece.content ?? null);
    // The unlock counts toward traction.
    expect(result.pieceUnlocks).toBeGreaterThanOrEqual(1);
  });

  it("counts distinct buyers (dedup), powering the traction buyers number", async () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;

    await payForPiece(store, piece, { payer: "alice" }, 1_000_000);
    await payForPiece(store, piece, { payer: "Alice" }, 1_000_001); // same buyer, different case
    await payForPiece(store, piece, { payer: "bob" }, 1_000_002);

    // Two distinct buyers, lowercased + deduped.
    expect(store.buyers.size).toBe(2);
    expect(store.buyers.has("alice")).toBe(true);
    expect(store.buyers.has("bob")).toBe(true);
  });

  it("rejects sponsoring an API piece (those are pay-per-call)", async () => {
    const { sponsoredUnlock } = await import("../services/liveAgent.js");
    const store = freshStore();
    const api = store.getPiece(DEMO_API_ID)!;
    // The router guards this, but the engine should also never grant content access
    // to an api piece via this path — content is null for api pieces.
    const result = await sponsoredUnlock(store, api, "reader-x");
    expect(result.content).toBeNull();
  });
});
