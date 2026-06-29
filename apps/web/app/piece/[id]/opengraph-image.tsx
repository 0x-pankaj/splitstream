/** Dynamic OpenGraph card for a shared piece link — branded SplitStream preview
 *  showing the title, price, and the cross-chain split. Rendered by next/og. */

import { ImageResponse } from "next/og";
import { fetchPieceMeta, CHAIN_TINT } from "../../../lib/site";

export const alt = "SplitStream — pay a few cents, every creator paid instantly";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const piece = await fetchPieceMeta(id);

  const title = piece?.title ?? "SplitStream";
  const price = piece?.price ?? "0.05";
  const kind = piece?.kind === "api" ? "paid API" : piece?.kind ?? "article";
  const contributors = piece?.contributors ?? [];
  const chainCount = piece?.chains.length ?? 0;
  const isApi = piece?.kind === "api";

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
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 13,
                background: "#EE5126",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 4, background: "#fff", transform: "rotate(45deg)" }} />
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>SplitStream</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(14,157,110,0.1)",
              color: "#0E7A56",
              padding: "10px 18px",
              borderRadius: 999,
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 999, background: "#0E9D6E" }} />
            Live on Arc L1
          </div>
        </div>

        {/* title + price */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontSize: 22,
              fontWeight: 600,
              color: isApi ? "#C2410C" : "#6E675C",
              background: isApi ? "rgba(238,81,38,0.1)" : "#F1ECE3",
              padding: "6px 16px",
              borderRadius: 999,
            }}
          >
            {kind}
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.025em", maxWidth: 1000 }}>
            {title.length > 90 ? title.slice(0, 88) + "…" : title}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: "#EE5126", letterSpacing: "-0.02em" }}>{`$${price}`}</div>
            <div style={{ display: "flex", fontSize: 26, color: "#6E675C" }}>{isApi ? "per call" : "one-time unlock"}</div>
          </div>
        </div>

        {/* split bar + footer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", width: "100%", height: 14, borderRadius: 999, overflow: "hidden", background: "#F3EFE8" }}>
            {contributors.map((c, i) => (
              <div key={i} style={{ display: "flex", width: `${c.splitBps / 100}%`, height: "100%", background: CHAIN_TINT[c.targetChain] ?? "#8A8378" }} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 26, color: "#6E675C" }}>
              {contributors.length > 0
                ? `Splits to ${contributors.length} creator${contributors.length === 1 ? "" : "s"} on ${chainCount} chain${chainCount === 1 ? "" : "s"} · under 500ms`
                : "Pay a few cents — every creator paid instantly, cross-chain."}
            </div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: "#0E9D6E" }}>real USDC ⚡</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
