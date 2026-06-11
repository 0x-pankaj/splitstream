import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arcane Treasury — CFO Console",
  description:
    "Stripe for cross-chain payouts, built natively on Circle's Arc L1. Fund once in USDC; pay thousands of creators across chains with zero gas tokens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
