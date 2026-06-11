# SplitStream — Build Plan & State

This is the **live status + roadmap**. Read `CLAUDE.md` first (product brief),
then this. After each work unit, update **§ Build State** at the bottom so the
next session resumes cleanly. This is a multi-session build; assume context will
reset.

---

## North star

A live URL where anyone unlocks a piece for a few cents and the payment fans out,
cross-chain, to every contributor in <500ms on Arc — with a public counter
showing **total creator payouts** climbing. That counter is the hackathon
traction metric. Everything serves it.

---

## Phases

### Phase 0 — Fork & docs ✅ DONE
- [x] Copy `arcane-treasury` → `splitstream` (no node_modules/.git/build).
- [x] `git init` + base snapshot commit.
- [x] Rewrite `CLAUDE.md` for SplitStream; preserve old spec as `CLAUDE.arcane-treasury.md`.
- [x] Write this plan.

### Phase 1 — Backend split flow (THE core) ✅ DONE
The minimum that proves the product. All in mirror mode (no keys needed).
- [x] `packages/shared/src/splits.ts` — `Piece`, `Contributor`, `PieceKind`
      types + `computeSplit(price6, contributors)` + `assertBpsSum`.
- [x] Export `splits.ts` from `packages/shared/src/index.ts`.
- [x] `packages/shared/src/schemas.ts` — `ContributorSchema`, `CreatePieceSchema`
      (bps sum = 10000), `PayPieceSchema`.
- [x] `apps/server/src/db/store.ts` — `pieces` map + `createPiece`, `getPiece`,
      `listPieces`, `recordUnlock`.
- [x] `apps/server/src/services/splitEngine.ts` — `payForPiece()` → builds a
      `BulkPayoutInput` from the piece, credits the vault for the reader payment,
      calls `processBulkPayout`, records the unlock.
- [x] `apps/server/src/routes/pieces.ts` — `POST /pieces`, `GET /pieces`,
      `GET /pieces/:id`, `POST /pieces/:id/pay`.
- [x] Mount in `apps/server/src/index.ts` (`app.route("/api/v1/pieces", …)`).
- [x] Seed a demo piece in `apps/server/src/db/seed.ts` (`DEMO_PIECE_ID`,
      3 contributors across base/arbitrum/solana, bps 6000/2500/1500, $0.05).
- [x] Vitest: `splitEngine.test.ts` — split math, exact-sum, cross-chain fan-out,
      stats increment. **37/37 tests green.**

**Acceptance: MET.** `POST /api/v1/pieces/piece-arc-frontier-001/pay` returns an
unlock receipt with one settled payout per contributor on base/arbitrum/solana
(instant path, sub-500ms, tx hashes), and `GET /pieces/:id` shows `unlocks`/
`totalPaid` incremented. Verified over HTTP in mirror mode.

### Phase 2 — Traction surface (the storefront + counter)
- [ ] Repurpose `apps/web` into a creator storefront: list pieces, "Unlock for
      $X" button, post-unlock reveal of the split fan-out (who got paid, which
      chain, tx hash, latency).
- [ ] **Live traction counter** (total unlocks, total creator payouts USDC,
      unique pieces, unique contributors) — tRPC procedure + prominent UI.
- [ ] Embedded **TipJar** widget (one-line embed → instant tip to a creator).
- [ ] Public read endpoints (no api key) for browsing + paying, so strangers can
      generate volume from a shared link.

### Phase 3 — Agentic layer (the 30%)
- [ ] **Reading-agent**: an Opus-driven loop that "reads" a feed of pieces and
      autonomously decides which to unlock + pay, bounded by `agentTreasury.ts`
      spend caps. This is "AI reading lists that auto-pay creators."
- [ ] Extend `apps/server/src/mcp/server.ts` with `list_pieces` + `pay_for_piece`
      tools so external agents discover and pay creators.
- [ ] (Stretch) x402 listing so third-party agents pay autonomously.

### Phase 4 — Live proof on Arc
- [ ] Light up `LIVE_GATEWAY=true` with a funded Arc unified-balance float; run
      one real unlock end-to-end (real Gateway settlement to a destination).
- [ ] Capture tx hashes + screenshot for the demo video.

### Phase 5 — Submission polish
- [ ] Rewrite root `README.md` for SplitStream (story, architecture, run steps,
      live URL, traction numbers).
- [ ] Rename packages `@arcane/*` → `@splitstream/*` (optional; cosmetic — do
      LAST, it touches every import). Until then, packages keep `@arcane/*` names.
- [ ] 3-min demo video: human unlocks → fan-out → reading-agent auto-pays →
      counter climbing.
- [ ] GRANT_PROPOSAL.md / submission form answers (see CLAUDE.md §1).

---

## Decisions & conventions (so future sessions stay consistent)

- **Package names stay `@arcane/*` for now.** Renaming is Phase 5 cosmetic work;
  doing it early just creates churn. Code reads `@arcane/shared`, `@arcane/server`.
- **Money is always 6dp `bigint`.** Pieces store `price6: bigint`,
  `totalPaid6: bigint`. Serialize to strings at the API boundary (see
  `trpc/serialize.ts` pattern).
- **`computeSplit` remainder rule:** integer-divide each share by bps; the
  leftover dust (from flooring) goes to the contributor with the **largest
  splitBps** (first one on ties) so `sum(shares) == price6` exactly. Never lose
  or mint a base unit.
- **Fee model (v1):** the engine adds network+convenience fees *on top* of gross.
  For v1 we credit the publisher vault for `price + fees` so funding never fails,
  and contributor shares sum to the full `price`. **v2 refinement:** net the
  platform fee *out of* the reader's price (reader pays price; contributors split
  price − fee). Tracked here, not yet done.
- **Compliance:** contributors are auto-whitelisted at piece creation, so the
  reused compliance precheck passes. Don't remove that.
- **Reader auth:** `POST /pieces/:id/pay` is public (no api key) — readers don't
  have keys. Piece creation requires a publisher api key.

---

## Build State (UPDATE THIS LAST, EVERY SESSION)

**Last updated:** session 1.

**Done:**
- Phase 0 complete (fork, git, docs).
- **Phase 1 complete** — backend split flow shipped & verified:
  - `splits.ts` (types + `computeSplit`), schemas, store pieces, `splitEngine.ts`
    (`payForPiece`), `routes/pieces.ts`, wired into `index.ts`, demo piece seeded.
  - `pnpm typecheck` clean (6/6 packages); `pnpm test` green (37/37).
  - HTTP smoke test passed in mirror mode: a $0.05 unlock split to writer (Base),
    editor (Arbitrum), photographer (Solana), all settled instant path <500ms.

**Next session, do this first:**
1. `pnpm install` if node_modules is missing, then `pnpm typecheck` + `pnpm test`
   to confirm a green baseline.
2. **Start Phase 2 — traction surface.** Repurpose `apps/web` into the creator
   storefront: list pieces (GET /api/v1/pieces), an "Unlock for $X" button hitting
   POST /pieces/:id/pay, and a post-unlock reveal of the cross-chain fan-out.
   Add a **live traction counter** (total unlocks, total creator payouts) — add a
   tRPC procedure aggregating `store.pieces` (sum `unlocks`, `totalPaid6`).
3. Then Phase 3 (reading-agent + MCP `pay_for_piece` tool).

**Important runtime notes / gotchas:**
- **`apps/server/.env` forces LIVE Arc mode** (it has `RELAYER_PRIVATE_KEY` +
  `VAULT_ADDRESS`). bun auto-loads `.env`, so `env -u` does NOT override it. To run
  the **mirror-mode demo**, move `.env` aside (`mv .env .env.live.bak`) or run from
  a dir without it. Live mode currently REVERTS on unlock because the deployed
  vault has no on-chain balance/whitelist for the demo contributors — that's
  expected; live proof is Phase 4 (needs on-chain deposit + recipient whitelist
  for real contributor addresses, or fresh contributors funded on-chain).
- **Do not `pkill -f "src/index.ts"`** in a shell whose own command line contains
  that string — it kills the parent shell (exit 144). Kill by captured `$!` PID or
  `fuser -k 8787/tcp`.
- node_modules/.git/build excluded from the copy; `contracts/out`+`broadcast`
  regenerate via `forge build`.
- Keep mirror mode working with zero keys — it's the demo path.

**Fee model TODO (v2):** today the vault is credited `price + fees` and
contributors split the full `price` (fee-on-top). Net the platform fee out of the
reader's price instead (reader pays price; contributors split price − fee). See
`splitEngine.ts` step 3.
