/** Creator dashboard — your Circle wallet on Arc, real earnings, withdraw, and a
 *  one-screen publish form. The self-serve "creators earning" surface: sign in,
 *  publish, watch the split land in your wallet, cash out. */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorInfo, getCreatorToken, clearCreatorToken } from "../../lib/trpc";
import { CopyField, Pill, Stat, TxLink } from "../../components/ui";

type Me = Awaited<ReturnType<typeof trpc.creator.me.query>>;
type Wallet = Awaited<ReturnType<typeof trpc.creator.wallet.query>>;
type Earnings = Awaited<ReturnType<typeof trpc.creator.earnings.query>>;
type MyPiece = Awaited<ReturnType<typeof trpc.creator.myPieces.query>>[number];

const KINDS = ["article", "photo", "song", "podcast"] as const;
const CHAINS = ["base", "arbitrum", "ethereum", "solana"] as const;

interface Row {
  role: string;
  percent: string;
  mode: "me" | "creator" | "byo";
  creatorRef: string;
  address: string;
  targetChain: (typeof CHAINS)[number];
}

export default function CreatorDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [pieces, setPieces] = useState<MyPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, w, e, p] = await Promise.all([
        trpc.creator.me.query(),
        trpc.creator.wallet.query(),
        trpc.creator.earnings.query(),
        trpc.creator.myPieces.query(),
      ]);
      setMe(m);
      setWallet(w);
      setEarnings(e);
      setPieces(p);
      setError(null);
    } catch (e) {
      const info = errorInfo(e);
      // Not logged in → bounce to the login screen.
      if (/log ?in|session/i.test(info.message)) {
        router.replace("/creator/login");
        return;
      }
      setError(info.message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getCreatorToken()) {
      router.replace("/creator/login");
      return;
    }
    void load();
  }, [load, router]);

  const logout = () => {
    clearCreatorToken();
    router.replace("/creator/login");
  };

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-10 text-sm text-muted">Loading your dashboard…</main>;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">SplitStream</Link>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/" className="text-muted hover:text-ink">storefront</Link>
          <button onClick={logout} className="text-muted hover:text-ink">log out</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">
          {me?.displayName ?? "Creator"}
        </h1>
        {me ? <Pill text={`@${me.handle}`} /> : null}
        {wallet ? (
          <Pill text={wallet.custodial ? "Circle wallet · Arc" : wallet.provider === "byo" ? "your address" : "dev wallet"} tone={wallet.custodial ? "emerald" : "slate"} />
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}

      {/* Earnings + wallet */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total earned (real on Arc)" value={`$${earnings?.totalEarnedUSDC ?? "0.00"}`} accent="#34d399" sub={`${earnings?.payoutCount ?? 0} payouts`} />
        <Stat label="Wallet balance" value={`$${wallet?.balanceUSDC ?? "0.00"}`} sub={wallet?.custodial ? "withdrawable" : "—"} />
        <Stat label="Pieces published" value={String(pieces.length)} />
      </div>

      {/* Wallet detail + withdraw */}
      <section className="card mt-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink3">Your payout wallet</h2>
        {wallet?.address ? (
          <div className="space-y-3">
            <CopyField label="Address (Arc)" value={wallet.address} />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <a className="text-brand hover:text-brandhover" href={`${wallet.explorer}/address/${wallet.address}`} target="_blank" rel="noreferrer">
                View on Arc explorer →
              </a>
              {!wallet.custodial ? (
                <span>This is a {wallet.provider === "byo" ? "bring-your-own" : "dev"} address — withdrawals run only on a Circle wallet.</span>
              ) : null}
            </div>
            {wallet.custodial ? <Withdraw balance={wallet.balanceUSDC} onDone={load} /> : null}
          </div>
        ) : (
          <div className="text-sm text-muted">No wallet assigned yet.</div>
        )}
      </section>

      {/* Publish */}
      <PublishPanel myHandle={me?.handle ?? ""} onPublished={load} />

      {/* Recent payouts */}
      {earnings && earnings.recent.length > 0 ? (
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink3">Recent payouts</h2>
          <div className="space-y-2">
            {earnings.recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-ink2">{r.title}</div>
                  <div className="text-xs text-faint">{r.role}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-green">${r.shareUSDC}</span>
                  <TxLink hash={r.txHash} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* My pieces */}
      <section className="card mt-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink3">Your pieces</h2>
        {pieces.length === 0 ? (
          <div className="text-sm text-muted">Nothing published yet — use the form above.</div>
        ) : (
          <div className="space-y-2">
            {pieces.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Pill text={p.kind} tone={p.kind === "api" ? "amber" : "slate"} />
                    <span className="truncate font-medium text-ink">{p.title}</span>
                  </div>
                  <div className="text-xs text-faint">{p.unlocks} unlocks · ${p.totalPaid} paid out</div>
                </div>
                <Link href={`/piece/${p.id}`} className="shrink-0 text-sm text-brand hover:text-brandhover">Open →</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Withdraw({ balance, onDone }: { balance: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await trpc.creator.withdraw.mutate({ toAddress: to.trim(), amountUSDC: amount.trim() });
      setMsg(`Withdrawal ${res.state.toLowerCase()} (tx ${res.transactionId.slice(0, 10)}…)`);
      setTo("");
      setAmount("");
      onDone();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-line2 bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wider text-muted">Withdraw USDC</div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x destination address"
          className="mono flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink2" />
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={`amount (max ${balance})`}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink2 sm:w-40" />
        <button onClick={submit} disabled={busy || !to.trim() || !amount.trim()}
          style={{ background: "#EE5126" }}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:bg-brandhover disabled:opacity-60">
          {busy ? "Sending…" : "Withdraw"}
        </button>
      </div>
      {msg ? <div className="mt-2 text-xs text-green">{msg}</div> : null}
      {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
    </div>
  );
}

function PublishPanel({ myHandle, onPublished }: { myHandle: string; onPublished: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("article");
  const [price, setPrice] = useState("0.05");
  const [preview, setPreview] = useState("");
  const [content, setContent] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { role: "writer", percent: "100", mode: "me", creatorRef: "", address: "", targetChain: "base" },
  ]);
  const [busy, setBusy] = useState(false);
  const [okId, setOkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalPct = rows.reduce((acc, r) => acc + (Number(r.percent) || 0), 0);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { role: "", percent: "0", mode: "byo", creatorRef: "", address: "", targetChain: "base" }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const publish = async () => {
    setError(null);
    setOkId(null);
    if (Math.round(totalPct) !== 100) {
      setError(`Shares must sum to 100% (currently ${totalPct}%).`);
      return;
    }
    setBusy(true);
    try {
      const contributors = rows.map((r) => {
        const splitBps = Math.round((Number(r.percent) || 0) * 100);
        if (r.mode === "me") return { role: r.role || "creator", splitBps, creatorRef: myHandle };
        if (r.mode === "creator") return { role: r.role || "contributor", splitBps, creatorRef: r.creatorRef.trim() };
        return { role: r.role || "contributor", splitBps, address: r.address.trim(), targetChain: r.targetChain };
      });
      const piece = await trpc.creator.publish.mutate({
        title: title.trim(),
        kind,
        priceUSDC: price.trim(),
        preview: preview.trim() || undefined,
        content: content.trim() || undefined,
        contributors,
      });
      setOkId(piece.id);
      setTitle("");
      setPreview("");
      setContent("");
      onPublished();
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink3">Publish a piece</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2 sm:col-span-2" />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="price USDC (e.g. 0.05)"
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2" />
        <input value={preview} onChange={(e) => setPreview(e.target.value)} placeholder="Free preview / teaser"
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2 sm:col-span-2" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Gated content (markdown/text, or a media URL) — revealed after payment" rows={4}
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2 sm:col-span-2" />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Revenue split</span>
          <span className="text-xs" style={{ color: Math.round(totalPct) === 100 ? "#0E7A56" : "#C2410C" }}>{totalPct}% allocated</span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-line2 bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={r.role} onChange={(e) => setRow(i, { role: e.target.value })} placeholder="role (e.g. writer)"
                  className="w-32 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2" />
                <select value={r.mode} onChange={(e) => setRow(i, { mode: e.target.value as Row["mode"] })}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2">
                  <option value="me">me</option>
                  <option value="creator">@creator</option>
                  <option value="byo">address</option>
                </select>
                {r.mode === "creator" ? (
                  <input value={r.creatorRef} onChange={(e) => setRow(i, { creatorRef: e.target.value })} placeholder="handle or email"
                    className="mono flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2" />
                ) : null}
                {r.mode === "byo" ? (
                  <>
                    <input value={r.address} onChange={(e) => setRow(i, { address: e.target.value })} placeholder="0x… or Solana address"
                      className="mono flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2" />
                    <select value={r.targetChain} onChange={(e) => setRow(i, { targetChain: e.target.value as Row["targetChain"] })}
                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2">
                      {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </>
                ) : null}
                <input value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="%"
                  className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink2" />
                <span className="text-xs text-faint">%</span>
                {rows.length > 1 ? (
                  <button onClick={() => removeRow(i)} className="text-xs text-faint hover:text-red-600">remove</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="mt-2 text-xs text-brand hover:text-brandhover">+ add contributor</button>
      </div>

      <button onClick={publish} disabled={busy || !title.trim()}
        style={{ background: "#0E9D6E" }}
        className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? "Publishing…" : "Publish piece"}
      </button>
      {okId ? (
        <div className="mt-2 rounded-lg px-3 py-2 text-xs text-green" style={{ border: "1px solid rgba(14,157,110,0.25)", background: "rgba(14,157,110,0.1)" }}>
          Published! Live at <Link className="underline" href={`/piece/${okId}`}>/piece/{okId}</Link>
        </div>
      ) : null}
      {error ? <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
    </section>
  );
}
