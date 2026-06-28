import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { formatUsdc6, parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import {
  requestCreatorOtp,
  verifyCreatorOtp,
  authenticateCreator,
} from "../services/creatorAuth.js";
import { creatorEarnings } from "../services/creatorEarnings.js";
import { appRouter } from "../trpc/router.js";

const NOW = 1_780_000_000_000; // fixed clock — never Date.now() in tests

/** Drive request→verify and return the captured 6-digit code from stdout (dev). */
async function loginCode(store: Store, email: string, now = NOW): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await requestCreatorOtp(store, email, now);
    const line = spy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("login code for"));
    const match = line?.match(/:\s*(\d{6})\s*$/);
    if (!match?.[1]) throw new Error(`no OTP code logged; saw: ${line}`);
    return match[1];
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("creator email + OTP login", () => {
  it("creates an account with a wallet + publisher tenant on first verify", async () => {
    const store = new Store();
    const code = await loginCode(store, "Ada@Example.com");
    const { token, creator, isNew } = await verifyCreatorOtp(
      store,
      { email: "ada@example.com", code, displayName: "Ada Lovelace" },
      NOW,
    );

    expect(isNew).toBe(true);
    expect(creator.email).toBe("ada@example.com");
    expect(creator.handle).toBe("ada-lovelace");
    // Zero-key dev → a labeled local-dev EVM wallet so the flow is demoable.
    expect(creator.walletProvider).toBe("local-dev");
    expect(creator.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // The creator owns a publisher tenant, funded in mirror mode.
    expect(store.tenants.get(creator.tenantId)).toBeDefined();
    expect(store.balanceOf(creator.tenantId)).toBe(parseUsdc6("1000000"));
    // The session resolves back to the creator.
    expect(authenticateCreator(store, token, NOW).id).toBe(creator.id);
  });

  it("returns the same account (not a new one) on a second login", async () => {
    const store = new Store();
    const first = await verifyCreatorOtp(
      store,
      { email: "bob@example.com", code: await loginCode(store, "bob@example.com") },
      NOW,
    );
    const second = await verifyCreatorOtp(
      store,
      { email: "bob@example.com", code: await loginCode(store, "bob@example.com") },
      NOW,
    );
    expect(second.isNew).toBe(false);
    expect(second.creator.id).toBe(first.creator.id);
    expect(store.creators.size).toBe(1);
  });

  it("rejects a wrong code and an expired code", async () => {
    const store = new Store();
    await loginCode(store, "carol@example.com");
    await expect(
      verifyCreatorOtp(store, { email: "carol@example.com", code: "000000" }, NOW),
    ).rejects.toThrow(/incorrect/i);

    const code = await loginCode(store, "carol@example.com");
    await expect(
      verifyCreatorOtp(store, { email: "carol@example.com", code }, NOW + 11 * 60 * 1000),
    ).rejects.toThrow(/expired/i);
  });

  it("makes duplicate handles unique", async () => {
    const store = new Store();
    const a = await verifyCreatorOtp(
      store,
      { email: "a@x.com", code: await loginCode(store, "a@x.com"), handle: "writer" },
      NOW,
    );
    const b = await verifyCreatorOtp(
      store,
      { email: "b@x.com", code: await loginCode(store, "b@x.com"), displayName: "writer" },
      NOW,
    );
    expect(a.creator.handle).toBe("writer");
    expect(b.creator.handle).not.toBe("writer");
    expect(b.creator.handle.startsWith("writer-")).toBe(true);
  });

  it("rejects an unknown or expired session token", () => {
    const store = new Store();
    expect(() => authenticateCreator(store, "nope", NOW)).toThrow(/log ?in/i);
    expect(() => authenticateCreator(store, undefined, NOW)).toThrow(/log ?in/i);
  });
});

describe("creator earnings rollup", () => {
  it("sums only real on-chain payouts to the creator's address", () => {
    const store = new Store();
    const addr = "0xAaaaAAAAaaAAaAAAAaAAAAaaAAaAAaaAAAAAaAaA";
    store.recordOnchainSettlement({
      pieceId: "p1",
      title: "Piece One",
      kind: "article",
      price6: parseUsdc6("0.05"),
      payer: "0xpayer",
      paymentTx: "0xtx",
      payouts: [
        { role: "writer", address: addr, share6: parseUsdc6("0.03"), txHash: "0xa" },
        { role: "editor", address: "0xother", share6: parseUsdc6("0.02"), txHash: "0xb" },
      ],
      at: new Date(NOW).toISOString(),
    });
    store.recordOnchainSettlement({
      pieceId: "p1",
      title: "Piece One",
      kind: "article",
      price6: parseUsdc6("0.05"),
      payer: "0xpayer",
      paymentTx: "0xtx2",
      payouts: [{ role: "writer", address: addr.toLowerCase(), share6: parseUsdc6("0.03"), txHash: "0xc" }],
      at: new Date(NOW).toISOString(),
    });

    const e = creatorEarnings(store, addr);
    expect(e.totalEarnedUSDC).toBe(formatUsdc6(parseUsdc6("0.06")));
    expect(e.payoutCount).toBe(2);
    expect(e.pieces).toHaveLength(1);
    expect(e.pieces[0]?.pieceId).toBe("p1");
    expect(e.recent).toHaveLength(2);
  });

  it("is empty-safe for a creator with no address or no payouts", () => {
    const store = new Store();
    expect(creatorEarnings(store, null).totalEarnedUSDC).toBe("0.00");
    expect(creatorEarnings(store, "0xnobody").payoutCount).toBe(0);
  });
});

describe("creator tRPC flow (router + context wiring)", () => {
  it("logs in, publishes via session, and resolves a creatorRef contributor", async () => {
    const store = new Store();

    // Public caller (no session). Request the code THROUGH the router so it uses
    // the same Date.now() clock the router's verify will check against.
    const anon = appRouter.createCaller({ store, auth: null, creatorToken: null });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await anon.creator.requestOtp({ email: "dev@x.com" });
    const line = spy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("login code for"));
    spy.mockRestore();
    const code = line?.match(/:\s*(\d{6})\s*$/)?.[1];
    if (!code) throw new Error(`no OTP code logged; saw: ${line}`);

    const login = await anon.creator.verifyOtp({ email: "dev@x.com", code, displayName: "Dev One" });
    expect(login.token).toMatch(/^ses_/);

    // Authenticated caller (carries the session token like x-creator-token).
    const me = appRouter.createCaller({ store, auth: null, creatorToken: login.token });
    const profile = await me.creator.me();
    expect(profile.handle).toBe("dev-one");

    // Publish a piece that pays the creator 70% (by handle) + a BYO address 30%.
    const piece = await me.creator.publish({
      title: "My First Piece",
      kind: "article",
      priceUSDC: "0.05",
      content: "gated body",
      contributors: [
        { role: "writer", splitBps: 7000, creatorRef: "dev-one" },
        {
          role: "editor",
          splitBps: 3000,
          address: "0x2222222222222222222222222222222222222222",
          targetChain: "arbitrum",
        },
      ],
    });
    expect(piece.contributors).toHaveLength(2);
    // The creatorRef leg resolved to the creator's assigned wallet address.
    expect(piece.contributors[0]?.address.toLowerCase()).toBe(profile.walletAddress?.toLowerCase());

    const mine = await me.creator.myPieces();
    expect(mine.map((p) => p.id)).toContain(piece.id);
  });

  it("rejects publish without a valid session", async () => {
    const store = new Store();
    const anon = appRouter.createCaller({ store, auth: null, creatorToken: null });
    await expect(
      anon.creator.publish({
        title: "x",
        kind: "article",
        priceUSDC: "0.01",
        contributors: [{ role: "writer", splitBps: 10000, creatorRef: "ghost" }],
      }),
    ).rejects.toThrow();
  });
});

describe("circle wallet pool", () => {
  it("pushes and pops pre-created wallets FIFO", () => {
    const store = new Store();
    expect(store.circleWalletPoolSize()).toBe(0);
    store.pushCircleWallets([
      { id: "w1", address: "0x1" },
      { id: "w2", address: "0x2" },
    ]);
    expect(store.circleWalletPoolSize()).toBe(2);
    expect(store.popCircleWallet()?.id).toBe("w1");
    expect(store.popCircleWallet()?.id).toBe("w2");
    expect(store.popCircleWallet()).toBeUndefined();
  });
});
