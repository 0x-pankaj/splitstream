import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_API_ID } from "../db/seed.js";
import {
  issueChallenge,
  decodePaymentHeader,
  verifyPayment,
  encodePaymentResponse,
  X402_NETWORK,
  X402_VERSION,
  type PaymentPayload,
} from "../services/x402.js";

function freshStore(): Store {
  const store = new Store();
  seedDemo(store);
  return store;
}

function buildProof(nonce: string, over: Partial<PaymentPayload> = {}): string {
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: X402_NETWORK,
    payload: { nonce, from: "0xagent", authorization: "0xref" },
    ...over,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

let store: Store;
beforeEach(() => {
  store = freshStore();
});

describe("x402 challenge", () => {
  it("issues spec-shaped PaymentRequirements with a single-use nonce", () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const body = issueChallenge(store, piece, 1_000_000);
    expect(body.x402Version).toBe(X402_VERSION);
    const req = body.accepts[0]!;
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(X402_NETWORK);
    expect(req.maxAmountRequired).toBe(piece.price6.toString());
    expect(req.resource).toContain(piece.id);
    expect(req.nonce).toMatch(/^0x[0-9a-f]{32}$/);
    // The nonce is now redeemable exactly once.
    expect(store.x402Challenges.has(req.nonce)).toBe(true);
  });
});

describe("x402 verify", () => {
  it("accepts a valid proof for the issued nonce", async () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const nonce = issueChallenge(store, piece, 1_000_000).accepts[0]!.nonce;
    const payload = decodePaymentHeader(buildProof(nonce))!;
    const v = await verifyPayment(store, piece, payload, 1_000_001);
    expect(v.ok).toBe(true);
    expect(v.payer).toBe("0xagent");
    expect(v.amount6).toBe(piece.price6);
  });

  it("rejects a replayed nonce (single-use)", async () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const nonce = issueChallenge(store, piece, 1_000_000).accepts[0]!.nonce;
    const proof = decodePaymentHeader(buildProof(nonce))!;
    expect((await verifyPayment(store, piece, proof, 1_000_001)).ok).toBe(true);
    const replay = await verifyPayment(store, piece, proof, 1_000_002);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/already used/);
  });

  it("rejects an unknown nonce", async () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const proof = decodePaymentHeader(buildProof("0xdeadbeef"))!;
    const v = await verifyPayment(store, piece, proof, 1_000_001);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/unknown or expired/);
  });

  it("rejects an expired challenge", async () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const nonce = issueChallenge(store, piece, 1_000_000).accepts[0]!.nonce;
    const proof = decodePaymentHeader(buildProof(nonce))!;
    const v = await verifyPayment(store, piece, proof, 1_000_000 + 6 * 60 * 1000);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/expired/);
  });

  it("rejects the wrong network", async () => {
    const piece = store.getPiece(DEMO_API_ID)!;
    const nonce = issueChallenge(store, piece, 1_000_000).accepts[0]!.nonce;
    const proof = decodePaymentHeader(buildProof(nonce, { network: "ethereum" }))!;
    const v = await verifyPayment(store, piece, proof, 1_000_001);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/network/);
  });
});

describe("x402 header codecs", () => {
  it("round-trips the X-PAYMENT-RESPONSE header", () => {
    const enc = encodePaymentResponse({ success: true, transaction: "0xabc", network: X402_NETWORK, payer: "0xagent" });
    const dec = JSON.parse(Buffer.from(enc, "base64").toString("utf8"));
    expect(dec.success).toBe(true);
    expect(dec.transaction).toBe("0xabc");
  });

  it("returns null for a malformed X-PAYMENT header", () => {
    expect(decodePaymentHeader(undefined)).toBeNull();
    expect(decodePaymentHeader("not-base64-json")).toBeNull();
  });
});
