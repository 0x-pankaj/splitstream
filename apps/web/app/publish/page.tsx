/** Seller surface — publish a content piece or register a paid API (x402). */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublishForm } from "../../components/storefront";

export default function PublishPage() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
          SplitStream
        </Link>
        <Link href="/" className="text-xs text-muted hover:text-ink">
          ← storefront
        </Link>
      </header>
      <PublishForm onPublished={(id) => router.push(`/piece/${id}`)} />
    </main>
  );
}
