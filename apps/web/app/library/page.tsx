/** My Purchases — a server-backed library of everything this reader owns. Pulls
 *  from the browser reader id, lets you merge wallet purchases (one signature),
 *  and back up / restore a no-wallet library with a recovery code. */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { trpc, errorInfo, getReaderId } from "../../lib/trpc";
import { hasWallet, signOwnership } from "../../lib/wallet";
import { cacheOwnedContent } from "../../lib/owned";
import { Pill } from "../../components/ui";

type LibraryItem = Awaited<ReturnType<typeof trpc.pieces.library.query>>["pieces"][number];

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "wallet" | "issue" | "redeem">(null);
  const [code, setCode] = useState<string | null>(null);
  const [redeemInput, setRedeemInput] = useState("");
  const [walletAvailable, setWalletAvailable] = useState(false);

  // Merge new items into the list (dedup by pieceId) and cache any content.
  const merge = useCallback((incoming: LibraryItem[]) => {
    for (const p of incoming) if (p.content) cacheOwnedContent(p.pieceId, p.content);
    setItems((prev) => {
      const byId = new Map(prev.map((p) => [p.pieceId, p]));
      for (const p of incoming) byId.set(p.pieceId, { ...byId.get(p.pieceId), ...p });
      return [...byId.values()];
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await trpc.pieces.library.query({ reader: getReaderId() });
      merge(res.pieces);
      setError(null);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setLoading(false);
    }
  }, [merge]);

  useEffect(() => {
    setWalletAvailable(hasWallet());
    void load();
  }, [load]);

  // Pull in purchases tied to a wallet (one gasless signature).
  const restoreWallet = async () => {
    setBusy("wallet");
    setError(null);
    setNote(null);
    try {
      const { address, message, signature } = await signOwnership();
      const res = await trpc.pieces.restore.mutate({ address, message, signature });
      merge(res.pieces.map((p) => ({ ...p, preview: null })));
      setNote(res.count === 0 ? "No purchases found for that wallet." : `Added ${res.count} from your wallet.`);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(null);
    }
  };

  // Mint a recovery code that backs up this device's library.
  const backUp = async () => {
    setBusy("issue");
    setError(null);
    setNote(null);
    try {
      const res = await trpc.pieces.createRecoveryCode.mutate({ reader: getReaderId() });
      setCode(res.code);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(null);
    }
  };

  // Redeem a code from another device onto THIS device's reader id.
  const redeem = async () => {
    if (!redeemInput.trim()) return;
    setBusy("redeem");
    setError(null);
    setNote(null);
    try {
      const res = await trpc.pieces.redeemRecoveryCode.mutate({ code: redeemInput.trim(), reader: getReaderId() });
      merge(res.pieces);
      setRedeemInput("");
      setNote(res.count === 0 ? "That code had no purchases." : `Restored ${res.count} piece${res.count === 1 ? "" : "s"} to this device.`);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">SplitStream</Link>
        <Link href="/" className="text-xs text-muted hover:text-ink">← storefront</Link>
      </header>

      <h1 className="text-xl font-semibold text-ink">My purchases</h1>
      <p className="mt-1 text-sm text-muted">
        Everything you&apos;ve unlocked. Saved to your account on the server — bring it to a new device with a
        wallet signature or a recovery code.
      </p>

      {/* Portability controls */}
      <div className="mt-5 space-y-3">
        <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-ink3">
            <span className="font-semibold text-ink">No-wallet backup</span>{" "}
            <span className="text-muted">— get a code to restore on another device.</span>
          </div>
          <button onClick={backUp} disabled={busy === "issue"}
            className="w-full rounded-xl border border-line3 bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-chip disabled:opacity-60 sm:w-auto">
            {busy === "issue" ? "Generating…" : "Back up to a code"}
          </button>
        </div>

        {code ? (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ border: "1px solid rgba(14,157,110,0.25)", background: "rgba(14,157,110,0.1)" }}>
            <div className="text-green">Your recovery code — keep it private:</div>
            <div className="mono mt-1 text-lg font-semibold tracking-wider text-ink">{code}</div>
            <div className="mt-1 text-xs text-muted">Enter it under “Restore from a code” on another device.</div>
          </div>
        ) : null}

        <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <input
            value={redeemInput}
            onChange={(e) => setRedeemInput(e.target.value)}
            placeholder="SS-XXXX-XXXX"
            className="mono w-full flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm uppercase tracking-wider text-ink2"
          />
          <button onClick={redeem} disabled={busy === "redeem" || !redeemInput.trim()}
            style={{ background: "#EE5126" }}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:bg-brandhover disabled:opacity-60 sm:w-auto">
            {busy === "redeem" ? "Restoring…" : "Restore from a code"}
          </button>
        </div>

        {walletAvailable ? (
          <button onClick={restoreWallet} disabled={busy === "wallet"}
            className="w-full rounded-xl border border-line3 bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-chip disabled:opacity-60">
            {busy === "wallet" ? "Check your wallet…" : "🔑 Add purchases from a wallet"}
          </button>
        ) : null}

        {note ? <div className="text-xs text-green">{note}</div> : null}
        {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
      </div>

      {/* The library */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink3">
          Owned {items.length > 0 ? `· ${items.length}` : ""}
        </h2>
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="card p-6 text-sm text-muted">
            Nothing here yet. Unlock a piece on the{" "}
            <Link href="/" className="text-brand hover:text-brandhover">storefront</Link>, or restore with a code/wallet above.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((p) => (
              <div key={p.pieceId} className="card flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Pill text={p.kind} tone={p.kind === "api" ? "amber" : "slate"} />
                  </div>
                  <div className="mt-1 truncate font-semibold text-ink">{p.title}</div>
                  {p.preview ? <div className="truncate text-xs text-muted">{p.preview}</div> : null}
                </div>
                <Link href={`/piece/${p.pieceId}`} className="shrink-0 text-sm font-medium text-brand hover:text-brandhover">
                  Open →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
