/**
 * Coverage for the bulk payee endpoint (recipients.addMany) that powers the
 * dashboard's CSV upload and one-click "vet & whitelist this batch" action.
 */

import { describe, it, expect } from "vitest";
import { Store } from "../db/store.js";
import { seedDemo, DEMO_API_KEY } from "../db/seed.js";
import { appRouter } from "../trpc/router.js";
import { makeContextFactory } from "../trpc/context.js";

/** A tRPC caller bound to a fresh, isolated, mirror-mode store. */
function makeCaller() {
  const store = new Store();
  seedDemo(store);
  const ctx = makeContextFactory(store)(DEMO_API_KEY);
  return appRouter.createCaller(ctx);
}

describe("recipients.addMany", () => {
  it("vets a list of new payees and reports per-item results", async () => {
    const caller = makeCaller();
    const res = await caller.recipients.addMany({
      recipients: [
        { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", targetChain: "base" },
        { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", targetChain: "ethereum", label: "Vendor B" },
      ],
    });
    expect(res.total).toBe(2);
    expect(res.added).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.results.every((r) => r.ok)).toBe(true);

    const addresses = (await caller.recipients.list()).map((r) => r.address);
    expect(addresses).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(addresses).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("is idempotent — re-adding an existing payee is a no-op success", async () => {
    const caller = makeCaller();
    const input = {
      recipients: [{ address: "0xcccccccccccccccccccccccccccccccccccccccc", targetChain: "base" as const }],
    };
    await caller.recipients.addMany(input);
    const again = await caller.recipients.addMany(input);
    expect(again.added).toBe(1);
    expect(again.failed).toBe(0);

    const count = (await caller.recipients.list()).filter(
      (r) => r.address === "0xcccccccccccccccccccccccccccccccccccccccc",
    ).length;
    expect(count).toBe(1);
  });

  it("rejects a Solana address submitted under an EVM chain (Zod boundary)", async () => {
    const caller = makeCaller();
    await expect(
      caller.recipients.addMany({
        recipients: [{ address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", targetChain: "base" }],
      }),
    ).rejects.toThrow();
  });
});
