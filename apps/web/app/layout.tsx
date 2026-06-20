import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SplitStream — pay-per-piece, split across chains",
  description:
    "Unlock a single article, photo, or song for a few cents — and watch the payment split instantly across every contributor, each paid on their own chain, in under 500ms on Circle's Arc L1.",
};

// Mobile-first viewport: device width, allow pinch-zoom up to 5x for accessibility,
// and tint the browser chrome to match the dark storefront.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#070a12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
