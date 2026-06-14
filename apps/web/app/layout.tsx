import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SplitStream — pay-per-piece, split across chains",
  description:
    "Unlock a single article, photo, or song for a few cents — and watch the payment split instantly across every contributor, each paid on their own chain, in under 500ms on Circle's Arc L1.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
