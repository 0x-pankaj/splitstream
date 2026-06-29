/** Iframe target for the embeddable TipJar widget (/widget.js points here).
 *  Transparent page background so the card blends into any host site. */

import type { Metadata } from "next";
import { fetchPieceMeta } from "../../../lib/site";
import EmbedClient from "./embed-client";

// Embeds shouldn't be indexed as standalone pages.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const piece = await fetchPieceMeta(id);
  return (
    <>
      {/* Make the iframe background transparent so the card sits on the host page. */}
      <style>{`html,body{background:transparent !important;margin:0}`}</style>
      <div style={{ padding: 8 }}>
        {piece ? (
          <EmbedClient piece={piece} />
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">This piece is unavailable.</div>
        )}
      </div>
    </>
  );
}
