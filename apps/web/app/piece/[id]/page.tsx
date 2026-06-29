/** Server wrapper for the shareable single-piece page. Renders per-piece social
 *  metadata (so a dropped link shows a rich card) and hands off to the client. */

import type { Metadata } from "next";
import { fetchPieceMeta } from "../../../lib/site";
import PieceClient from "./piece-client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const piece = await fetchPieceMeta(id);
  if (!piece) {
    return { title: "Piece — SplitStream" };
  }
  const chains = piece.chains.length;
  const verb = piece.kind === "api" ? "Pay per call" : "Unlock";
  const title = `${piece.title} · $${piece.price} — SplitStream`;
  const description =
    piece.preview ??
    `${verb} for $${piece.price} — the payment splits instantly across ${piece.contributors.length} contributor${piece.contributors.length === 1 ? "" : "s"} on ${chains} chain${chains === 1 ? "" : "s"}, in real USDC on Arc L1.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PiecePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PieceClient id={id} />;
}
