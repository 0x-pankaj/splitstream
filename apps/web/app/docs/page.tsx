/** In-depth docs: how both sides use SplitStream — sellers who list a service
 *  (content or a paid API) and buyers/agents who consume one (MCP, x402, REST). */

"use client";

import { useState } from "react";
import Link from "next/link";
import { Pill } from "../../components/ui";
import { addArcToWallet } from "../../lib/wallet";

/** One-click "Add Arc Testnet to my wallet" with inline status. */
function AddArc() {
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const add = async () => {
    try {
      await addArcToWallet();
      setStatus("ok");
      setMsg("Arc Testnet added — switch to it in your wallet and you're ready to pay.");
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : "Couldn't add the network automatically — add it manually below.");
    }
  };
  return (
    <div>
      <button
        onClick={add}
        className="rounded-xl bg-indigo-500/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
      >
        ➕ Add Arc Testnet to my wallet
      </button>
      {status !== "idle" ? (
        <div className={`mt-2 text-xs ${status === "ok" ? "text-emerald-300" : "text-amber-300"}`}>{msg}</div>
      ) : null}
    </div>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="relative mt-2">
      {label ? <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{label}</div> : null}
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 rounded-md border border-slate-600 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700/60"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="mono overflow-x-auto rounded-lg border border-slate-700 bg-slate-950/70 p-3 pr-16 text-xs leading-relaxed text-slate-200">
        {children}
      </pre>
    </div>
  );
}

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-lg font-semibold text-slate-100">
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

const NAV: Array<{ id: string; label: string; group?: string }> = [
  { id: "overview", label: "Overview" },
  { id: "concepts", label: "Core concepts" },
  { group: "Sellers", id: "sell-key", label: "1. Get an API key" },
  { id: "sell-content", label: "2. List content" },
  { id: "sell-api", label: "3. List a paid API" },
  { id: "sell-auth", label: "4. Authenticated APIs" },
  { id: "sell-paid", label: "5. Getting paid" },
  { group: "Buyers & agents", id: "buy-mcp", label: "A. Install in your AI (MCP)" },
  { id: "buy-x402", label: "B. x402 (any agent)" },
  { id: "buy-rest", label: "C. REST / curl" },
  { id: "buy-human", label: "D. Storefront (human)" },
  { id: "add-arc", label: "E. Add Arc to your wallet" },
  { group: "Reference", id: "ref-endpoints", label: "Endpoints" },
  { id: "ref-x402", label: "x402 wire format" },
  { id: "ref-network", label: "Network & modes" },
];

const ARC_USDC = "0x3600000000000000000000000000000000000000";

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-slate-100">SplitStream</span>
          <Pill text="docs" tone="slate" />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/publish" className="rounded-lg bg-indigo-500/90 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400">+ Publish</Link>
          <Link href="/" className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/40">Storefront →</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        {/* Sticky nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-8 space-y-1 text-sm">
            {NAV.map((n) => (
              <div key={n.id}>
                {n.group ? (
                  <div className="mt-4 mb-1 text-[11px] uppercase tracking-wider text-slate-500">{n.group}</div>
                ) : null}
                <a href={`#${n.id}`} className="block rounded px-2 py-1 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200">
                  {n.label}
                </a>
              </div>
            ))}
          </div>
        </nav>

        <div className="space-y-10">
          {/* Overview */}
          <section className="space-y-3">
            <H id="overview">Overview</H>
            <p className="text-sm text-slate-300">
              SplitStream is a pay-per-use layer on Circle&apos;s <strong>Arc L1</strong>. Anyone can list a
              <strong> service</strong> — a piece of content (article, song, photo) or a <strong>paid API</strong> — and
              get paid per use in USDC, with the payment <strong>split across every contributor on their own chain</strong>.
              Buyers can be humans or AI agents; agents pay per call via the <strong>x402</strong> standard.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <div className="mb-1 text-sm font-semibold text-slate-100">You list a service →</div>
                <p className="text-sm text-slate-400">Register content or an API endpoint with a price and a revenue split. Integrate nothing — we are the paywall.</p>
              </Card>
              <Card>
                <div className="mb-1 text-sm font-semibold text-slate-100">Someone pays per use →</div>
                <p className="text-sm text-slate-400">A human clicks, or an AI agent pays autonomously per call in USDC. The split settles to all owners across chains.</p>
              </Card>
            </div>
          </section>

          {/* Concepts */}
          <section className="space-y-3">
            <H id="concepts">Core concepts</H>
            <Card>
              <ul className="space-y-2 text-sm text-slate-300">
                <li><strong className="text-slate-100">Piece</strong> — the unit you list. <code className="mono text-indigo-300">kind</code> is <code className="mono">article·photo·song·podcast</code> (content) or <code className="mono">api</code> (a paid endpoint).</li>
                <li><strong className="text-slate-100">Split</strong> — contributors each take a share in basis points (must sum to 10000 = 100%); each is paid on their <code className="mono">targetChain</code>.</li>
                <li><strong className="text-slate-100">x402</strong> — the HTTP &quot;402 Payment Required&quot; flow agents use to pay per call: <em>request → 402 challenge → pay USDC → retry with proof → get result</em>.</li>
                <li><strong className="text-slate-100">Credential injection</strong> — for authenticated APIs, you store the upstream key once; we inject it per call. The buyer gets access, never the key (no KYC).</li>
              </ul>
            </Card>
          </section>

          {/* ─── SELLERS ─── */}
          <div className="border-t border-slate-800 pt-6">
            <Pill text="For sellers — list a service" tone="emerald" />
          </div>

          <section className="space-y-3">
            <H id="sell-key">1. Get an API key</H>
            <p className="text-sm text-slate-300">Open a publisher account once to get a scoped key (the demo key <code className="mono text-indigo-300">arc_test_sk_demo_0001</code> works out of the box).</p>
            <Code label="sign up (tRPC) — or just use the demo key">{`curl -X POST localhost:8787/trpc/tenants.signup \\
  -H 'content-type: application/json' \\
  -d '{"name":"Acme Media","onchainAddress":"0xYourArcAddress0000000000000000000000000"}'
# → { apiKey: "arc_test_sk_...", ... }  (shown once)`}</Code>
          </section>

          <section className="space-y-3">
            <H id="sell-content">2. List content (pay-per-piece, cross-chain split)</H>
            <p className="text-sm text-slate-300">A reader pays a few cents to unlock; the price fans out to every contributor on their chain. Use the <Link href="/publish" className="text-indigo-300 hover:text-indigo-200">/publish</Link> form, or the API:</p>
            <Code label="register an article with a 3-way split">{`curl -X POST localhost:8787/api/v1/pieces \\
  -H 'content-type: application/json' -H 'x-api-key: arc_test_sk_demo_0001' \\
  -d '{
    "title": "The Stablecoin Frontier",
    "kind": "article",
    "priceUSDC": "0.05",
    "contributors": [
      { "role":"writer",       "address":"0x1111…", "targetChain":"base",     "splitBps":6000 },
      { "role":"editor",       "address":"0x2222…", "targetChain":"arbitrum", "splitBps":2500 },
      { "role":"photographer", "address":"9xQe…",   "targetChain":"solana",   "splitBps":1500 }
    ]
  }'`}</Code>
            <p className="text-sm text-slate-400">It&apos;s now live in the catalog and shareable at <code className="mono">/piece/&lt;id&gt;</code>.</p>
          </section>

          <section className="space-y-3">
            <H id="sell-api">3. List a paid API (x402 pay-per-call)</H>
            <p className="text-sm text-slate-300">Register any HTTP endpoint with a per-call price. You integrate nothing — SplitStream becomes the x402 paywall and proxies the call on payment.</p>
            <Code label="register a paid API">{`curl -X POST localhost:8787/api/v1/pieces \\
  -H 'content-type: application/json' -H 'x-api-key: arc_test_sk_demo_0001' \\
  -d '{
    "title": "My App: FX Rates",
    "kind": "api",
    "priceUSDC": "0.01",
    "endpoint": "https://api.yourapp.com/v1/fx?from=USD&to=EUR",
    "httpMethod": "GET",
    "contributors": [{ "role":"owner", "address":"0xYourArcEvmAddress", "targetChain":"base", "splitBps":10000 }]
  }'`}</Code>
            <p className="text-sm text-slate-400">Multi-owner APIs split automatically — list several contributors.</p>
          </section>

          <section className="space-y-3">
            <H id="sell-auth">4. Authenticated APIs — access without KYC</H>
            <p className="text-sm text-slate-300">If your endpoint needs a key, store it once with the piece. It&apos;s <strong>write-only</strong> — never returned by any read endpoint — and injected per call. The paying agent gets the result, never the key.</p>
            <Code label="add upstream auth: bearer · header · query">{`"auth": { "type":"bearer", "secret":"sk_live_…" }
"auth": { "type":"header", "name":"X-API-Key", "secret":"…" }
"auth": { "type":"query",  "name":"apikey",    "secret":"…" }`}</Code>
            <p className="text-sm text-slate-400">Reads expose only <code className="mono">authenticated:true</code> and <code className="mono">authType</code> — never the secret.</p>
          </section>

          <section className="space-y-3">
            <H id="sell-paid">5. Getting paid — real USDC on Arc</H>
            <Card>
              <ul className="space-y-2 text-sm text-slate-300">
                <li><strong className="text-slate-100">Live (LIVE_X402)</strong> — the buyer&apos;s USDC payment is verified on Arc, then each owner is paid their split in <strong>real USDC on Arc</strong>. Proven end-to-end (owner balance 0 → 0.01 on-chain).</li>
                <li><strong className="text-slate-100">Mirror (default)</strong> — keyless demo: simulated settlement so anyone can try it instantly. Split math, credential injection, and live upstream calls are real either way.</li>
                <li><strong className="text-slate-100">Cross-chain</strong> — EVM contributors are paid on Arc directly; other chains route via Circle CCTP / Gateway.</li>
              </ul>
            </Card>
          </section>

          {/* ─── BUYERS ─── */}
          <div className="border-t border-slate-800 pt-6">
            <Pill text="For buyers & agents — consume a service" tone="amber" />
          </div>

          <section className="space-y-3">
            <H id="buy-mcp">A. Install in your AI (MCP)</H>
            <p className="text-sm text-slate-300">Add SplitStream&apos;s MCP server to any MCP client (Claude, Cursor, …) <strong>once</strong>. Your AI then has tools to browse and pay for services — the user just talks normally.</p>
            <Code label="install once">{`claude mcp add splitstream -- bun run apps/server/src/mcp/stdio.ts`}</Code>
            <p className="text-sm text-slate-400 mt-2">Tools the agent gains: <code className="mono">list_pieces</code>, <code className="mono">call_api</code>, <code className="mono">pay_for_piece</code> (+ treasury tools).</p>
            <Code label="then the human just asks — the AI discovers + pays">{`User:  "What's the USD→EUR rate right now?"
AI:    list_pieces → finds "FX Rate API"
       call_api(pieceId) → pays $0.01 → returns { "rates": { "EUR": 0.86 } }
AI:    "It's about €0.86 to the dollar."`}</Code>
          </section>

          <section className="space-y-3">
            <H id="buy-x402">B. x402 — any agent with a wallet</H>
            <p className="text-sm text-slate-300">No SplitStream-specific install. An agent with an x402 client + a funded Arc wallet pays our endpoint the standard way. This is the same model the wider x402 ecosystem (incl. pay.sh) uses; Circle&apos;s <code className="mono">pay-via-agent-wallet</code> does exactly this on Arc.</p>
            <Code label="the handshake (what an x402 client automates)">{`# 1. request the resource — no payment yet
POST /api/v1/pieces/<id>/call
→ 402 Payment Required
  { "x402Version":1, "accepts":[{
      "scheme":"exact", "network":"arc-testnet",
      "maxAmountRequired":"10000", "payTo":"0x…", "asset":"${ARC_USDC}",
      "nonce":"0x…", "resource":"/api/v1/pieces/<id>/call" }] }

# 2. pay maxAmountRequired USDC to payTo on Arc (your wallet signs it)

# 3. retry with the proof
POST /api/v1/pieces/<id>/call
   X-PAYMENT: base64({ x402Version:1, scheme:"exact", network:"arc-testnet",
                       payload:{ nonce:"0x…", from:"0xYou", authorization:"<txHash>" } })
→ 200 OK
  X-PAYMENT-RESPONSE: base64({ success:true, transaction:"0x…", payer:"0xYou" })
  { "paid":true, "mode":"live-arc", "payments":[…], "upstream":{ "ok":true, "body":{…} } }`}</Code>
            <p className="text-sm text-slate-400 mt-2">Try the full handshake locally: <code className="mono">pnpm --filter @arcane/server x402:call</code>. The single-use nonce blocks replay.</p>
          </section>

          <section className="space-y-3">
            <H id="buy-rest">C. REST / curl (content unlock or known API)</H>
            <Code label="unlock a content piece (public, no key)">{`curl -X POST localhost:8787/api/v1/pieces/<id>/pay \\
  -H 'content-type: application/json' -d '{"payer":"reader"}'
# → { unlock: { contributors:[ …paid per chain… ] } }`}</Code>
          </section>

          <section className="space-y-3">
            <H id="buy-human">D. Storefront (human, one click)</H>
            <p className="text-sm text-slate-300">Open the <Link href="/" className="text-indigo-300 hover:text-indigo-200">storefront</Link>: browse pieces, hit <strong>Unlock</strong> (content) or <strong>Pay &amp; call</strong> (API), and see the cross-chain fan-out + live result. No account. To pay with your <em>own</em> wallet in real USDC, add Arc first (below).</p>
          </section>

          <section className="space-y-3">
            <H id="add-arc">E. Add Arc Testnet to your wallet</H>
            <p className="text-sm text-slate-300">
              To pay with <strong>your own wallet</strong> you need Arc Testnet added — most wallets don&apos;t have it yet.
              One click adds it. On Arc, <strong>USDC is the gas token</strong>, so you only ever need USDC (no separate gas coin).
            </p>
            <Card>
              <AddArc />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <tbody className="mono">
                    <tr><td className="py-1 pr-4 text-slate-500">Network name</td><td className="py-1">Arc Testnet</td></tr>
                    <tr><td className="py-1 pr-4 text-slate-500">RPC URL</td><td className="py-1">https://rpc.testnet.arc.network</td></tr>
                    <tr><td className="py-1 pr-4 text-slate-500">Chain ID</td><td className="py-1">5042002</td></tr>
                    <tr><td className="py-1 pr-4 text-slate-500">Currency symbol</td><td className="py-1">USDC</td></tr>
                    <tr><td className="py-1 pr-4 text-slate-500">Block explorer</td><td className="py-1">https://testnet.arcscan.app</td></tr>
                    <tr><td className="py-1 pr-4 text-slate-500">USDC (ERC-20)</td><td className="py-1">{ARC_USDC}</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                The button uses your wallet&apos;s <code className="mono">wallet_addEthereumChain</code>; if it&apos;s unavailable, add the values above by hand.
                Need test USDC? Get it free from the{" "}
                <a className="text-indigo-300 hover:text-indigo-200" target="_blank" rel="noreferrer" href="https://faucet.circle.com">Circle faucet</a>{" "}
                (select Arc Testnet) — it covers both gas and purchases.
              </p>
            </Card>
          </section>

          {/* ─── REFERENCE ─── */}
          <div className="border-t border-slate-800 pt-6">
            <Pill text="Reference" tone="slate" />
          </div>

          <section className="space-y-3">
            <H id="ref-endpoints">Endpoints</H>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="text-slate-500">
                    <tr><th className="py-1 pr-4">Method</th><th className="py-1 pr-4">Path</th><th className="py-1">What</th></tr>
                  </thead>
                  <tbody className="mono">
                    <tr><td className="py-1 pr-4">POST</td><td className="py-1 pr-4">/api/v1/pieces</td><td className="py-1">register a piece (x-api-key)</td></tr>
                    <tr><td className="py-1 pr-4">GET</td><td className="py-1 pr-4">/api/v1/pieces</td><td className="py-1">browse catalog</td></tr>
                    <tr><td className="py-1 pr-4">GET</td><td className="py-1 pr-4">/api/v1/pieces/:id</td><td className="py-1">one piece</td></tr>
                    <tr><td className="py-1 pr-4">POST</td><td className="py-1 pr-4">/api/v1/pieces/:id/pay</td><td className="py-1">unlock content → split</td></tr>
                    <tr><td className="py-1 pr-4">POST</td><td className="py-1 pr-4">/api/v1/pieces/:id/call</td><td className="py-1">x402 pay-per-call (API)</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">tRPC equivalents: <code className="mono">pieces.list / get / create / unlock / callApi</code>, <code className="mono">traction.stats</code>, <code className="mono">agent.read</code>. MCP tools: <code className="mono">list_pieces, call_api, pay_for_piece</code>.</p>
            </Card>
          </section>

          <section className="space-y-3">
            <H id="ref-x402">x402 wire format</H>
            <Card>
              <ul className="space-y-2 text-sm text-slate-300">
                <li><strong className="text-slate-100">402 body</strong> — <code className="mono">{`{ x402Version, accepts:[ PaymentRequirements ] }`}</code></li>
                <li><strong className="text-slate-100">PaymentRequirements</strong> — <code className="mono">scheme:&quot;exact&quot;, network:&quot;arc-testnet&quot;, maxAmountRequired (atomic USDC), payTo, asset, nonce, resource, maxTimeoutSeconds</code></li>
                <li><strong className="text-slate-100">X-PAYMENT</strong> (request header, base64) — <code className="mono">{`{ x402Version, scheme, network, payload:{ nonce, from, authorization } }`}</code></li>
                <li><strong className="text-slate-100">X-PAYMENT-RESPONSE</strong> (response header, base64) — <code className="mono">{`{ success, transaction, network, payer }`}</code></li>
              </ul>
            </Card>
          </section>

          <section className="space-y-3">
            <H id="ref-network">Network &amp; modes</H>
            <Card>
              <ul className="space-y-1.5 text-sm text-slate-300">
                <li>Chain: <strong className="text-slate-100">Arc Testnet</strong> · id <code className="mono">5042002</code> · explorer <code className="mono">testnet.arcscan.app</code></li>
                <li>USDC (6-dp ERC-20): <code className="mono">{ARC_USDC}</code> — also Arc&apos;s native gas token</li>
                <li><strong className="text-slate-100">Mirror</strong> mode (default): keyless, simulated settlement. <strong className="text-slate-100">LIVE_X402</strong>: real USDC on Arc (funded relayer).</li>
              </ul>
            </Card>
          </section>

          <footer className="border-t border-slate-800 pt-6 text-xs text-slate-500">
            SplitStream · pay-per-use on Arc · x402 · cross-chain revenue splitting · no-KYC API access
          </footer>
        </div>
      </div>
    </main>
  );
}
