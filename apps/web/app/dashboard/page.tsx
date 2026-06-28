"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { trpc, getApiKey, setApiKey, clearApiKey, isCustomKey, DEMO_API_KEY, errorInfo, type ErrorInfo } from "../../lib/trpc";
import { Stat, PathBadge, ChainBadge, ModeBadge, TxLink, Section, CopyField, Pill } from "../../components/ui";
import {
  CHAINS,
  type Chain,
  type PayoutRow,
  type PayeeRow,
  normalizeAddress,
  isAddressValidForChain,
  parsePayoutCsv,
  parsePayeeCsv,
  PAYOUT_CSV_TEMPLATE,
  PAYEE_CSV_TEMPLATE,
  downloadText,
  type ParseResult,
} from "../../lib/csv";

type Overview = Awaited<ReturnType<typeof trpc.treasury.overview.query>>;
type Audit = Awaited<ReturnType<typeof trpc.audit.list.query>>;
type Solvers = Awaited<ReturnType<typeof trpc.solvers.list.query>>;
type Agents = Awaited<ReturnType<typeof trpc.agents.list.query>>;
type Preview = Awaited<ReturnType<typeof trpc.routing.preview.query>>;
type Recipients = Awaited<ReturnType<typeof trpc.recipients.list.query>>;
type DepositInfo = Awaited<ReturnType<typeof trpc.treasury.depositInfo.query>>;
type Me = Awaited<ReturnType<typeof trpc.me.query>>;

type Row = PayoutRow;

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
const isAmountValid = (a: string) => AMOUNT_RE.test(a) && Number(a) > 0;
const isRowValid = (r: Row) =>
  isAddressValidForChain(r.recipientAddress, r.targetChain) && isAmountValid(r.amountUSDC);

const SAMPLE_BATCH: Row[] = [
  { recipientAddress: "0x1111111111111111111111111111111111111111", targetChain: "base", amountUSDC: "250", currencyCode: "USD" },
  { recipientAddress: "0x2222222222222222222222222222222222222222", targetChain: "arbitrum", amountUSDC: "1200", currencyCode: "USD" },
  { recipientAddress: "0x3333333333333333333333333333333333333333", targetChain: "ethereum", amountUSDC: "60000", currencyCode: "USD" },
];

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Audit>([]);
  const [solvers, setSolvers] = useState<Solvers>([]);
  const [agents, setAgents] = useState<Agents>([]);
  const [recipients, setRecipients] = useState<Recipients>([]);
  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [connected, setConnected] = useState(false);

  const [rows, setRows] = useState<Row[]>(SAMPLE_BATCH);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [whitelisting, setWhitelisting] = useState(false);
  const [useAgent, setUseAgent] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState<string>("");

  const report = useCallback((e: unknown) => setError(errorInfo(e)), []);

  const refresh = useCallback(async () => {
    try {
      const [o, a, s, ag, r, d, m] = await Promise.all([
        trpc.treasury.overview.query(),
        trpc.audit.list.query({ limit: 100 }),
        trpc.solvers.list.query(),
        trpc.agents.list.query(),
        trpc.recipients.list.query(),
        trpc.treasury.depositInfo.query(),
        trpc.me.query(),
      ]);
      setOverview(o);
      setAudit(a);
      setSolvers(s);
      setAgents(ag);
      setRecipients(r);
      setDeposit(d);
      setMe(m);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      report(e);
    }
  }, [report]);

  useEffect(() => {
    setKeyLabel(getApiKey());
    void refresh();
  }, [refresh]);

  // Preview only the rows that are client-side valid, so a half-typed address
  // never triggers a server validation error that flashes in the banner.
  const validRows = useMemo(() => rows.filter(isRowValid), [rows]);

  const runPreview = useCallback(async () => {
    if (validRows.length === 0) {
      setPreview(null);
      return;
    }
    try {
      setPreview(await trpc.routing.preview.query({ payouts: validRows }));
    } catch (e) {
      report(e);
    }
  }, [validRows, report]);

  useEffect(() => {
    void runPreview();
  }, [runPreview]);

  // Which batch recipients are NOT yet vetted payees (would be rejected by the
  // on-chain compliance allowlist). Compared on the canonical address form so
  // case differences never produce a false "unvetted".
  const vetted = useMemo(
    () => new Set(recipients.map((r) => normalizeAddress(r.address, r.targetChain as Chain))),
    [recipients],
  );
  const isVetted = useCallback(
    (r: Row) => vetted.has(normalizeAddress(r.recipientAddress, r.targetChain)),
    [vetted],
  );

  /** Unique, valid-but-unvetted recipients across the batch (one per address). */
  const unvetted = useMemo(() => {
    const seen = new Set<string>();
    const out: { address: string; targetChain: Chain }[] = [];
    for (const r of rows) {
      if (!isRowValid(r) || isVetted(r)) continue;
      const key = normalizeAddress(r.recipientAddress, r.targetChain);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address: key, targetChain: r.targetChain });
    }
    return out;
  }, [rows, isVetted]);

  const whitelistBatch = useCallback(async () => {
    if (unvetted.length === 0) return;
    setWhitelisting(true);
    setError(null);
    try {
      const res = await trpc.recipients.addMany.mutate({
        recipients: unvetted.map((u) => ({ address: u.address, targetChain: u.targetChain })),
      });
      setFlash(
        `Vetted ${res.added} recipient${res.added === 1 ? "" : "s"}${res.failed ? ` · ${res.failed} failed` : ""}. You can settle now.`,
      );
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setWhitelisting(false);
    }
  }, [unvetted, refresh, report]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setFlash(null);
    try {
      // Send canonical addresses so the payout's compliance key matches the one
      // used when the payee was vetted.
      const payouts = validRows.map((r) => ({
        ...r,
        recipientAddress: normalizeAddress(r.recipientAddress, r.targetChain),
      }));
      const res = await trpc.payouts.submit.mutate({
        payouts,
        agentId: useAgent ? agents[0]?.agentId : undefined,
        idempotencyKey: `dash-${Date.now()}`,
      });
      setFlash(
        `Settled ${res.accepted} payouts — ${res.instantCount} instant, ${res.whaleCount} whale. Total debited $${money6(res.totalDebited6)}.`,
      );
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setSubmitting(false);
    }
  }, [validRows, useAgent, agents, refresh, report]);

  const onSignedUp = useCallback(
    async (key: string) => {
      setApiKey(key);
      setKeyLabel(key);
      await refresh();
    },
    [refresh],
  );

  const switchKey = useCallback(
    async (key: string) => {
      if (key === DEMO_API_KEY) clearApiKey();
      else setApiKey(key);
      setKeyLabel(getApiKey());
      setFlash(null);
      await refresh();
    },
    [refresh],
  );

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () =>
    setRows((rs) => [...rs, { recipientAddress: "", targetChain: "base", amountUSDC: "100", currencyCode: "USD" }]);
  const clearRows = () => setRows([]);
  const loadPayees = () =>
    setRows(
      recipients.map((r) => ({
        recipientAddress: r.address,
        targetChain: r.targetChain as Row["targetChain"],
        amountUSDC: "100",
        currencyCode: "USD" as const,
      })),
    );
  const importPayouts = (imported: Row[], mode: "append" | "replace") =>
    setRows((rs) => (mode === "replace" ? imported : [...rs, ...imported]));

  const totalValid = validRows.length;
  const totalInvalid = rows.length - totalValid;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Header connected={connected} onchain={overview?.onchainEnabled ?? false} />

      <AccountBar me={me} keyLabel={keyLabel} onSwitch={switchKey} custom={isCustomKey()} />

      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      {/* Onboarding */}
      <div className="mt-6">
        <Signup onSignedUp={onSignedUp} />
      </div>

      {/* Overview */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vault Balance" value={`$${overview ? money(overview.balance) : "—"}`} sub="On-chain USDC float" accent="#34d399" />
        <Stat label="Velocity Remaining (24h)" value={`$${overview ? money(overview.velocityRemaining) : "—"}`} sub={overview ? `of $${money(overview.velocityLimit)} cap` : undefined} />
        <Stat label="Payouts Settled" value={overview ? String(overview.settledCount) : "—"} sub="Across all chains" />
        <Stat label="Instant / Whale Split at" value={overview ? `$${money(overview.instantThreshold)}` : "—"} sub="≥ split → CCTP (live) · below → Gateway (v2)" accent="#a5b4fc" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Payout builder */}
        <div className="lg:col-span-2">
          <Section
            title="New Bulk Payout"
            right={
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button onClick={() => setRows(SAMPLE_BATCH)} className="rounded-md border border-line3 px-2 py-1 hover:bg-chip">
                  Load sample
                </button>
                {recipients.length > 0 ? (
                  <button onClick={loadPayees} className="rounded-md border border-line3 px-2 py-1 hover:bg-chip">
                    Load my payees
                  </button>
                ) : null}
                <button onClick={addRow} className="rounded-md border border-line3 px-2 py-1 hover:bg-chip">
                  + Row
                </button>
                {rows.length > 0 ? (
                  <button onClick={clearRows} className="rounded-md border border-line3 px-2 py-1 text-muted hover:bg-chip">
                    Clear
                  </button>
                ) : null}
              </div>
            }
          >
            <div className="space-y-2">
              {rows.map((r, i) => {
                const validAddr = isAddressValidForChain(r.recipientAddress, r.targetChain);
                const status = !validAddr ? "invalid" : isVetted(r) ? "vetted" : "unvetted";
                return (
                  <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-line p-2 sm:grid-cols-12 sm:rounded-none sm:border-0 sm:p-0">
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-5">
                      <RowStatusDot status={status} />
                      <input
                        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-2 text-xs mono sm:py-1.5"
                        placeholder="recipient address"
                        value={r.recipientAddress}
                        onChange={(e) => updateRow(i, { recipientAddress: e.target.value })}
                      />
                    </div>
                    <select
                      className="col-span-1 rounded-md border border-line bg-surface px-2 py-2 text-xs sm:col-span-2 sm:py-1.5"
                      value={r.targetChain}
                      onChange={(e) => updateRow(i, { targetChain: e.target.value as Row["targetChain"] })}
                    >
                      {CHAINS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      className={`col-span-1 rounded-md border bg-surface px-2 py-2 text-xs text-right sm:col-span-2 sm:py-1.5 ${isAmountValid(r.amountUSDC) ? "border-line" : "border-red-400"}`}
                      value={r.amountUSDC}
                      onChange={(e) => updateRow(i, { amountUSDC: e.target.value })}
                    />
                    <select
                      className="col-span-1 rounded-md border border-line bg-surface px-2 py-2 text-xs sm:col-span-2 sm:py-1.5"
                      value={r.currencyCode}
                      onChange={(e) => updateRow(i, { currencyCode: e.target.value as Row["currencyCode"] })}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR→EURC</option>
                    </select>
                    <button onClick={() => removeRow(i)} className="col-span-1 text-right text-faint hover:text-red-600 sm:text-center">✕</button>
                  </div>
                );
              })}
              {rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-faint">
                  No payouts yet — add a row, load your payees, or import a CSV below.
                </div>
              ) : null}
            </div>

            {/* Bulk CSV import */}
            <CsvImporter
              title="Bulk import payouts (CSV)"
              hint="Columns: recipientAddress, targetChain, amountUSDC, currencyCode (currency optional, defaults USD)."
              template={PAYOUT_CSV_TEMPLATE}
              templateName="arcane-payouts-template.csv"
              parse={parsePayoutCsv}
              modes
              onImport={(parsed, mode) => importPayouts(parsed, mode!)}
            />

            {/* Unvetted-recipient guard */}
            {unvetted.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2 rounded-lg px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between" style={{ border: "1px solid rgba(238,81,38,0.25)", background: "rgba(238,81,38,0.1)", color: "#C2410C" }}>
                <span>
                  ⚠ {unvetted.length} recipient{unvetted.length === 1 ? "" : "s"} in this batch{" "}
                  {unvetted.length === 1 ? "is" : "are"} not a vetted payee — compliance will reject{" "}
                  {unvetted.length === 1 ? "it" : "them"} until whitelisted.
                </span>
                <button
                  onClick={whitelistBatch}
                  disabled={whitelisting}
                  style={{ background: "#EE5126" }}
                  className="shrink-0 rounded-md px-3 py-1.5 font-semibold text-white hover:bg-brandhover disabled:opacity-50"
                >
                  {whitelisting ? "Vetting…" : `Vet & whitelist ${unvetted.length}`}
                </button>
              </div>
            ) : null}

            {preview ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line2 bg-surface-2 px-3 py-2 text-xs">
                <span className="text-muted">Routing preview:</span>
                <span className="text-green">{preview.summary.instant} instant</span>
                <span style={{ color: "#C2410C" }}>{preview.summary.whale} whale</span>
                <span className="text-ink3">· debit ≈ ${money(preview.summary.totalDebit)}</span>
                {totalInvalid > 0 ? <span className="text-red-700">· {totalInvalid} invalid row{totalInvalid === 1 ? "" : "s"} excluded</span> : null}
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} />
                Authorize via AI agent wallet {agents[0] ? `(${agents[0].label})` : ""}
              </label>
              <button
                onClick={submit}
                disabled={submitting || totalValid === 0}
                style={{ background: "#EE5126" }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:bg-brandhover disabled:opacity-40"
                title={unvetted.length > 0 ? "Some recipients are not vetted — whitelist them first to avoid rejection" : undefined}
              >
                {submitting ? "Settling…" : totalValid > 0 ? `Settle ${totalValid} payout${totalValid === 1 ? "" : "s"}` : "Settle batch"}
              </button>
            </div>
            {flash ? <div className="mt-3 rounded-lg px-3 py-2 text-xs text-green" style={{ border: "1px solid rgba(14,157,110,0.25)", background: "rgba(14,157,110,0.1)" }}>{flash}</div> : null}
          </Section>
        </div>

        {/* Funding + payees */}
        <div className="space-y-6">
          <Funding deposit={deposit} onRefresh={refresh} />
          <Payees recipients={recipients} onChanged={refresh} onError={report} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Solver mesh */}
        <Section title="Solver Mesh — instant rail (v2 preview)">
          <p className="mb-3 text-xs text-faint">
            Sub-500ms intent settlement via institutional market-makers is on the v2 roadmap. v1 settles every
            payout over CCTP for real cryptographic finality.
          </p>
          <div className="space-y-3">
            {solvers.map((s) => (
              <div key={s.id} className="rounded-lg border border-line2 bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  <Pill text="v2" tone="amber" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted">
                  {s.reserves.filter((r) => r.supported).map((r) => (
                    <span key={r.chain} className="rounded bg-chip px-1.5 py-0.5">
                      {r.chain}: ${r.available}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Agents */}
        <Section title="Autonomous Agent Wallets">
          <div className="space-y-3">
            {agents.map((a) => (
              <div key={a.agentId} className="rounded-lg border border-line2 bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{a.label}</span>
                  <Pill text={a.enabled ? "active" : "disabled"} tone={a.enabled ? "emerald" : "slate"} />
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-muted">
                  <CapBar label="Daily" used={a.spend.daily} cap={a.policy.daily} />
                  <CapBar label="Weekly" used={a.spend.weekly} cap={a.policy.weekly} />
                  <div>Per-tx cap: ${a.policy.perTransaction}</div>
                </div>
              </div>
            ))}
            {agents.length === 0 ? <div className="text-xs text-faint">No agent wallets provisioned.</div> : null}
          </div>
        </Section>
      </div>

      {/* Audit log */}
      <div className="mt-6">
        <Section title="CFO Audit Log — single-currency ledger">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-line2">
                  <th className="py-2 pr-3">Time</th>
                  <th className="pr-3">Recipient</th>
                  <th className="pr-3">Chain</th>
                  <th className="pr-3 text-right">Amount</th>
                  <th className="pr-3 text-right">Fees</th>
                  <th className="pr-3">Route</th>
                  <th className="pr-3">Settled in</th>
                  <th className="pr-3">Dest. Tx</th>
                  <th className="pr-3">Arc Tx</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id} className="border-b border-line2">
                    <td className="py-2 pr-3 text-muted">{new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td className="pr-3 mono">{e.recipientAddress.slice(0, 10)}…</td>
                    <td className="pr-3"><ChainBadge chain={e.targetChain} /></td>
                    <td className="pr-3 text-right">
                      ${e.amount} {e.currencyCode === "EUR" ? <span className="text-faint">→EURC</span> : null}
                    </td>
                    <td className="pr-3 text-right text-muted">${e.convenienceFee}</td>
                    <td className="pr-3"><PathBadge path={e.path} /></td>
                    <td className="pr-3">
                      <span
                        title={
                          e.settlementMode === "live"
                            ? e.path === "whale"
                              ? "Live CCTP burn (Arc) → mint (destination)"
                              : "Live intent → fill"
                            : "Representative latency (simulated rail)"
                        }
                        className={`mono ${e.settlementMode === "live" ? "text-green" : "text-muted"}`}
                      >
                        {latency(e.latencyMs)}
                        {e.settlementMode === "live" ? " ●" : ""}
                      </span>
                    </td>
                    <td className="pr-3"><TxLink hash={e.destinationTxHash} /></td>
                    <td className="pr-3"><TxLink hash={e.arcTxHash} /></td>
                  </tr>
                ))}
                {audit.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-faint">
                      No settlements yet — add a payee, fund your vault, then submit a batch.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <footer className="mt-10 text-center text-xs text-faint">
        Arcane Treasury · Arc Testnet (chain 5042002) · v1 settles over Circle CCTP
      </footer>
    </main>
  );
}

function Header({ connected, onchain }: { connected: boolean; onchain: boolean }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="mb-1 flex items-center gap-3 text-xs">
          <Link href="/" className="font-semibold tracking-tight text-ink3 hover:text-ink">← SplitStream storefront</Link>
          <Link href="/docs" className="text-muted hover:text-ink">Docs</Link>
          <Link href="/publish" className="text-muted hover:text-ink">Publish</Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Arcane <span className="text-brand">Treasury</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Stripe for cross-chain payouts · fund once in USDC · zero gas tokens · real CCTP settlement
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ModeBadge mode={onchain ? "live" : "simulated"} />
        <span className="badge" style={{ background: connected ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)", color: connected ? "#34d399" : "#f87171" }}>
          {connected ? "API connected" : "API offline"}
        </span>
      </div>
    </header>
  );
}

/**
 * Single error surface. The "is the API running?" hint is shown ONLY for genuine
 * connectivity failures — a business rejection (e.g. recipient not whitelisted)
 * shows just the actionable message, with extra guidance for known codes.
 */
function ErrorBanner({ error, onDismiss }: { error: ErrorInfo; onDismiss: () => void }) {
  const hint =
    error.arcaneCode === "RECIPIENT_NOT_WHITELISTED"
      ? "Use “Vet & whitelist” in the payout builder to allowlist these recipients, then settle again."
      : error.arcaneCode === "INSUFFICIENT_VAULT_BALANCE"
        ? "Fund your vault (see “Fund Your Vault”) and retry."
        : error.arcaneCode === "VELOCITY_LIMIT_EXCEEDED"
          ? "This batch exceeds the tenant's rolling 24h volume cap. Reduce the batch or wait for the window to roll."
          : null;
  return (
    <div
      className="mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
      style={
        error.isConnectivity
          ? { borderColor: "#fca5a5", background: "#fef2f2", color: "#b91c1c" }
          : { borderColor: "rgba(238,81,38,0.25)", background: "rgba(238,81,38,0.1)", color: "#C2410C" }
      }
    >
      <div>
        <span>{error.message}</span>
        {error.isConnectivity ? (
          <>
            {" "}— is the API running on <span className="mono">localhost:8787</span>? Start it with{" "}
            <span className="mono">pnpm --filter @arcane/server dev</span>.
          </>
        ) : hint ? (
          <div className="mt-1 text-xs" style={{ color: "#C2410C" }}>{hint}</div>
        ) : null}
      </div>
      <button onClick={onDismiss} className="shrink-0 text-xs text-muted hover:text-ink2">
        Dismiss
      </button>
    </div>
  );
}

function RowStatusDot({ status }: { status: "vetted" | "unvetted" | "invalid" }) {
  const map = {
    vetted: { color: "#34d399", title: "Vetted payee — will pass compliance" },
    unvetted: { color: "#fbbf24", title: "Valid address but NOT a vetted payee — whitelist before settling" },
    invalid: { color: "#f87171", title: "Address is not valid for the selected chain" },
  } as const;
  const c = map[status];
  return <span title={c.title} className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />;
}

/**
 * Generic CSV importer: file upload or paste, live-parsed with per-line errors.
 * `modes` adds Append/Replace (for the payout builder); without it a single
 * Import button is shown (for the payee list).
 */
function CsvImporter<T>({
  title,
  hint,
  template,
  templateName,
  parse,
  onImport,
  modes = false,
  importLabel = "Import",
}: {
  title: string;
  hint: string;
  template: string;
  templateName: string;
  parse: (text: string) => ParseResult<T>;
  onImport: (rows: T[], mode?: "append" | "replace") => void | Promise<void>;
  modes?: boolean;
  importLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => (text.trim() ? parse(text) : null), [text, parse]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  const apply = async (mode?: "append" | "replace") => {
    if (!result || result.rows.length === 0) return;
    setBusy(true);
    try {
      await onImport(result.rows, mode);
      setText("");
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-lg border border-dashed border-line3 px-3 py-2 text-xs text-ink3 hover:bg-chip"
      >
        ⬆ {title}
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-2 rounded-lg border border-line2 bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink3">{title}</span>
        <button onClick={() => setOpen(false)} className="text-xs text-faint hover:text-ink3">Close</button>
      </div>
      <p className="text-[11px] text-faint">{hint}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="text-[11px] text-muted file:mr-2 file:rounded file:border file:border-line3 file:bg-chip file:px-2 file:py-1 file:text-ink2"
        />
        <button onClick={() => downloadText(templateName, template)} className="rounded-md border border-line3 px-2 py-1 hover:bg-chip">
          Download template
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="…or paste CSV rows here"
        rows={4}
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] mono"
      />
      {result ? (
        <div className="space-y-1 text-[11px]">
          <div className="text-muted">
            Parsed <span className="text-green">{result.rows.length} valid</span>
            {result.errors.length > 0 ? <span className="text-red-700"> · {result.errors.length} error{result.errors.length === 1 ? "" : "s"}</span> : null}
          </div>
          {result.errors.length > 0 ? (
            <ul className="max-h-24 overflow-y-auto rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700">
              {result.errors.slice(0, 8).map((er, i) => (
                <li key={i}>{er}</li>
              ))}
              {result.errors.length > 8 ? <li>…and {result.errors.length - 8} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {modes ? (
          <>
            <button
              onClick={() => apply("append")}
              disabled={busy || !result || result.rows.length === 0}
              style={{ background: "#EE5126" }}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-white hover:bg-brandhover disabled:opacity-40"
            >
              Append {result?.rows.length ?? 0}
            </button>
            <button
              onClick={() => apply("replace")}
              disabled={busy || !result || result.rows.length === 0}
              className="rounded-md border border-line3 px-3 py-1.5 text-xs hover:bg-chip disabled:opacity-40"
            >
              Replace all
            </button>
          </>
        ) : (
          <button
            onClick={() => apply()}
            disabled={busy || !result || result.rows.length === 0}
            style={{ background: "#EE5126" }}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-white hover:bg-brandhover disabled:opacity-40"
          >
            {busy ? "Importing…" : `${importLabel} ${result?.rows.length ?? 0}`}
          </button>
        )}
      </div>
    </div>
  );
}

function AccountBar({ me, keyLabel, onSwitch, custom }: { me: Me | null; keyLabel: string; onSwitch: (k: string) => void; custom: boolean }) {
  const [entry, setEntry] = useState("");
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line2 bg-surface-2 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-muted">Account:</span>
        <span className="font-medium text-ink2">{me?.name ?? "—"}</span>
        {custom ? <Pill text="your tenant" tone="emerald" /> : <Pill text="demo tenant" tone="slate" />}
        <span className="mono text-faint">{keyLabel.slice(0, 16)}…</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          placeholder="paste an API key to switch"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="w-56 rounded-md border border-line bg-surface px-2 py-1.5 mono"
        />
        <button onClick={() => entry && onSwitch(entry.trim())} className="rounded-md border border-line3 px-2 py-1.5 hover:bg-chip">
          Switch
        </button>
        {custom ? (
          <button onClick={() => onSwitch(DEMO_API_KEY)} className="rounded-md border border-line3 px-2 py-1.5 hover:bg-chip">
            Use demo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Signup({ onSignedUp }: { onSignedUp: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await trpc.tenants.signup.mutate({ name, onchainAddress: addr.trim() });
      setIssuedKey(res.apiKey);
      onSignedUp(res.apiKey);
    } catch (e) {
      setErr(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line3 bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-chip"
      >
        + Open a corporate treasury account
      </button>
    );
  }

  return (
    <Section title="Open a Corporate Treasury Account" right={<button onClick={() => setOpen(false)} className="text-xs text-faint hover:text-ink3">Close</button>}>
      {issuedKey ? (
        <div className="space-y-3">
          <div className="rounded-lg px-3 py-2 text-xs text-green" style={{ border: "1px solid rgba(14,157,110,0.25)", background: "rgba(14,157,110,0.1)" }}>
            Account created. Your API key is shown <strong>once</strong> — save it now. It is already active in this dashboard.
          </div>
          <CopyField label="API key (store securely)" value={issuedKey} />
          <p className="text-xs text-muted">
            Next: fund your vault from the wallet you registered (see “Fund Your Vault”), add the payees you’ll pay,
            then submit a bulk payout.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted">Company name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Globex Payments Inc." className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted">Arc wallet (funds the vault)</span>
              <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm mono" />
            </label>
          </div>
          {err ? <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div> : null}
          <button
            onClick={submit}
            disabled={busy || name.length < 2 || !/^0x[a-fA-F0-9]{40}$/.test(addr.trim())}
            style={{ background: "#EE5126" }}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:bg-brandhover disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create account & issue API key"}
          </button>
        </div>
      )}
    </Section>
  );
}

function Funding({ deposit, onRefresh }: { deposit: DepositInfo | null; onRefresh: () => void }) {
  return (
    <Section title="Fund Your Vault" right={<button onClick={onRefresh} className="text-xs text-faint hover:text-ink3">Refresh balance</button>}>
      {deposit ? (
        <div className="space-y-3">
          <Stat label="On-chain vault balance" value={`$${money(deposit.balance)}`} accent="#34d399" />
          <CopyField label="Your registered wallet" value={deposit.tenantAddress} />
          {deposit.vaultAddress ? <CopyField label="Vault address (deposit here)" value={deposit.vaultAddress} /> : null}
          <CopyField label="USDC token (Arc native)" value={deposit.usdcAddress} />
          <div className="rounded-lg border border-line2 bg-surface-2 px-3 py-2 text-[11px] text-muted">
            <div className="mb-1 font-medium text-ink3">Two-step funding (from your wallet):</div>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>Approve: <span className="mono">USDC.approve(vault, amount)</span></li>
              <li>Deposit: <span className="mono">vault.depositUSDC(amount)</span></li>
            </ol>
            <div className="mt-1">Amounts are 6-decimal USDC (1 USDC = 1000000). Balance updates on Refresh.</div>
          </div>
          {!deposit.onchainEnabled ? <Pill text="mirror mode — balance is simulated" tone="amber" /> : null}
        </div>
      ) : (
        <div className="text-xs text-faint">Loading funding info…</div>
      )}
    </Section>
  );
}

function Payees({ recipients, onChanged, onError }: { recipients: Recipients; onChanged: () => Promise<void> | void; onError: (e: unknown) => void }) {
  const [addr, setAddr] = useState("");
  const [chain, setChain] = useState<Chain>("base");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const validAddr = isAddressValidForChain(addr, chain);

  const add = async () => {
    setBusy(true);
    try {
      await trpc.recipients.add.mutate({
        address: normalizeAddress(addr, chain),
        targetChain: chain,
        label: label || undefined,
      });
      setAddr("");
      setLabel("");
      await onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (recipientKey: string) => {
    setBusy(true);
    try {
      await trpc.recipients.remove.mutate({ recipientKey });
      await onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const importPayees = async (payees: PayeeRow[]) => {
    try {
      const res = await trpc.recipients.addMany.mutate({
        recipients: payees.map((p) => ({ address: p.address, targetChain: p.targetChain, label: p.label })),
      });
      await onChanged();
      if (res.failed > 0) onError(new Error(`${res.added} added, ${res.failed} failed to vet`));
    } catch (e) {
      onError(e);
    }
  };

  return (
    <Section title={`Payees (${recipients.length})`}>
      <p className="mb-3 text-xs text-faint">Every payout recipient must be vetted here first (on-chain allowlist).</p>
      <div className="space-y-2">
        {recipients.map((r) => (
          <div key={r.recipientKey} className="flex items-center justify-between rounded-lg border border-line2 bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="mono truncate text-xs text-ink2">{r.address}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                <ChainBadge chain={r.targetChain} />
                {r.label ? <span>{r.label}</span> : null}
              </div>
            </div>
            <button onClick={() => remove(r.recipientKey)} disabled={busy} className="shrink-0 text-faint hover:text-red-600">✕</button>
          </div>
        ))}
        {recipients.length === 0 ? <div className="text-xs text-faint">No payees yet — add one below.</div> : null}
      </div>

      <div className="mt-3 space-y-2 border-t border-line2 pt-3">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="recipient address" className={`w-full rounded-md border bg-surface px-2 py-1.5 text-xs mono ${addr.length === 0 || validAddr ? "border-line" : "border-red-400"}`} />
        <div className="flex gap-2">
          <select value={chain} onChange={(e) => setChain(e.target.value as Chain)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs">
            {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (optional)" className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs" />
          <button onClick={add} disabled={busy || !validAddr} style={{ background: "#EE5126" }} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white hover:bg-brandhover disabled:opacity-40">
            Add
          </button>
        </div>
      </div>

      <CsvImporter
        title="Bulk import payees (CSV)"
        hint="Columns: address, targetChain, label (label optional)."
        template={PAYEE_CSV_TEMPLATE}
        templateName="arcane-payees-template.csv"
        parse={parsePayeeCsv}
        importLabel="Vet & whitelist"
        onImport={(rows) => importPayees(rows)}
      />
    </Section>
  );
}

function CapBar({ label, used, cap }: { label: string; used: string; cap: string }) {
  const u = Number(used);
  const c = Number(cap) || 1;
  const pct = Math.min(100, (u / c) * 100);
  return (
    <div>
      <div className="flex justify-between">
        <span>{label}</span>
        <span>${used} / ${cap}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-chip">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "#EE5126" }} />
      </div>
    </div>
  );
}

/** Format a human USDC string (e.g. "1000000.5") with thousands separators. */
function money(human: string): string {
  return Number(human).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
/** Format a 6-decimal base-unit string (e.g. "75626270000" → "75,626.27"). */
function money6(base6: string): string {
  return (Number(base6) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
/** Format a settlement latency in ms as a compact human string ("8.2s" / "180ms"). */
function latency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
