import { describe, it, expect } from "vitest";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_PIECE_ID } from "../db/seed.js";
import { issueRecoveryCode, redeemRecoveryCode, readerLibrary, normalizeCode } from "../services/recovery.js";

function freshStore(): Store {
  const store = new Store();
  seedDemo(store);
  return store;
}

describe("recovery codes (no-wallet library portability)", () => {
  it("issues a code and redeems it onto a new device's reader id", () => {
    const store = freshStore();
    const deviceA = "reader_device_A";
    store.grantEntitlement(DEMO_PIECE_ID, deviceA);

    const { code } = issueRecoveryCode(store, deviceA);
    expect(code).toMatch(/^SS-/);

    // A different device redeems the code → gains the same library.
    const deviceB = "reader_device_B";
    expect(store.hasEntitlement(DEMO_PIECE_ID, deviceB)).toBe(false);
    const redeemed = redeemRecoveryCode(store, code, deviceB);
    expect(redeemed.count).toBe(1);
    expect(redeemed.pieces[0]!.pieceId).toBe(DEMO_PIECE_ID);
    expect(store.hasEntitlement(DEMO_PIECE_ID, deviceB)).toBe(true);
    // Device A keeps its access too (copy, not move).
    expect(store.hasEntitlement(DEMO_PIECE_ID, deviceA)).toBe(true);
  });

  it("tolerates lowercase / spaced code entry", () => {
    const store = freshStore();
    const a = "reader_a";
    store.grantEntitlement(DEMO_PIECE_ID, a);
    const { code } = issueRecoveryCode(store, a);
    const messy = `  ${code.toLowerCase()}  `;
    expect(normalizeCode(messy)).toBe(code);
    const redeemed = redeemRecoveryCode(store, messy, "reader_b");
    expect(redeemed.count).toBe(1);
  });

  it("refuses to mint a code when the reader owns nothing", () => {
    const store = freshStore();
    expect(() => issueRecoveryCode(store, "reader_empty")).toThrow(/nothing to back up/i);
  });

  it("rejects an unknown code", () => {
    const store = freshStore();
    expect(() => redeemRecoveryCode(store, "SS-ZZZZ-ZZZZ", "reader_x")).toThrow(/not valid/i);
  });

  it("library returns content for a browser id but not for a bare wallet address", () => {
    const store = freshStore();
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    const browser = "reader_browser";
    const wallet = "0x81348119cD0609a044475Fcef15660781abb0CBb";
    store.grantEntitlement(DEMO_PIECE_ID, browser);
    store.grantEntitlement(DEMO_PIECE_ID, wallet);

    const browserLib = readerLibrary(store, browser);
    expect(browserLib.count).toBe(1);
    expect(browserLib.pieces[0]!.content).toBe(piece.content ?? null);

    const walletLib = readerLibrary(store, wallet);
    expect(walletLib.count).toBe(1); // owns it (metadata visible)
    expect(walletLib.pieces[0]!.content).toBeNull(); // but content gated behind signature
  });
});
