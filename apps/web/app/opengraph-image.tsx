/** Default OpenGraph card (home + any route without its own) — the SplitStream
 *  pitch as a branded preview. Rendered by next/og. */

import { ImageResponse } from "next/og";

export const alt = "SplitStream — pay a few cents, every creator paid instantly on Arc L1";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHAINS = [
  { label: "Base", color: "#2563EB" },
  { label: "Arbitrum", color: "#0E7490" },
  { label: "Ethereum", color: "#6366F1" },
  { label: "Solana", color: "#059669" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#FAF8F4",
          padding: "64px 72px",
          fontFamily: "sans-serif",
          color: "#17140F",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: "#EE5126", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: "#fff", transform: "rotate(45deg)" }} />
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>SplitStream</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(14,157,110,0.1)", color: "#0E7A56", padding: "10px 18px", borderRadius: 999, fontSize: 22, fontWeight: 600 }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, background: "#0E9D6E" }} />
            Live on Arc L1
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 56, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em" }}>
            <div style={{ display: "flex" }}>Pay a few cents.</div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              <span>Every creator gets paid&nbsp;</span>
              <span style={{ color: "#EE5126" }}>instantly.</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#6E675C", maxWidth: 980, lineHeight: 1.4 }}>
            Unlock a single article, photo, song, or API call — the payment fans out to every contributor, each settled on their own chain in real USDC, under 500ms.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {CHAINS.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#6E675C" }}>
              <div style={{ width: 14, height: 14, borderRadius: 999, background: c.color }} />
              {c.label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
