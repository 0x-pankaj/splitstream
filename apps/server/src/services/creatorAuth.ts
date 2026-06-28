/**
 * Creator accounts — email + one-time-code login, with a custodial Circle wallet
 * assigned on first login.
 *
 * This is the real-user front door for SplitStream creators: sign in with an
 * email, get a wallet that receives your revenue split, see it climb, withdraw.
 * No password, no seed phrase, no KYC. The OTP is hashed at rest and the wallet
 * comes from the pre-created Circle pool (or a labeled local-dev address with
 * zero keys). A creator also gets an auto-created publisher tenant so they can
 * publish pieces immediately.
 */

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { ArcaneError, errors, parseUsdc6 } from "@arcane/shared";
import type { Creator, Store } from "../db/store.js";
import { sendOtpEmail, type SentOtp } from "./email.js";
import { provisionCreatorWallet } from "./circleWallets.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Mirror-mode publisher balance so the zero-key bundled unlock path can fund. */
const CREATOR_TENANT_BALANCE_6 = parseUsdc6("1000000");
const CREATOR_TENANT_LIMIT_6 = parseUsdc6("500000");

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

/** A cryptographically-random 6-digit code (node:crypto, never Math.random). */
function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Derive a starting handle from a requested handle, display name, or email. */
function deriveHandle(email: string, displayName?: string, requested?: string): string {
  const base = slugify(requested || displayName || email.split("@")[0] || "creator");
  return base.length >= 2 ? base : "creator";
}

/** Make a handle unique by appending a short suffix when taken. */
function uniqueHandle(store: Store, base: string): string {
  if (!store.handleTaken(base)) return base;
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}-${randomBytes(2).toString("hex")}`;
    if (!store.handleTaken(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export interface RequestOtpResult {
  /** Where the code went — "console" in keyless dev, "email" in prod. */
  channel: SentOtp["channel"];
}

/** Issue (or re-issue) a login code for an email. Overwrites any pending code. */
export async function requestCreatorOtp(
  store: Store,
  email: string,
  now: number,
): Promise<RequestOtpResult> {
  const normalized = email.trim().toLowerCase();
  const code = genCode();
  store.putOtpChallenge({
    email: normalized,
    codeHash: hashCode(normalized, code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
  });
  const sent = await sendOtpEmail(normalized, code);
  return { channel: sent.channel };
}

export interface VerifyOtpResult {
  token: string;
  creator: Creator;
  /** True when this login created the account (first-time signup). */
  isNew: boolean;
}

/** Create a brand-new creator: assign a wallet + an auto publisher tenant. */
async function createCreator(
  store: Store,
  input: { email: string; displayName?: string; handle?: string },
  now: number,
): Promise<Creator> {
  const id = randomUUID();
  const handle = uniqueHandle(store, deriveHandle(input.email, input.displayName, input.handle));
  const displayName = (input.displayName ?? "").trim() || handle;

  // Assign a custodial Circle wallet (or a labeled local-dev address with no keys).
  const wallet = await provisionCreatorWallet(store, { creatorId: id, label: handle });

  // Each creator owns a publisher tenant so they can publish immediately. The
  // tenant's on-chain address is the creator's wallet; in mirror mode we credit a
  // simulated balance so the bundled (dev) unlock path can fund.
  const tenant = store.createTenant({
    name: `${displayName} (creator)`,
    onchainAddress: wallet.address as `0x${string}`,
  });
  store.setDailyLimit(tenant.id, CREATOR_TENANT_LIMIT_6);
  store.creditBalance(tenant.id, CREATOR_TENANT_BALANCE_6);

  const creator: Creator = {
    id,
    email: input.email.trim().toLowerCase(),
    handle,
    displayName,
    tenantId: tenant.id,
    walletId: wallet.walletId,
    walletAddress: wallet.address,
    walletProvider: wallet.provider,
    createdAt: new Date(now).toISOString(),
  };
  store.upsertCreator(creator);
  return creator;
}

/** Verify a one-time code; create the account on first login; mint a session. */
export async function verifyCreatorOtp(
  store: Store,
  input: { email: string; code: string; displayName?: string; handle?: string },
  now: number,
): Promise<VerifyOtpResult> {
  const email = input.email.trim().toLowerCase();
  const ch = store.getOtpChallenge(email);
  if (!ch) throw new ArcaneError("VALIDATION_FAILED", "Request a login code first", 400);
  if (now >= ch.expiresAt) {
    store.deleteOtpChallenge(email);
    throw new ArcaneError("VALIDATION_FAILED", "That code expired — request a new one", 400);
  }
  if (ch.attempts >= OTP_MAX_ATTEMPTS) {
    store.deleteOtpChallenge(email);
    throw new ArcaneError("VELOCITY_LIMIT_EXCEEDED", "Too many attempts — request a new code", 429);
  }
  if (hashCode(email, input.code) !== ch.codeHash) {
    ch.attempts += 1;
    throw new ArcaneError("VALIDATION_FAILED", "That code is incorrect", 400);
  }
  store.deleteOtpChallenge(email);

  let creator = store.creatorByEmail(email);
  let isNew = false;
  if (!creator) {
    if (input.handle && store.handleTaken(input.handle)) {
      throw new ArcaneError("VALIDATION_FAILED", "That handle is already taken", 409);
    }
    creator = await createCreator(store, { email, displayName: input.displayName, handle: input.handle }, now);
    isNew = true;
  }

  const token = `ses_${randomBytes(24).toString("hex")}`;
  store.putCreatorSession({ token, creatorId: creator.id, expiresAt: now + SESSION_TTL_MS });
  return { token, creator, isNew };
}

/** Resolve a session bearer token to its creator, or throw unauthorized. */
export function authenticateCreator(store: Store, token: string | undefined | null, now: number): Creator {
  if (!token) throw errors.unauthorized("Creator login required");
  const creator = store.creatorForSession(token, now);
  if (!creator) throw errors.unauthorized("Session expired — please log in again");
  return creator;
}
