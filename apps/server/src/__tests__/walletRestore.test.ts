import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_PIECE_ID } from "../db/seed.js";
import { restoreEntitlements, ownershipMessage } from "../services/walletRestore.js";

// A throwaway test key — derives a stable address we can grant + sign with.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(TEST_KEY);

function freshStore(): Store {
  const store = new Store();
  seedDemo(store);
  return store;
}

async function signedProof(now: number) {
  const issuedISO = new Date(now).toISOString();
  const message = ownershipMessage(account.address, issuedISO);
  const signature = await account.signMessage({ message });
  return { address: account.address, message, signature };
}

describe("restoreEntitlements (prove wallet → restore purchases)", () => {
  it("returns the wallet's unlocked pieces (with content) on a valid signature", async () => {
    const store = freshStore();
    const now = 1_700_000_000_000;
    // Simulate a prior wallet/terminal payment that granted this wallet access.
    store.grantEntitlement(DEMO_PIECE_ID, account.address);

    const result = await restoreEntitlements(store, await signedProof(now), now);

    expect(result.count).toBe(1);
    expect(result.pieces[0]!.pieceId).toBe(DEMO_PIECE_ID);
    const piece = store.getPiece(DEMO_PIECE_ID)!;
    expect(result.pieces[0]!.content).toBe(piece.content ?? null);
    expect(result.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("returns nothing for a wallet that never paid (no leak of others' content)", async () => {
    const store = freshStore();
    const now = 1_700_000_000_000;
    // No entitlement granted to this wallet.
    const result = await restoreEntitlements(store, await signedProof(now), now);
    expect(result.count).toBe(0);
    expect(result.pieces).toHaveLength(0);
  });

  it("rejects a signature whose signer is not the claimed address", async () => {
    const store = freshStore();
    const now = 1_700_000_000_000;
    store.grantEntitlement(DEMO_PIECE_ID, account.address);
    const proof = await signedProof(now);
    // Tamper: claim a different address than the one that signed.
    const forged = { ...proof, address: "0x000000000000000000000000000000000000dEaD" };
    await expect(restoreEntitlements(store, forged, now)).rejects.toThrow(/does not match/i);
  });

  it("rejects a stale proof (older than the validity window)", async () => {
    const store = freshStore();
    const issuedAt = 1_700_000_000_000;
    const proof = await signedProof(issuedAt);
    // Verify 20 minutes later — outside the 10-minute window.
    const later = issuedAt + 20 * 60 * 1000;
    await expect(restoreEntitlements(store, proof, later)).rejects.toThrow(/expired/i);
  });
});
