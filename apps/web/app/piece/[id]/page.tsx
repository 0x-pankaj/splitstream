/** Shareable single-piece page — the link a publisher drops in a tweet or DM so
 *  any reader can unlock one piece and pay its creators. Public, no API key. */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc, errorInfo, getReaderId } from "../../../lib/trpc";
import { PieceCard, RestorePurchases, type Piece } from "../../../components/storefront";

export default function PiecePage() {
  const params = useParams<{ id: string }>();
  const pieceId = params.id;
  const [piece, setPiece] = useState<Piece | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const p = await trpc.pieces.get.query({ pieceId });
      setPiece(p);
      setError(null);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setLoading(false);
    }
  }, [pieceId]);

  useEffect(() => {
    refresh();
    trpc.traction.visit.mutate({ visitorId: getReaderId() }).catch(() => {});
  }, [refresh]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-100">
          SplitStream
        </Link>
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
          ← all pieces
        </Link>
      </header>

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      ) : !piece ? (
        <div className="card p-6 text-sm text-slate-400">No such piece.</div>
      ) : (
        <div className="space-y-4">
          <PieceCard piece={piece} onUnlocked={refresh} />
          <RestorePurchases onRestored={refresh} />
        </div>
      )}
    </main>
  );
}
