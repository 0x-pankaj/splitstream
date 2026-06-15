/** Seller surface — publish a content piece or register a paid API (x402). */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublishForm } from "../../components/storefront";

export default function PublishPage() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-100">
          SplitStream
        </Link>
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
          ← storefront
        </Link>
      </header>
      <PublishForm onPublished={(id) => router.push(`/piece/${id}`)} />
    </main>
  );
}
