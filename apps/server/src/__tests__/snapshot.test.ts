import { describe, it, expect, afterEach } from "vitest";
import { parseUsdc6 } from "@arcane/shared";
import { Store } from "../db/store.js";
import { serializeSnapshot, deserializeSnapshot } from "../db/snapshot.js";
import { config } from "../config.js";

/** Build a store with the SplitStream real-user state worth persisting. */
function seedStore(): Store {
  const store = new Store();
  store.upsertCreator({
    id: "c1",
    email: "ada@example.com",
    handle: "ada",
    displayName: "Ada",
    tenantId: "t1",
    walletId: "w-circle-1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletProvider: "circle",
    createdAt: new Date(1_780_000_000_000).toISOString(),
  });
  store.putCreatorSession({ token: "ses_abc", creatorId: "c1", expiresAt: 9_999_999_999_999 });
  store.pushCircleWallets([{ id: "w2", address: "0x2" }]);
  store.createPiece({
    id: "p1",
    publisherTenantId: "t1",
    title: "Piece",
    kind: "article",
    price6: parseUsdc6("0.05"),
    contributors: [
      { role: "writer", address: "0x1111111111111111111111111111111111111111", targetChain: "base", splitBps: 10000 },
    ],
  });
  return store;
}

afterEach(() => {
  config.snapshotEncKey = undefined;
});

describe("snapshot codec — real-user state", () => {
  it("round-trips creators, sessions, wallet pool, and pieces (plaintext)", () => {
    const blob = serializeSnapshot(seedStore());
    expect(blob.startsWith("enc:")).toBe(false);

    const restored = new Store();
    deserializeSnapshot(restored, blob);
    expect(restored.creators.get("c1")?.email).toBe("ada@example.com");
    expect(restored.creatorForSession("ses_abc", 1_780_000_000_001)?.id).toBe("c1");
    expect(restored.circleWalletPoolSize()).toBe(1);
    expect(restored.getPiece("p1")?.price6).toBe(parseUsdc6("0.05"));
  });

  it("encrypts at rest when SNAPSHOT_ENC_KEY is set, and decrypts back", () => {
    config.snapshotEncKey = "a-test-secret-key";
    const blob = serializeSnapshot(seedStore());
    // Encrypted blob is opaque — no plaintext email leaks into it.
    expect(blob.startsWith("enc:v1:")).toBe(true);
    expect(blob.includes("ada@example.com")).toBe(false);

    const restored = new Store();
    deserializeSnapshot(restored, blob);
    expect(restored.creators.get("c1")?.email).toBe("ada@example.com");
  });

  it("refuses to restore an encrypted blob without the key", () => {
    config.snapshotEncKey = "a-test-secret-key";
    const blob = serializeSnapshot(seedStore());
    config.snapshotEncKey = undefined;
    expect(() => deserializeSnapshot(new Store(), blob)).toThrow(/SNAPSHOT_ENC_KEY/);
  });
});
