/**
 * A small in-memory, per-IP fixed-window rate limiter (Hono middleware).
 *
 * Enough to blunt abusive bursts (OTP/email spam, signup floods, payment hammering)
 * on a single instance without an external store. Keyed by client IP + a bucket
 * name so different route classes get independent budgets. Best-effort: it caps
 * its own memory and never throws.
 */

import type { Context, Next } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per IP per window. */
  max: number;
  /** Bucket name so route classes don't share a budget. */
  name?: string;
}

/** Best-effort client IP from common proxy headers (Railway/Vercel set these). */
function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip") ?? "anon";
}

export function rateLimit(opts: RateLimitOptions) {
  const hits = new Map<string, Bucket>();
  return async (c: Context, next: Next) => {
    const now = Date.now();
    const key = `${opts.name ?? "g"}:${clientIp(c)}`;
    let b = hits.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, b);
    }
    b.count += 1;

    // Opportunistic prune so the map can't grow unbounded.
    if (hits.size > 20_000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }

    if (b.count > opts.max) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      return c.json({ code: "RATE_LIMITED", message: "Too many requests — please slow down." }, 429);
    }
    return next();
  };
}
