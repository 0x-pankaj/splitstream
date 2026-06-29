import type { Metadata, Viewport } from "next";
import { SITE_URL } from "../lib/site";
import "./globals.css";

const TITLE = "SplitStream — pay-per-piece, split across chains";
const DESCRIPTION =
  "Unlock a single article, photo, or song for a few cents — and watch the payment split instantly across every contributor, each paid on their own chain, in under 500ms on Circle's Arc L1.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  // The opengraph-image.tsx / piece/[id]/opengraph-image.tsx routes auto-attach
  // the actual card image (absolute URL resolved against metadataBase).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "SplitStream",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Mobile-first viewport: device width, allow pinch-zoom up to 5x for accessibility,
// and tint the browser chrome to match the warm cream storefront.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#faf8f4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
