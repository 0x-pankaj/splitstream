/**
 * ArcaneClient — a thin, typed wrapper over the Arcane Treasury REST API.
 *
 * Every method maps to one HTTP call, sends the scoped `x-api-key`, and throws a
 * structured {@link ArcaneApiError} (with the API's stable error `code`) on any
 * non-2xx response. The client has zero runtime dependencies — it uses the
 * platform `fetch` — so it runs in Node ≥ 18, Bun, Deno, edge runtimes, and the
 * browser.
 *
 * @example
 * ```ts
 * const arcane = new ArcaneClient({ apiKey: process.env.ARCANE_API_KEY! });
 * await arcane.recipients.add({ address: "0x1111…", targetChain: "base" });
 * const batch = await arcane.payouts.create({
 *   idempotencyKey: "payroll-2026-06",
 *   payouts: [{ recipientAddress: "0x1111…", targetChain: "base", amountUSDC: "250" }],
 * });
 * console.log(batch.results[0].destinationTxHash);
 * ```
 */

import type {
  Account,
  ArcaneClientOptions,
  BulkPayoutResult,
  CreatePayoutOptions,
  DepositInfo,
  Recipient,
  RecipientInput,
  SignupOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:8787";

/** A structured error mirroring the API's `{ code, message, details }` body. */
export class ArcaneApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ArcaneApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ArcaneClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private tenantId: string | undefined;

  constructor(options: ArcaneClientOptions) {
    if (!options.apiKey) throw new Error("ArcaneClient requires an apiKey");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.tenantId = options.tenantId;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error("No fetch implementation found; pass one via options.fetch");
    }
    this.fetchImpl = f;
  }

  /**
   * Open a corporate treasury account (no API key required). Returns the new
   * tenant and its one-time API key; use it to construct an ArcaneClient.
   */
  static async signup(options: SignupOptions): Promise<Account> {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const f = options.fetch ?? globalThis.fetch;
    const res = await f(`${baseUrl}/api/v1/tenants/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: options.name, onchainAddress: options.onchainAddress }),
    });
    return unwrap<Account>(res);
  }

  /** Return the tenant this key belongs to (cached). */
  async me(): Promise<Account> {
    const acct = await this.request<Account>("GET", "/api/v1/tenants/me");
    this.tenantId = acct.tenantId;
    return acct;
  }

  // ── Payees ──────────────────────────────────────────────────────────────────
  readonly recipients = {
    list: (): Promise<Recipient[]> =>
      this.request<{ recipients: Recipient[] }>("GET", "/api/v1/recipients").then(
        (r) => r.recipients,
      ),

    add: (input: RecipientInput): Promise<Recipient> =>
      this.request<{ recipient: Recipient }>("POST", "/api/v1/recipients", input).then(
        (r) => r.recipient,
      ),

    remove: (recipientKey: string): Promise<{ removed: boolean }> =>
      this.request<{ removed: boolean }>(
        "DELETE",
        `/api/v1/recipients/${encodeURIComponent(recipientKey)}`,
      ),
  };

  // ── Treasury ────────────────────────────────────────────────────────────────
  readonly treasury = {
    depositInfo: (): Promise<DepositInfo> =>
      this.request<DepositInfo>("GET", "/api/v1/treasury/deposit-info"),
  };

  // ── Payouts ─────────────────────────────────────────────────────────────────
  readonly payouts = {
    /** Submit a bulk cross-chain payout. Resolves the tenant id automatically. */
    create: async (options: CreatePayoutOptions): Promise<BulkPayoutResult> => {
      const tenantId = options.tenantId ?? this.tenantId ?? (await this.me()).tenantId;
      return this.request<BulkPayoutResult>("POST", "/api/v1/payouts/bulk", {
        tenantId,
        idempotencyKey: options.idempotencyKey,
        agentId: options.agentId,
        payouts: options.payouts,
      });
    },
  };

  /** Low-level request helper. Sends the API key and unwraps the JSON envelope. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return unwrap<T>(res);
  }
}

/** Parse a response, throwing ArcaneApiError on failure, stripping the `ok` flag. */
async function unwrap<T>(res: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) {
    const e = (json ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ArcaneApiError(
      e.code ?? "HTTP_ERROR",
      e.message ?? `Request failed with status ${res.status}`,
      res.status,
      e.details,
    );
  }
  // Responses are wrapped as `{ ok: true, ...payload }`; drop the flag.
  if (json && typeof json === "object" && "ok" in (json as Record<string, unknown>)) {
    const { ok: _ok, ...rest } = json as Record<string, unknown>;
    void _ok;
    return rest as T;
  }
  return json as T;
}
