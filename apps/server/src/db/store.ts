/**
 * In-memory data store — the engine's source of truth for tenants, API keys,
 * agent wallets, solvers, intents, and the immutable audit log.
 *
 * It is kept storage-agnostic on purpose: Vitest exercises it directly under
 * Node, while the live server snapshots it to bun:sqlite (see persistence.ts).
 * All monetary fields are 6-decimal USDC base units (bigint).
 */

import { randomBytes, randomUUID } from "node:crypto";
import type {
  AgentWallet,
  AuditEntry,
  Contributor,
  Piece,
  PieceAuth,
  PieceKind,
  RoutedPayout,
  Solver,
  TargetChain,
} from "@arcane/shared";

export interface Tenant {
  id: string;
  name: string;
  /** On-chain address that funds the vault and is keyed in tenantBalances. */
  onchainAddress: `0x${string}`;
  createdAt: string;
}

export interface ApiKey {
  key: string;
  tenantId: string;
  label: string;
  scopes: Set<string>;
}

/** A vetted payee on a tenant's allowlist, with display metadata. */
export interface RecipientRecord {
  /** keccak256(address) — the chain-agnostic allowlist key. */
  recipientKey: string;
  address: string;
  targetChain: TargetChain;
  label?: string;
  addedAt: string;
}

/** Local mirror of compliance state, used when on-chain calls are disabled. */
interface VelocityState {
  windowStart: number; // epoch ms
  volume6: bigint;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** One real, on-chain settlement on Arc — the verifiable traction we headline. */
export interface OnchainSettlement {
  pieceId: string;
  title: string;
  kind: PieceKind;
  /** Price paid for this unlock/call, 6dp. */
  price6: bigint;
  /** The payer (agent/wallet address) that signed the on-chain payment. */
  payer: string;
  /** The real USDC payment tx hash on Arc. */
  paymentTx: string;
  /** Each contributor actually paid on Arc (skipped non-EVM legs are omitted). */
  payouts: Array<{ role: string; address: string; share6: bigint; txHash: string }>;
  /** ISO timestamp (passed in by the caller — never Date.now() at import). */
  at: string;
}

/** A single-use x402 payment challenge issued for one paid API call. */
export interface X402Challenge {
  nonce: string;
  pieceId: string;
  amount6: bigint;
  payTo: string;
  /** epoch ms after which the challenge is no longer valid. */
  expiresAt: number;
  consumed: boolean;
}

export class Store {
  tenants = new Map<string, Tenant>();
  apiKeys = new Map<string, ApiKey>();
  agentWallets = new Map<string, AgentWallet>();
  solvers: Solver[] = [];
  audit: AuditEntry[] = [];
  intents = new Map<string, RoutedPayout & { status: string }>();

  /** SplitStream: monetizable content pieces, keyed by piece id. */
  pieces = new Map<string, Piece>();

  /**
   * Entitlements — who has already paid to unlock which piece, so a returning
   * reader keeps access without paying again. Keyed `${pieceId}::${reader}`
   * (reader = a wallet address or a stable per-browser id, lowercased). This is
   * what makes the human side "pay once, read forever"; agents paying per call
   * (x402) simply never present a reader id and so are charged each time.
   */
  entitlements = new Set<string>();

  /**
   * Distinct buyers — every reader/agent that has paid for at least one unlock or
   * call, across all flows (sponsored, own-wallet, soft, agent, x402). Powers the
   * "buyers" traction number (demand for creators), counted unique. A buyer is a
   * browser reader id, a wallet address, or an agent id — lowercased so the same
   * wallet across flows counts once.
   */
  buyers = new Set<string>();

  /**
   * Unique visitors (any reader id that opened the storefront) and the subset who
   * became REAL buyers (an unlock that settled real USDC on Arc — never a
   * simulated one). Together they give the RFB-06 "reader-to-payer conversion"
   * metric, and `realBuyers` powers the real-only "Buyers" headline. `realBuyers`
   * is always a subset of `visitors`.
   */
  visitors = new Set<string>();
  realBuyers = new Set<string>();

  /**
   * Recovery codes for no-wallet buyers: a short, shareable code → the reader id
   * that owns some purchases. Redeeming copies that reader's entitlements onto the
   * redeeming device's id, so an anonymous buyer can restore their library on a
   * new device without a wallet or signup. The code is a bearer token (whoever
   * holds it can claim the purchases) — fine for low-value pay-per-piece content.
   */
  recoveryCodes = new Map<string, string>();

  /**
   * REAL on-chain settlements on Arc (the live-agent button + live x402 path):
   * the verifiable, "nothing simulated" traction we headline for judges. Each
   * entry carries the agent's payment tx and every contributor payout tx, so the
   * site can link straight to the Arc explorer. Newest appended last.
   */
  onchainSettlements: OnchainSettlement[] = [];

  /** x402 single-use payment challenges, keyed by nonce (anti-replay). */
  x402Challenges = new Map<string, X402Challenge>();
  /** On-chain payment tx hashes already redeemed (anti-replay for live x402). */
  x402SettledTxHashes = new Set<string>();

  /** Simulated per-tenant vault balances (used when on-chain is disabled). */
  tenantBalances6 = new Map<string, bigint>();
  /** Per-tenant rolling 24h volume cap (6dp). */
  dailyVolumeLimit6 = new Map<string, bigint>();
  /** Per-tenant recipient allowlist, keyed by recipientKey (keccak hex). */
  recipientWhitelist = new Map<string, Set<string>>();
  /** Per-tenant payee records (display metadata), keyed by recipientKey. */
  recipients = new Map<string, Map<string, RecipientRecord>>();
  /** Simulated velocity windows. */
  private velocity = new Map<string, VelocityState>();

  // ── Tenants & keys ────────────────────────────────────────────────────────

  upsertTenant(t: Tenant): void {
    this.tenants.set(t.id, t);
  }

  /** Create and register a brand-new tenant (self-serve onboarding). */
  createTenant(input: { name: string; onchainAddress: `0x${string}` }): Tenant {
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      onchainAddress: input.onchainAddress,
      createdAt: new Date().toISOString(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  addApiKey(k: ApiKey): void {
    this.apiKeys.set(k.key, k);
  }

  /** Mint a fresh scoped API key for a tenant and store it. */
  issueApiKey(
    tenantId: string,
    label: string,
    scopes: string[],
    live = false,
  ): ApiKey {
    const key = `arc_${live ? "live" : "test"}_sk_${randomBytes(18).toString("hex")}`;
    const apiKey: ApiKey = { key, tenantId, label, scopes: new Set(scopes) };
    this.apiKeys.set(key, apiKey);
    return apiKey;
  }

  tenantForApiKey(key: string): { tenant: Tenant; apiKey: ApiKey } | undefined {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return undefined;
    const tenant = this.tenants.get(apiKey.tenantId);
    if (!tenant) return undefined;
    return { tenant, apiKey };
  }

  /** First tenant whose on-chain address matches (one wallet ⇒ one account). */
  tenantByOnchainAddress(address: string): Tenant | undefined {
    const wanted = address.toLowerCase();
    for (const t of this.tenants.values()) {
      if (t.onchainAddress.toLowerCase() === wanted) return t;
    }
    return undefined;
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  creditBalance(tenantId: string, amount6: bigint): void {
    this.tenantBalances6.set(tenantId, this.balanceOf(tenantId) + amount6);
  }

  debitBalance(tenantId: string, amount6: bigint): void {
    this.tenantBalances6.set(tenantId, this.balanceOf(tenantId) - amount6);
  }

  balanceOf(tenantId: string): bigint {
    return this.tenantBalances6.get(tenantId) ?? 0n;
  }

  // ── Compliance mirror ───────────────────────────────────────────────────────

  setDailyLimit(tenantId: string, limit6: bigint): void {
    this.dailyVolumeLimit6.set(tenantId, limit6);
  }

  whitelistRecipient(tenantId: string, recipientKey: string): void {
    let set = this.recipientWhitelist.get(tenantId);
    if (!set) {
      set = new Set();
      this.recipientWhitelist.set(tenantId, set);
    }
    set.add(recipientKey);
  }

  isRecipientWhitelisted(tenantId: string, recipientKey: string): boolean {
    return this.recipientWhitelist.get(tenantId)?.has(recipientKey) ?? false;
  }

  /** Add (or update) a payee record and allowlist it. Idempotent by key. */
  addRecipient(
    tenantId: string,
    rec: Omit<RecipientRecord, "addedAt"> & { addedAt?: string },
  ): RecipientRecord {
    const record: RecipientRecord = {
      recipientKey: rec.recipientKey,
      address: rec.address,
      targetChain: rec.targetChain,
      label: rec.label,
      addedAt: rec.addedAt ?? new Date().toISOString(),
    };
    let byKey = this.recipients.get(tenantId);
    if (!byKey) {
      byKey = new Map();
      this.recipients.set(tenantId, byKey);
    }
    byKey.set(record.recipientKey, record);
    this.whitelistRecipient(tenantId, record.recipientKey);
    return record;
  }

  /** Remove a payee from the allowlist. Returns true if it existed. */
  removeRecipient(tenantId: string, recipientKey: string): boolean {
    const existed = this.recipients.get(tenantId)?.delete(recipientKey) ?? false;
    this.recipientWhitelist.get(tenantId)?.delete(recipientKey);
    return existed;
  }

  /** List a tenant's payees, newest first. */
  listRecipients(tenantId: string): RecipientRecord[] {
    return [...(this.recipients.get(tenantId)?.values() ?? [])].sort((a, b) =>
      a.addedAt < b.addedAt ? 1 : -1,
    );
  }

  /** Current rolling-window volume, treating an expired window as zero. */
  currentVolume6(tenantId: string, now: number): bigint {
    const v = this.velocity.get(tenantId);
    if (!v) return 0n;
    if (now - v.windowStart >= WINDOW_MS) return 0n;
    return v.volume6;
  }

  /** Record volume against the rolling window (mirrors the on-chain guard). */
  recordVolume6(tenantId: string, amount6: bigint, now: number): void {
    const v = this.velocity.get(tenantId);
    if (!v || now - v.windowStart >= WINDOW_MS) {
      this.velocity.set(tenantId, { windowStart: now, volume6: amount6 });
    } else {
      v.volume6 += amount6;
    }
  }

  // ── Agent wallets ───────────────────────────────────────────────────────────

  upsertAgent(a: AgentWallet): void {
    this.agentWallets.set(a.agentId, a);
  }

  agent(agentId: string): AgentWallet | undefined {
    return this.agentWallets.get(agentId);
  }

  agentsForTenant(tenantId: string): AgentWallet[] {
    return [...this.agentWallets.values()].filter((a) => a.tenantId === tenantId);
  }

  // ── Solvers ──────────────────────────────────────────────────────────────────

  solversForChain(chain: TargetChain): Solver[] {
    return this.solvers.filter((s) => s.online && s.supportedChains.includes(chain));
  }

  // ── Pieces (SplitStream) ─────────────────────────────────────────────────────

  /** Register a new piece. Accepts an explicit id (for deterministic seeds). */
  createPiece(input: {
    id?: string;
    publisherTenantId: string;
    title: string;
    kind: PieceKind;
    price6: bigint;
    contributors: Contributor[];
    endpoint?: string;
    httpMethod?: "GET" | "POST";
    auth?: PieceAuth;
    preview?: string;
    content?: string;
    createdAt?: string;
  }): Piece {
    const piece: Piece = {
      id: input.id ?? randomUUID(),
      publisherTenantId: input.publisherTenantId,
      title: input.title,
      kind: input.kind,
      price6: input.price6,
      contributors: input.contributors,
      endpoint: input.endpoint,
      httpMethod: input.httpMethod,
      auth: input.auth,
      preview: input.preview,
      content: input.content,
      createdAt: input.createdAt ?? new Date().toISOString(),
      unlocks: 0,
      totalPaid6: 0n,
    };
    this.pieces.set(piece.id, piece);
    return piece;
  }

  getPiece(id: string): Piece | undefined {
    return this.pieces.get(id);
  }

  /**
   * Replace a piece's contributors in place (admin), preserving its unlocks /
   * totalPaid stats. Used to swap demo placeholder addresses for real creator
   * wallets without resetting the piece. The change persists via the next
   * snapshot flush.
   */
  setPieceContributors(id: string, contributors: Contributor[]): Piece {
    const piece = this.pieces.get(id);
    if (!piece) throw new Error(`No such piece: ${id}`);
    piece.contributors = contributors;
    return piece;
  }

  /** All pieces, newest first; optionally scoped to one publisher tenant. */
  listPieces(publisherTenantId?: string): Piece[] {
    const all = [...this.pieces.values()];
    const scoped = publisherTenantId
      ? all.filter((p) => p.publisherTenantId === publisherTenantId)
      : all;
    return scoped.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Record a paid unlock against a piece's running traction stats. */
  recordUnlock(pieceId: string, price6: bigint): void {
    const piece = this.pieces.get(pieceId);
    if (!piece) return;
    piece.unlocks += 1;
    piece.totalPaid6 += price6;
  }

  /** Normalize an entitlement key so addresses match case-insensitively. */
  private entitlementKey(pieceId: string, reader: string): string {
    return `${pieceId}::${reader.trim().toLowerCase()}`;
  }

  /** Grant a reader durable access to a piece (called after a successful unlock). */
  grantEntitlement(pieceId: string, reader: string): void {
    if (!reader.trim()) return;
    this.entitlements.add(this.entitlementKey(pieceId, reader));
  }

  /** Record a distinct buyer (reader id, wallet, or agent id) for the traction count. */
  recordBuyer(buyer: string | null | undefined): void {
    const id = buyer?.trim().toLowerCase();
    if (id) this.buyers.add(id);
  }

  /** Record a unique storefront visitor (the conversion denominator). */
  recordVisitor(visitor: string | null | undefined): void {
    const id = visitor?.trim().toLowerCase();
    if (id) this.visitors.add(id);
  }

  /**
   * Record a buyer whose unlock settled REAL USDC on Arc. Also counts them as a
   * visitor so real buyers are always a subset of visitors (conversion ≤ 100%).
   */
  recordRealBuyer(buyer: string | null | undefined): void {
    const id = buyer?.trim().toLowerCase();
    if (id) {
      this.realBuyers.add(id);
      this.visitors.add(id);
    }
  }

  /** Map a recovery code to the reader id that issued it. */
  createRecoveryCode(code: string, reader: string): void {
    if (code.trim() && reader.trim()) this.recoveryCodes.set(code, reader.trim());
  }

  /** The reader id behind a recovery code, if it exists. */
  readerForRecoveryCode(code: string): string | undefined {
    return this.recoveryCodes.get(code);
  }

  /** True when this reader has already paid to unlock this piece. */
  hasEntitlement(pieceId: string, reader: string): boolean {
    if (!reader.trim()) return false;
    return this.entitlements.has(this.entitlementKey(pieceId, reader));
  }

  /**
   * Every piece id this reader has unlocked. Powers "restore purchases" — a
   * wallet (or browser id) proves who it is and gets back all its content.
   * Reader is normalized the same way entitlements are stored (lowercased).
   */
  entitledPieceIdsFor(reader: string): string[] {
    const norm = reader.trim().toLowerCase();
    if (!norm) return [];
    const suffix = `::${norm}`;
    const ids: string[] = [];
    for (const key of this.entitlements) {
      if (key.endsWith(suffix)) ids.push(key.slice(0, -suffix.length));
    }
    return ids;
  }

  /** Append a real on-chain settlement (bounded so memory/snapshot stay small). */
  recordOnchainSettlement(s: OnchainSettlement): void {
    this.onchainSettlements.push(s);
    if (this.onchainSettlements.length > 500) this.onchainSettlements.shift();
  }

  /** Real on-chain settlements, newest first. */
  /**
   * Admin cleanup: drop every on-chain payout to the given addresses from the
   * settlement ledger (e.g. removing demo placeholder creators). Settlements left
   * with no payouts are removed entirely. The change persists on the next
   * snapshot flush. Returns how much was removed.
   */
  purgeOnchainPayouts(addresses: string[]): { settlementsRemoved: number; payoutsRemoved: number } {
    const block = new Set(addresses.map((a) => a.toLowerCase()));
    let payoutsRemoved = 0;
    const kept: OnchainSettlement[] = [];
    for (const s of this.onchainSettlements) {
      const before = s.payouts.length;
      s.payouts = s.payouts.filter((p) => !block.has(p.address.toLowerCase()));
      payoutsRemoved += before - s.payouts.length;
      if (s.payouts.length > 0) kept.push(s);
    }
    const settlementsRemoved = this.onchainSettlements.length - kept.length;
    this.onchainSettlements = kept;
    return { settlementsRemoved, payoutsRemoved };
  }

  listOnchainSettlements(limit = 10): OnchainSettlement[] {
    return [...this.onchainSettlements].reverse().slice(0, limit);
  }

  /** Total real USDC actually paid to contributors on Arc (6dp). */
  onchainPaidTotal6(): bigint {
    let sum = 0n;
    for (const s of this.onchainSettlements)
      for (const p of s.payouts) sum += p.share6;
    return sum;
  }

  // ── x402 payment challenges ──────────────────────────────────────────────────

  /** Register a freshly-issued x402 challenge so its nonce can be redeemed once. */
  putX402Challenge(c: X402Challenge): void {
    this.x402Challenges.set(c.nonce, c);
  }

  /**
   * Atomically redeem a challenge by nonce: returns it only if it exists, is
   * unexpired, and is unconsumed — and marks it consumed so it can never be
   * replayed. Returns a reason string on failure.
   */
  redeemX402Challenge(
    nonce: string,
    now: number,
  ): { ok: true; challenge: X402Challenge } | { ok: false; reason: string } {
    const c = this.x402Challenges.get(nonce);
    if (!c) return { ok: false, reason: "unknown or expired payment nonce" };
    if (c.consumed) return { ok: false, reason: "payment nonce already used" };
    if (now >= c.expiresAt) return { ok: false, reason: "payment challenge expired" };
    c.consumed = true;
    return { ok: true, challenge: c };
  }

  /** Mark an on-chain payment tx as redeemed; false if it was already used. */
  redeemTxHash(txHash: string): boolean {
    const key = txHash.toLowerCase();
    if (this.x402SettledTxHashes.has(key)) return false;
    this.x402SettledTxHashes.add(key);
    return true;
  }

  // ── Audit log ────────────────────────────────────────────────────────────────

  appendAudit(entry: AuditEntry): void {
    this.audit.push(entry);
  }

  auditForTenant(tenantId: string): AuditEntry[] {
    return this.audit
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}

/** Process-wide singleton used by the running server. Tests create their own. */
export const store = new Store();
