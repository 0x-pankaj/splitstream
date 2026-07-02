/** Creator login. Primary path is email + password (works instantly, no email
 *  provider needed). An email one-time-code path is offered as a fallback. On
 *  first signup a custodial Circle wallet on Arc is assigned automatically, so a
 *  creator can start earning with just an email: no MetaMask, no seed phrase, no KYC. */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, errorInfo, setCreatorToken } from "../../../lib/trpc";

type Mode = "password" | "code";
type PwTab = "login" | "signup";

export default function CreatorLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [pwTab, setPwTab] = useState<PwTab>("login");

  // Shared
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Password path
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");

  // Code path
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");

  const reset = () => {
    setError(null);
    setNote(null);
  };

  const finish = (token: string) => {
    setCreatorToken(token);
    router.push("/creator");
  };

  const login = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    reset();
    try {
      const res = await trpc.creator.login.mutate({ email: email.trim(), password });
      finish(res.token);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const signup = async () => {
    if (!email.trim() || password.length < 8) {
      setError("Enter an email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    reset();
    try {
      const res = await trpc.creator.signup.mutate({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        handle: handle.trim() || undefined,
      });
      finish(res.token);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) return;
    setBusy(true);
    reset();
    try {
      const res = await trpc.creator.requestOtp.mutate({ email: email.trim() });
      setStep("code");
      setNote(
        res.channel === "console"
          ? "Dev mode: your code was printed to the server console."
          : "We emailed you a 6-digit code. It expires in 10 minutes.",
      );
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    reset();
    try {
      const res = await trpc.creator.verifyOtp.mutate({
        email: email.trim(),
        code,
        displayName: displayName.trim() || undefined,
        handle: handle.trim() || undefined,
      });
      finish(res.token);
    } catch (e) {
      setError(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2";

  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">SplitStream</Link>
        <Link href="/" className="text-xs text-muted hover:text-ink">← storefront</Link>
      </header>

      <h1 className="text-xl font-semibold text-ink">Earn as a creator</h1>
      <p className="mt-1 text-sm text-muted">
        Sign up and we&apos;ll set up a USDC wallet on Arc for you automatically. Publish a piece, and
        every reader payment is split to your wallet instantly — withdraw any time.
      </p>

      {/* Method switch */}
      <div className="mt-6 flex gap-1 rounded-xl border border-line bg-surface p-1 text-xs font-semibold">
        <button
          onClick={() => { setMode("password"); reset(); }}
          className={`flex-1 rounded-lg px-3 py-2 ${mode === "password" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          Email &amp; password
        </button>
        <button
          onClick={() => { setMode("code"); reset(); }}
          className={`flex-1 rounded-lg px-3 py-2 ${mode === "code" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          Email me a code
        </button>
      </div>

      <div className="card mt-4 space-y-4 p-5">
        {mode === "password" ? (
          <>
            <div className="flex gap-4 text-sm font-semibold">
              <button
                onClick={() => { setPwTab("login"); reset(); }}
                className={pwTab === "login" ? "text-ink" : "text-muted hover:text-ink"}
              >
                Log in
              </button>
              <button
                onClick={() => { setPwTab("signup"); reset(); }}
                className={pwTab === "signup" ? "text-ink" : "text-muted hover:text-ink"}
              >
                Sign up
              </button>
            </div>

            <label className="block text-sm">
              <span className="text-ink3">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink3">Password <span className="text-faint">(8+ characters)</span></span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (pwTab === "login" ? login() : signup())}
                placeholder="••••••••"
                className={inputCls}
              />
            </label>

            {pwTab === "signup" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-ink3">Display name <span className="text-faint">(optional)</span></span>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ada Lovelace" className={inputCls} />
                </label>
                <label className="block text-sm">
                  <span className="text-ink3">Handle <span className="text-faint">(optional)</span></span>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="ada-lovelace"
                    className={`mono ${inputCls}`}
                  />
                </label>
              </div>
            ) : null}

            <button
              onClick={pwTab === "login" ? login : signup}
              disabled={busy || !email.trim() || password.length < 8}
              style={{ background: pwTab === "login" ? "#EE5126" : "#0E9D6E" }}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Working…" : pwTab === "login" ? "Log in" : "Create account & get a wallet"}
            </button>
          </>
        ) : step === "email" ? (
          <>
            <label className="block text-sm">
              <span className="text-ink3">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                placeholder="you@example.com"
                className={inputCls}
              />
            </label>
            <button
              onClick={sendCode}
              disabled={busy || !email.trim()}
              style={{ background: "#EE5126" }}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:bg-brandhover disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send me a code"}
            </button>
          </>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-ink3">6-digit code</span>
              <input
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                placeholder="123456"
                className="mono mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-lg tracking-[0.4em] text-ink2"
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink3">Display name <span className="text-faint">(new accounts)</span></span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ada Lovelace" className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="text-ink3">Handle <span className="text-faint">(optional)</span></span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="ada-lovelace"
                  className={`mono ${inputCls}`}
                />
              </label>
            </div>
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              style={{ background: "#0E9D6E" }}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button onClick={() => { setStep("email"); reset(); }} className="w-full text-xs text-muted hover:text-ink">
              ← use a different email
            </button>
          </>
        )}

        {note ? <div className="text-xs text-green">{note}</div> : null}
        {error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        ) : null}
      </div>
    </main>
  );
}
