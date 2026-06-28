/**
 * tRPC context: resolves the store and (optionally) the authenticated tenant
 * from the x-api-key header so dashboard procedures can be tenant-scoped.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { ArcaneError } from "@arcane/shared";
import type { Store, Tenant } from "../db/store.js";
import { authenticate, type AuthContext } from "../auth/apiKeys.js";

export interface TrpcContext {
  store: Store;
  auth: AuthContext | null;
  /** Raw creator session bearer token (x-creator-token); resolved per-procedure. */
  creatorToken: string | null;
}

export function makeContextFactory(store: Store) {
  return (apiKey: string | undefined | null, creatorToken?: string | undefined | null): TrpcContext => {
    let auth: AuthContext | null = null;
    try {
      auth = apiKey ? authenticate(store, apiKey) : null;
    } catch {
      auth = null;
    }
    return { store, auth, creatorToken: creatorToken ?? null };
  };
}

const t = initTRPC.context<TrpcContext>().create({
  /**
   * Surface the stable ArcaneError taxonomy (code + details) into `error.data`
   * so the dashboard can branch on the *kind* of failure — e.g. distinguish a
   * RECIPIENT_NOT_WHITELISTED business rejection from a genuine connectivity
   * outage — instead of string-matching the human message.
   */
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    const arcane = cause instanceof ArcaneError ? cause : undefined;
    return {
      ...shape,
      data: {
        ...shape.data,
        arcaneCode: arcane?.code ?? null,
        arcaneDetails: arcane?.details ?? null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires a valid API key; exposes ctx.tenant to the resolver. */
export const protectedProcedure = t.procedure.use((opts) => {
  if (!opts.ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Valid x-api-key required" });
  }
  return opts.next({
    ctx: { ...opts.ctx, tenant: opts.ctx.auth.tenant as Tenant },
  });
});

/** Map an ArcaneError to a TRPCError for clean client handling. */
export function toTRPCError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof ArcaneError) {
    const code =
      err.status === 401 || err.status === 403
        ? "UNAUTHORIZED"
        : err.status === 404
          ? "NOT_FOUND"
          : err.status === 429
            ? "TOO_MANY_REQUESTS"
            : "BAD_REQUEST";
    return new TRPCError({ code, message: err.message, cause: err });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Internal error",
  });
}
