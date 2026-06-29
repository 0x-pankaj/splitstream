/** Server-side helpers for metadata + OG image routes (no "use client"). */

/** The public origin of this deployment, for absolute OG/canonical URLs. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/** The backend API origin (same default as the tRPC client). */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Per-chain settlement tints, matching the storefront. */
export const CHAIN_TINT: Record<string, string> = {
  base: "#2563EB",
  arbitrum: "#0E7490",
  ethereum: "#6366F1",
  solana: "#059669",
};

interface Contributor {
  role: string;
  targetChain: string;
  splitBps: number;
  address: string;
}

/** Normalized piece view used by metadata + OG routes. */
export interface PieceMeta {
  id: string;
  title: string;
  kind: string;
  /** USD display string, e.g. "0.05". */
  price: string;
  preview: string | null;
  contributors: Contributor[];
  /** Distinct settlement chains (derived — the REST view has no `chains` field). */
  chains: string[];
}

/** The raw REST `pieceView` shape (note: `priceUSDC`, and no `chains`). */
interface RawPiece {
  id: string;
  title: string;
  kind: string;
  priceUSDC: string;
  preview: string | null;
  contributors?: Contributor[];
}

/** Fetch one piece's public view for server-rendered metadata / OG images. */
export async function fetchPieceMeta(id: string): Promise<PieceMeta | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/pieces/${encodeURIComponent(id)}`, {
      // Always reflect the live piece; metadata must not serve a stale title.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { piece?: RawPiece };
    const p = data.piece;
    if (!p) return null;
    const contributors = p.contributors ?? [];
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      price: p.priceUSDC,
      preview: p.preview ?? null,
      contributors,
      chains: [...new Set(contributors.map((c) => c.targetChain))],
    };
  } catch {
    return null;
  }
}
