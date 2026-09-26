"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff, MessageCircle, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import {
  firebaseEmailPasswordIdToken,
  firebaseGithubIdToken,
  firebaseGoogleIdToken,
  firebaseSendPasswordReset,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { GithubButton, GoogleButton } from "@/components/AuthProviderButtons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [useFirebase, setUseFirebase] = useState(isFirebaseConfigured);
  const [googleReady, setGoogleReady] = useState(isFirebaseConfigured);

  useEffect(() => {
    // The server may intentionally fall back to legacy auth (e.g. service
    // account not set) even when the client config exists — respect that.
    fetch("/api/auth/login", { method: "OPTIONS" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.firebaseConfigured === "boolean") {
          setUseFirebase(d.firebaseConfigured && isFirebaseConfigured);
          setGoogleReady(d.firebaseConfigured && isFirebaseConfigured);
        }
      })
      .catch(() => {});
  }, []);

  /** Exchange a Firebase ID token for a Beacon session cookie. */
  async function exchangeToken(idToken: string): Promise<boolean> {
    const res = await fetch("/api/auth/firebase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    setError(data.error || "Sign-in failed");
    return false;
  }

  /**
   * True when the browser holds a VALID user session. Used to break the
   * Back/Forward loop: browser history caches the login page, so after
   * signing in, Back landed on a login form while the user was still logged
   * in (and Forward then re-entered the dashboard "without login"). When we
   * detect an existing session we replace the history entry — Back/Forward
   * can no longer land on a stale login page at all.
   */
  async function userSessionActive(): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data?.user);
    } catch {
      return false;
    }
  }

  const sessionCheckRef = useRef(false);
  useEffect(() => {
    if (sessionCheckRef.current) return;
    sessionCheckRef.current = true;
    (async () => {
      if (await userSessionActive()) {
        // Already signed in: this login page is a stale history entry.
        // replace() so neither Back nor Forward returns here.
        router.replace("/dashboard");
      }
    })();
  }, [router]);

  /**
   * Send the visitor where they belong. Only the admin PASSWORD login may
   * route to /admin — and only when the server itself says `admin: true` for
   * THIS response. Provider logins (Google/GitHub) pass `false` explicitly:
   * they can never be admin logins, so an `admin_session` cookie merely
   * lingering in the browser (e.g. the operator was last in the panel) must
   * not drag a normal Google user into the admin dashboard.
   */
  async function goAfterLogin(explicitAdmin: boolean) {
    router.push(explicitAdmin ? "/admin" : "/dashboard");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    if (useFirebase) {
      // Firebase-first: authenticate with Firebase, then exchange the ID
      // token for the app's own session cookie.
      try {
        const idToken = await firebaseEmailPasswordIdToken(email.trim(), password);
        const ok = await exchangeToken(idToken);
        if (ok) {
          // A Firebase password login is a USER login by definition — the
          // admin identity never lives in Firebase, so this is never /admin.
          await goAfterLogin(false);
          return;
        }
      } catch (err: any) {
        // Legacy accounts have no Firebase mirror until their first login —
        // retry once against the original endpoint (which provisions the
        // mirror on success, so next time the Firebase path works).
        const fbCode = typeof err?.code === "string" ? err.code : "";
        const maybeLegacy = [
          "user-not-found",
          "invalid-credential",
          "wrong-password",
          // The admin's address is operator-chosen and often isn't a valid
          // email to Firebase (e.g. an internal pseudo-domain), so this must
          // fall through too or the admin could never reach the panel.
          "invalid-email",
          "configuration-not-found",
          "operation-not-allowed",
          "invalid-api-key",
          "network-request-failed",
        ].includes(fbCode);
        if (maybeLegacy) {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            await goAfterLogin(Boolean(data.admin));
            return;
          }
          setError(data.error || "Login failed");
          setLoading(false);
          return;
        }
        setError(err?.message || "Login failed");
      }
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      await goAfterLogin(Boolean(data.admin));
      return;
    }
    setError(data.error || "Login failed");
  }

  async function providerSignIn(getToken: () => Promise<string>) {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const idToken = await getToken();
      if (await exchangeToken(idToken)) await goAfterLogin(false);
    } catch (err: any) {
      setError(err?.message || "Sign-in failed");
    }
    setLoading(false);
  }

  async function forgotPassword() {
    setError(null);
    setInfo(null);
    const clean = email.trim();
    if (!clean || !clean.includes("@")) {
      setError("Type your email above first, then tap 'Forgot password?'");
      return;
    }
    setResetLoading(true);
    try {
      await firebaseSendPasswordReset(clean);
      setInfo(`Password reset email sent to ${clean}. Check your inbox (and spam).`);
    } catch (err: any) {
      setError(err?.message || "Couldn't send the reset email");
    }
    setResetLoading(false);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 gap-8">
      {/* Way home when you landed here by accident. The card's own "Continue
          without account" goes to chat; this goes to the landing page.
          Pinned to the viewport's top-left corner, clear of the centered card. */}
      <Link
        href="/"
        className="fixed top-4 z-10 flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors animate-fade-up bg-bg/80 rounded-lg px-2 py-1"
        style={{ left: "max(1rem, env(safe-area-inset-left))" }}
      >
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span>Back to home</span>
      </Link>

      <div className="text-center animate-fade-up" style={{ animationDelay: "60ms" }}>
        <h1 className="font-serif font-bold text-4xl text-ink">Welcome back</h1>
        <p className="text-muted mt-2">Continue where you left off.</p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-2xl p-6 space-y-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
        {error && <div className="text-sm text-red-400 animate-toast-in">{error}</div>}
        {info && (
          <div className="text-sm text-green-400 animate-toast-in flex items-start gap-1.5">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{info}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm text-muted">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="email"
              required
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted">Password</label>
            {googleReady && (
              <button
                type="button"
                onClick={forgotPassword}
                disabled={resetLoading}
                className="text-xs text-muted hover:text-lamp transition-colors disabled:opacity-50"
              >
                {resetLoading ? "Sending…" : "Forgot password?"}
              </button>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold rounded-xl py-2.5 disabled:opacity-40 hover:brightness-105 transition-all"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "Signing in..." : "Sign In"}
        </button>

        {googleReady && (
          <>
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-muted">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <div className="space-y-2">
              <GoogleButton onClick={() => providerSignIn(firebaseGoogleIdToken)} disabled={loading} />
              <GithubButton onClick={() => providerSignIn(firebaseGithubIdToken)} disabled={loading} />
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-muted">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <Link
          href="/chat"
          className="w-full flex items-center justify-center gap-2 border border-white/10 rounded-xl py-2.5 text-sm text-muted hover:text-ink hover:bg-white/[0.04] transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Continue without account
        </Link>
      </form>

      {/* Matches the wording of the same call to action on the landing page,
          rather than a second, different label for the same destination. */}
      <div className="text-sm text-muted animate-fade-up" style={{ animationDelay: "200ms" }}>
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-lamp font-medium rounded underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lamp"
        >
          Create a free account
        </Link>
      </div>
    </div>
  );
}
