/**
 * Vanilla tRPC client for the dashboard, fully typed against the backend's
 * AppRouter. The active API key is resolved per-request from localStorage so a
 * freshly signed-up tenant can use their own key without a page reload; it falls
 * back to the demo key so the console is always usable out of the box.
 */

import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@arcane/server/trpc";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const DEMO_API_KEY = "arc_test_sk_demo_0001";

const STORAGE_KEY = "arcane_api_key";
let cachedKey: string | null = null;

/** The API key sent on every request (custom tenant key, else the demo key). */
export function getApiKey(): string {
  if (cachedKey) return cachedKey;
  if (typeof window !== "undefined") {
    cachedKey = window.localStorage.getItem(STORAGE_KEY) ?? DEMO_API_KEY;
  } else {
    cachedKey = DEMO_API_KEY;
  }
  return cachedKey;
}

/** Persist and activate a tenant's API key (after signup or manual entry). */
export function setApiKey(key: string): void {
  cachedKey = key;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, key);
}

/** Clear the stored key and fall back to the demo key. */
export function clearApiKey(): void {
  cachedKey = null;
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

/** True when a non-demo tenant key is active. */
export function isCustomKey(): boolean {
  return getApiKey() !== DEMO_API_KEY;
}

const READER_KEY = "splitstream_reader";
let cachedReader: string | null = null;

/**
 * A stable, anonymous per-browser reader id. Used as the `payer` on an unlock so
 * the server can grant this reader durable access to the piece — that's what lets
 * a human "pay once, keep reading" across refreshes and return visits, with no
 * signup. (AI agents pay per call via x402 and never carry one of these.)
 */
export function getReaderId(): string {
  if (cachedReader) return cachedReader;
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(READER_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `reader_${crypto.randomUUID()}`
        : `reader_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(READER_KEY, id);
  }
  cachedReader = id;
  return id;
}

const CREATOR_TOKEN_KEY = "splitstream_creator_token";
let cachedCreatorToken: string | null = null;

/** The logged-in creator's session bearer token, if any. */
export function getCreatorToken(): string | null {
  if (cachedCreatorToken) return cachedCreatorToken;
  if (typeof window === "undefined") return null;
  cachedCreatorToken = window.localStorage.getItem(CREATOR_TOKEN_KEY);
  return cachedCreatorToken;
}

/** Persist + activate a creator session token (after email-OTP login). */
export function setCreatorToken(token: string): void {
  cachedCreatorToken = token;
  if (typeof window !== "undefined") window.localStorage.setItem(CREATOR_TOKEN_KEY, token);
}

/** Log the creator out (clear the session token). */
export function clearCreatorToken(): void {
  cachedCreatorToken = null;
  if (typeof window !== "undefined") window.localStorage.removeItem(CREATOR_TOKEN_KEY);
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      headers: () => {
        const headers: Record<string, string> = { "x-api-key": getApiKey() };
        const creatorToken = getCreatorToken();
        if (creatorToken) headers["x-creator-token"] = creatorToken;
        return headers;
      },
    }),
  ],
});

/** Structured view of an error from a tRPC call, for actionable UI handling. */
export interface ErrorInfo {
  message: string;
  /** Stable ArcaneError code (e.g. "RECIPIENT_NOT_WHITELISTED"), if any. */
  arcaneCode: string | null;
  /** True when the request never reached the server (server down / network). */
  isConnectivity: boolean;
}

/**
 * Normalize any thrown value into an `ErrorInfo`. Distinguishes a real
 * connectivity failure (no HTTP response at all) from a business-rule rejection
 * the server deliberately returned — so the UI only nags about "is the API
 * running?" when the API genuinely can't be reached.
 */
export function errorInfo(e: unknown): ErrorInfo {
  if (e instanceof TRPCClientError) {
    const data = e.data as { arcaneCode?: string | null; httpStatus?: number } | undefined;
    // A TRPCClientError with no `data` means we got no structured HTTP response
    // back — i.e. the fetch itself failed (server unreachable / CORS / network).
    const isConnectivity = data == null;
    return {
      message: e.message || "Request failed",
      arcaneCode: data?.arcaneCode ?? null,
      isConnectivity,
    };
  }
  if (e instanceof Error) {
    const isConnectivity = /failed to fetch|networkerror|load failed/i.test(e.message);
    return { message: e.message, arcaneCode: null, isConnectivity };
  }
  return { message: "Unknown error", arcaneCode: null, isConnectivity: false };
}
