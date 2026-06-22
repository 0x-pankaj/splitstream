import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../db/store.js";
import { seedDemo } from "../db/seed.js";
import { heuristicDecide, runReadingAgent } from "../services/readingAgent.js";
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

describe("reading agent (heuristic)", () => {
  it("scores pieces by interest match", () => {
    const store = freshStore();
    const decisions = heuristicDecide(store.listPieces(), {
      interests: ["stablecoin", "arc"],
      maxUnlocks: 3,
      budgetUSDC: "0.50",
    });
    // The seeded "Stablecoin Frontier: Inside Arc L1" piece matches both.
    const top = decisions[0]!;
    expect(top.unlock).toBe(true);
    expect(top.score).toBeGreaterThan(1);
  });

  it("autonomously unlocks and pays creators within budget", async () => {
    const store = freshStore();
    const result = await runReadingAgent(
      store,
      { interests: ["stablecoin", "arc"], maxUnlocks: 3, budgetUSDC: "0.50" },
      1_000_000,
    );

    expect(result.mode).toBe("heuristic"); // no OPENROUTER_API_KEY in tests
    expect(result.unlocked).toBeGreaterThanOrEqual(1);
    // Each unlock fanned out across the piece's contributors (simulated dev
    // fallback in tests; real on Arc in production).
    expect(result.unlocks[0]!.payouts.length).toBe(3);
    // Spend stayed within budget.
    expect(Number(result.spentUSDC)).toBeLessThanOrEqual(0.5);
  });

  it("respects the budget ceiling", async () => {
    const store = freshStore();
    // Budget below the piece price ($0.05) → nothing unlocks.
    const result = await runReadingAgent(
      store,
      { interests: ["stablecoin"], maxUnlocks: 3, budgetUSDC: "0.01" },
      1_000_000,
    );
    expect(result.unlocked).toBe(0);
    expect(result.spentUSDC).toBe("0");
  });
});
