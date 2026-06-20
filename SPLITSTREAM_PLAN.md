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
- [ ] **FUTURE — per-creator earnings leaderboard.** "These addresses earned $X
      each," ranked, built off the on-chain settlement ledger
      (`store.onchainSettlements` → sum `payouts[].share6` per contributor address;
      also a simulated/all-flows variant from piece contributor splits). Renders
      the RFB's exact metric phrase "creators earning"; photographs well in the
      demo. New tRPC `traction.creatorLeaderboard` + a panel under the hero.
      Optional: link each address to its Arc explorer page; show chain badges.

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

**Last updated:** session 4 (mobile + walletless buy + restore + buyers/agent-fix).

**Unique-buyers counter + agent-button fix (session 4):**
- **Buyers traction number.** New `store.buyers` Set + `recordBuyer()` (lowercased,
  deduped), persisted in the snapshot, recorded at every pay site (`payForPiece`
  → payer/agent, `payLiveForPiece` → reader else agent, `claimWalletPayment` →
  wallet). `traction.stats` exposes `uniqueBuyers`; `TractionHero` shows a 5th
  "Buyers" cell (grid → `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`). NOTE:
  `contributorCount` is unique CREATORS in the catalog, not buyers — buying never
  moves it (that confused the user); `uniqueBuyers` is the demand metric.
- **Agent button now unlocks for the clicker.** `pieces.payLive` accepts an
  optional `reader`; the web passes `getReaderId()`, so the ⚡ "Agent pays REAL
  USDC" click grants the human a durable entitlement + returns content (revealed
  + cached) — no separate "Unlock" click, no double payment. Once owned, both buy
  buttons hide.
- Tests **63/63** (+1 buyers dedup). Typecheck + web build clean. Deploy: push
  (Vercel) + `railway up` (API).

**Wallet = portable identity · "restore purchases" (session 4):**

**Wallet = portable identity · "restore purchases" (session 4):**
- **Problem closed (content leak).** Entitlements keyed to a wallet address were
  revealable via public `pieces.access` just by knowing the address — and payer
  addresses are public on-chain. `pieces.access` now returns `content: null` for
  any reader matching `^0x[40 hex]$` (the `entitled` boolean, which is already
  on-chain-public, still returns). Unguessable browser reader ids keep the
  lightweight content path (the no-wallet sponsored flow).
- **Restore by signature.** New `services/walletRestore.ts` +
  `store.entitledPieceIdsFor(reader)` + public tRPC `pieces.restore({ address,
  message, signature })`. The wallet signs a fresh, timestamped message
  (`OWNERSHIP_DOMAIN`, 10-min window); the server recovers the signer
  (`recoverMessageAddress`), confirms it matches the claimed address, and returns
  every piece that wallet has unlocked WITH content. Gasless (personal_sign, no
  chain switch). This makes the wallet a portable identity: pay from a browser
  wallet, a terminal/CLI agent (claim flow), or x402 → connect that wallet
  anywhere + one signature → all your content.
- **Web.** `lib/wallet.ts` gains `connectWallet` + `signOwnership`; new
  `lib/owned.ts` is a local unlocked-content cache with pub/sub so a restore
  reveals across all mounted cards instantly. Every unlock path (sponsored,
  wallet-claim, soft) now caches content locally → same-device refresh reveals
  with no network/signature. New `RestorePurchases` card ("🔑 Connect & restore
  purchases") on the storefront + piece page (only renders when an injected wallet
  exists). PieceCard's on-load check now uses ONLY the browser reader id (dropped
  the address→access content fetch that fed the leak).
- Tests **62/62** (+4 restore: valid signature returns owned pieces, unpaid wallet
  gets nothing, wrong signer rejected, stale proof rejected). Typecheck clean; web
  builds clean (6 app routes). Deploy: push (Vercel) + `railway up` (API).

**Mobile-perfect storefront + walletless buy (session 4):**
- **Walletless sponsored unlock.** New `sponsoredUnlock(store, piece, reader)` in
  `services/liveAgent.ts`: the platform relayer pays for the reader. When
  `liveAgentReady()` it settles REAL USDC on Arc (via `payLiveForPiece`, now
  accepting `{ reader }` → grants entitlement + returns content); otherwise it
  falls back to mirror-mode simulated settlement. Either way the reader gets a
  durable entitlement keyed to their browser id and the gated content. Exposed as
  public tRPC `pieces.sponsoredUnlock({ pieceId, reader })` (rejects api pieces —
  those stay pay-per-call). This is the primary buy path on phones (no injected
  wallet). The "💳 pay with your own wallet" button now renders ONLY when an
  injected wallet exists (`hasWallet()`), so it never dead-ends on mobile.
- **Remembering unlocks (the user's question).** Already-existing mechanism,
  reused: a stable per-browser `reader` id in `localStorage` (`splitstream_reader`)
  → server entitlement `(pieceId, reader)` → re-checked on load via `pieces.access`
  → persisted in the D1/sqlite snapshot (survives restarts/redeploys). The
  sponsored flow grants into the same store, so a phone buyer keeps access on
  return visits. Limitation: tied to the device/browser (cleared if localStorage
  is wiped or on a different device). The portable upgrade is wallet-address
  keying (the existing `claimPaid` path remembers by on-chain payer); a future
  email/passkey login would make identity cross-device.
- **Mobile responsiveness.** `layout.tsx` gains a proper `viewport` export
  (device-width, pinch-zoom to 5x, themeColor). Storefront header stacks on mobile
  with full-width nav; `TractionHero` numbers scale down; `PieceCard` buttons are
  full-width with bigger tap targets + a "no wallet needed" hint; `PublishForm`
  revenue-split rows reflow from a 5-col grid into a 2-col card per row on phones;
  `AgentReader` input/button stack; dashboard payout rows reflow from `grid-cols-12`
  to a 2-col card on phones; consistent `px-4 sm:px-6` paddings across all pages.
- Tests **58/58** (+2: sponsored simulated entitlement+content, api rejection).
  Typecheck clean; web builds clean (7 routes). NOT yet deployed — push + redeploy
  Railway API (new tRPC proc) and Vercel web to ship.

**Last updated (prior):** session 3 (production deploy).

**DEPLOYED (session 3):**
- **GitHub:** pushed to `git@github.com:0x-pankaj/splitstream.git` (branch `master`).
  Secrets stay gitignored (`.env`, `.env.live` never committed).
- **API on Railway (LIVE Arc mode):** project `splitstream` / service
  `splitstream-api`. Public URL: **https://splitstream-api-production.up.railway.app**
  (`/health` → `onchainEnabled:true`, chain 5042002). Built from root `Dockerfile`
  (node:22 base + Bun runtime for `bun:sqlite`; pnpm `--frozen-lockfile` install).
  Live env (relayer key, vault, compliance guard, platform fee wallet, demo-agent
  key, OpenRouter key, `LIVE_BRIDGE`/`LIVE_X402=true`) set as Railway variables.
  Smoke-tested: storefront unlock fans out base/arbitrum/solana in 395ms (bundled
  path settles simulated → relayer not drained; real x402 / live-agent paths
  settle on-chain). Deploy config: `Dockerfile`, `railway.json`, `.dockerignore`,
  `.railwayignore`.
- **Frontend (Vercel — user-driven):** root dir `apps/web`, framework Next.js,
  env `NEXT_PUBLIC_API_URL=https://splitstream-api-production.up.railway.app`.
  `next build` verified clean locally (7 routes).
- **Relayer funding note:** real on-chain settlement (x402 / live-agent) draws the
  relayer `0x8984…7154c` Arc USDC (~17 USDC at session 2). Top up via Circle
  faucet for sustained live traction.

**Remote MCP over HTTP (session 3):** the MCP server is now HOSTED on the live
API at `/mcp` (via `@hono/mcp` StreamableHTTPTransport, session-based, bound to
the live store). Any MCP client adds it by URL — no clone, no Bun:
  claude mcp add --transport http splitstream https://splitstream-api-production.up.railway.app/mcp
Verified LIVE: initialize → Mcp-Session-Id → tools/list (8 tools) → tools/call
list_pieces returns the real catalog (incl. a user-published "circle in depth"
piece, persisted via D1). Local stdio kept as a dev alt. Docs + AGENTS.md updated.

**Real human wallet payments (session 3):** makes "you paid" cryptographically
true. `services/walletPayment.ts`: a reader connects an injected wallet, pays the
price in real USDC on Arc to the platform payTo; the server VERIFIES that tx
(`verifyArcUsdcPayment`, tx-hash single-use), grants an entitlement keyed to the
on-chain payer (wallet address — portable/unspoofable), fans the split out to
contributors in real USDC, returns the content. tRPC `pieces.paymentInfo` +
`pieces.claimPaid`; REST `GET /payment-info` + `POST /:id/claim`; env-gated on
LIVE_X402. Web: `lib/wallet.ts` (EIP-1193 + viem; adds Arc chain, pays, waits
receipt) + a "💳 Pay with your wallet · REAL USDC" button + verified receipt;
on-load access check by wallet too. Verified LIVE: payment-info exposes payTo/
usdc/chainId; claim rejects an unverified tx ("payment tx not found on Arc").
All creds written to gitignored `apps/server/.env(.live)` with comments;
`.env.example` documents the new var names. Tests 56/56.

**R2 media uploads (session 3):** sellers can upload a real photo/song. New
`services/r2.ts` uploads via Bun's native S3 client (dynamic import); `POST
/api/v1/pieces/upload` (publisher key, multipart, images/audio, 15MB) stores in
R2 and returns the public URL, which becomes the piece's gated content (revealed
post-payment). Publish form has an upload button + image/audio preview. Env-gated
on `R2_*` (set on Railway; 503 when unset). Verified LIVE: PNG upload → public
`r2.dev` URL serves 200 image/png.

**Open / not-yet-real:** the human "Unlock" still grants an entitlement on click
(soft, browser-id keyed) — it does NOT verify a real user payment; the relayer/
agent moves the money. To make "you paid" real: wallet-connect → user pays USDC →
`verifyArcUsdcPayment` → entitlement keyed to wallet. (Recommended next.) Traction
loop parked per user.

**Cloudflare D1 managed persistence (session 3):** durability now prefers
Cloudflare D1 over the local sqlite/volume. Shared snapshot codec (`snapshot.ts`)
+ `d1Persistence.ts` (D1 HTTP query API, one snapshot row), gated on
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_D1_DATABASE_ID` + `CLOUDFLARE_API_TOKEN`
(set on Railway, never in git); falls back to sqlite if unset/unreachable.
Verified LIVE: server restores from D1 on boot and writes entitlements through to
the D1 snapshot row within the 5s flush. Survives service/volume deletion. (R2
still only needed if a media-upload flow is added.)

**Real on-chain traction + nonce fix proven LIVE (session 3):**
- On-chain ledger records every real Arc settlement (agent payment tx + each
  contributor payout tx) from the ⚡ live-agent button and the live x402 route;
  persisted in the snapshot. `traction.stats` exposes `onchainCreatorPaid`,
  payout count, and `recentOnchain` (with arcscan links). New storefront
  **OnchainTraction** panel headlines verifiable real-USDC settlements under the
  hero, auto-refreshed every 8s.
- **Proven in production:** triggered `pieces.payLive` on the live API →
  writer+editor paid real USDC on Arc (the 2-EVM-payout case that previously
  threw "replacement transaction underpriced" — now clean). Txs: payment
  0x41485bb2…, writer 0xd4231a43…, editor 0xfb868c4a…; Solana leg skipped.
  Panel shows $0.0425 real to creators, 2 on-chain payouts.
- **CLI/agent guide** in `AGENTS.md` (MCP, live x402 + Circle wallet, scripts).
- **Persistence note:** Railway volume confirmed durable across redeploys (the
  earlier paid unlock survived). D1 upgrade pending account-id + API-token from
  user; R2 only needed if media-upload flow is added.

**Entitlements + live-payout fix (session 3):**
- **Pay once, keep access.** A paid unlock with a reader id grants a durable
  entitlement `(pieceId, reader)`. Public `pieces.access` (tRPC) + `GET
  /pieces/:id/access?reader=` return the gated content to an owner WITHOUT
  charging again. Web mints a stable per-browser reader id (`splitstream_reader`
  in localStorage), passes it as `payer`, checks access on load, and reveals
  owned content across refreshes/return visits → button shows "✓ You own this".
  Agents keep paying per call via x402 (they carry no reader id). Verified LIVE:
  pay → re-access returns content free; a different reader gets nothing.
- **Live-payout nonce fix.** `payContributorsOnArc` now serializes relayer sends
  through a mutex and assigns explicit monotonic nonces (fetched once per batch),
  killing the "replacement transaction underpriced" error on the 2nd EVM payout
  (the ⚡ "Agent pays REAL USDC on Arc" button).
- **Durability.** Pieces + entitlements + traction now snapshot to sqlite and the
  sqlite rides a **Railway volume** (`/app/apps/server/data`), surviving redeploys.
- Tests 56/56. (DB note: volume+sqlite chosen over external Postgres; a managed
  `DATABASE_URL` is the upgrade path if multi-instance scaling is needed.)

**Gated content delivery (session 3):** pieces carry a free `preview` (catalog
teaser) + a gated `content` body (markdown/text or media URL). Body is stripped
from every public view (`pieceView`/`serializePiece` expose only `preview` +
`hasContent`) and returned by `payForPiece` ONLY after payment — so an unlock
delivers the real content, not just a receipt. Wired through schema → store →
REST/tRPC/MCP → `/publish` form → post-unlock storefront reveal. Demo article
seeded with a real body. Tests 52/52 (+2: gated pre-pay, revealed post-pay).
Verified LIVE on Railway: catalog hides body, `POST /pay` returns it.

**Done:**
- Phase 0 (fork, git, docs), **Phase 1** (backend split flow).
- **Phase 2 complete** — traction surface: tRPC `pieces.{list,get,unlock}` +
  `traction.stats` (public); web storefront at `/` (catalog, unlock, cross-chain
  fan-out reveal, live creator-payout counter), shareable `/piece/[id]`, dashboard
  at `/dashboard`. Web builds clean (4 routes). Counter verified climbing $0→$0.05.
- **Phase 3 complete** — agentic layer: `readingAgent.ts` (heuristic default +
  optional LLM decision via **OpenRouter**, model `deepseek/deepseek-v4-pro`,
  graceful fallback; budget/caps enforced in code), tRPC `agent.read`, MCP tools
  `list_pieces` + `pay_for_piece`, web `AgentReader` panel. Verified live: with
  `OPENROUTER_API_KEY` set the agent ran in `llm` mode (DeepSeek scored the piece
  0.95) and paid $0.05 to creators.
- **Phase 4 wired + documented** — `scripts/prove-split.ts` (`pnpm --filter
  @arcane/server prove:split`) runs one real unlock through the live engine with
  explorer links; `PHASE4_LIVE_PROOF.md` documents the funded prerequisites. The
  live path is real (submits a real `executeIntent`), not simulated. The funded
  on-chain run (deposit + on-chain whitelist + `LIVE_GATEWAY`) is the user's step.
- **x402 / paid-API surface (post-Phase-4)** — a piece can be `kind: "api"` with
  an upstream `endpoint`; `callPaidService` pays (splitting to owners) then
  proxies one upstream call and returns the response. REST `POST /pieces/:id/call`,
  tRPC `pieces.callApi`, MCP `call_api`. Seed: `piece-fx-api-001` (live FX API).
  **Seller Publish form** at `/publish` (content or API), tRPC `pieces.create`.
  Verified in a real browser (puppeteer): catalog renders both kinds, "Pay &
  call" returned a live upstream result in-page, publish form switches to API
  mode. Verified over HTTP: agent paid $0.01 → owner paid on Base + live FX result.
- **Authenticated-API credential injection** — api pieces gain optional `auth`
  (bearer/header/query); stored server-side, write-only (never serialized),
  injected on the proxy call. Agent gets access, never the key (no-KYC mission).
- **Real x402 challenge-response** (`services/x402.ts`) — `POST /pieces/:id/call`
  speaks HTTP 402: no `X-PAYMENT` → 402 + PaymentRequirements (scheme "exact",
  network "arc-testnet", maxAmountRequired, payTo, asset USDC, single-use nonce);
  with `X-PAYMENT` → verify (anti-replay + `verifyOnChain` live seam), settle
  split, proxy, 200 + `X-PAYMENT-RESPONSE`. Demo: `x402:call` (402→pay→serve→
  replay-blocked). tRPC `pieces.callApi` stays the one-click UI path.
- **Real on-chain x402 settlement on Arc (`LIVE_X402`)** — `services/x402Settle.ts`:
  `verifyArcUsdcPayment` reads the Arc tx receipt and confirms a real USDC
  Transfer to payTo ≥ price (tx-hash single-use anti-replay); `payContributorsOnArc`
  has the relayer transfer each owner real USDC on Arc. payTo (live) = relayer.
  Verified LIVE against Arc RPC (chainId 5042002; nonexistent tx rejected). Mirror
  unchanged. Funded walkthrough: LIVE_X402_RUNBOOK.md. Gap: encrypt secrets at
  rest + cross-chain payout for non-EVM contributors (Solana skipped on Arc path).
- **PROVEN LIVE on Arc Testnet with real USDC** (`scripts/x402-live-loop.ts`):
  autonomous buyer wallet → 402 → real USDC payment → on-chain verify → owner
  paid real USDC; owner balance 0→0.01 on-chain. Tx: fund 0xfe6d4349…, pay
  0xdf1ff4e1…, payout 0x581fa957…. Relayer (0x8984…7154c) held ~17 USDC.
- **Tests: 50/50 green. Typecheck clean across all packages. Web builds clean.**

**Earlier (session 1) detail:**
- `splits.ts` (types + `computeSplit`), schemas, store pieces, `splitEngine.ts`
  (`payForPiece`), `routes/pieces.ts`, demo piece seeded.

**Next session, do this first (Phase 5 — submission polish):**
1. `pnpm install` if needed, then `pnpm typecheck` + `pnpm test` (expect 40/40).
2. Rewrite root `README.md` for SplitStream (story, run steps, live URL, traction).
3. Optional cosmetic: rename `@arcane/*` → `@splitstream/*` (touches every import —
   do LAST). Update `GRANT_PROPOSAL.md` / form answers.
4. Record the 3-min demo: human unlocks → fan-out → agent auto-pays → counter.
5. For real traction: set `ANTHROPIC_API_KEY` so the agent runs in `llm` mode,
   deploy the storefront, share the link, run `prove:split` against a funded vault
   for the on-chain proof (PHASE4_LIVE_PROOF.md).

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
