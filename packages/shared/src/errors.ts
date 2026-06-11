/**
 * Error taxonomy shared across the engine. Each carries a stable `code` so the
 * REST layer, tRPC layer, and MCP tools can map failures to HTTP/tool responses
 * consistently.
 */

export type ArcaneErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "TENANT_NOT_FOUND"
  | "INSUFFICIENT_VAULT_BALANCE"
  | "VELOCITY_LIMIT_EXCEEDED"
  | "RECIPIENT_NOT_WHITELISTED"
  | "AGENT_POLICY_EXCEEDED"
  | "AGENT_DISABLED"
  | "SOLVER_UNAVAILABLE"
  | "FX_QUOTE_FAILED"
  | "SETTLEMENT_FAILED"
  | "DUPLICATE_INTENT"
  | "INTERNAL";

export class ArcaneError extends Error {
  readonly code: ArcaneErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ArcaneErrorCode,
    message: string,
    status = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = "ArcaneError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (msg = "Invalid or missing API key") =>
    new ArcaneError("UNAUTHORIZED", msg, 401),
  tenantNotFound: (tenantId: string) =>
    new ArcaneError("TENANT_NOT_FOUND", `Unknown tenant ${tenantId}`, 404),
  insufficientBalance: (details?: unknown) =>
    new ArcaneError(
      "INSUFFICIENT_VAULT_BALANCE",
      "Tenant vault balance is insufficient for this batch",
      402,
      details,
    ),
  velocityExceeded: (details?: unknown) =>
    new ArcaneError(
      "VELOCITY_LIMIT_EXCEEDED",
      "Batch would breach the tenant's rolling 24h volume limit",
      429,
      details,
    ),
  recipientNotWhitelisted: (recipient: string) =>
    new ArcaneError(
      "RECIPIENT_NOT_WHITELISTED",
      `Recipient ${recipient} is not whitelisted for this tenant`,
      403,
      { recipient },
    ),
  agentPolicyExceeded: (details?: unknown) =>
    new ArcaneError(
      "AGENT_POLICY_EXCEEDED",
      "Payout exceeds the agent wallet's velocity policy",
      429,
      details,
    ),
  agentDisabled: (agentId: string) =>
    new ArcaneError("AGENT_DISABLED", `Agent wallet ${agentId} is disabled`, 403),
  solverUnavailable: (details?: unknown) =>
    new ArcaneError(
      "SOLVER_UNAVAILABLE",
      "No solver has sufficient reserves for the instant path",
      503,
      details,
    ),
  duplicateIntent: (intentId: string) =>
    new ArcaneError("DUPLICATE_INTENT", `Intent ${intentId} already executed`, 409, {
      intentId,
    }),
  internal: (msg = "Internal error", details?: unknown) =>
    new ArcaneError("INTERNAL", msg, 500, details),
} as const;
