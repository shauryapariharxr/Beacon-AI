"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff, MessageCircle, User, Loader2 } from "lucide-react";
import {
  firebaseGithubIdToken,
  firebaseGoogleIdToken,
  firebaseSignUpIdToken,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { GithubButton, GoogleButton } from "@/components/AuthProviderButtons";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(isFirebaseConfigured);

  useEffect(() => {
    fetch("/api/auth/login", { method: "OPTIONS" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.firebaseConfigured === "boolean") {
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
    setError(data.error || "Signup failed");
    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (googleReady) {
      // Firebase path: create the Firebase account first, then exchange the
      // ID token for the app session (the server stores the name too).
      setLoading(true);
      try {
        const idToken = await firebaseSignUpIdToken(name.trim(), email.trim(), password);
        if (await exchangeToken(idToken)) {
          router.push("/dashboard");
          return;
        }
      } catch (err: any) {
        setError(err?.message || "Signup failed");
      }
      setLoading(false);
      return;
    }

    // Legacy path (Firebase not configured): original API call.
    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error || "Signup failed");
      return;
    }
    router.push("/dashboard");
  }

  async function providerSignIn(getToken: () => Promise<string>) {
    setError(null);
    setLoading(true);
    try {
      const idToken = await getToken();
      if (await exchangeToken(idToken)) router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Sign-in failed");
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 gap-8">
      <div className="text-center animate-fade-up">
        <h1 className="font-serif font-bold text-4xl text-ink">Create your account</h1>
        <p className="text-muted mt-2">Free, no card. Save your chats forever.</p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-2xl p-6 space-y-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
        {error && <div className="text-sm text-red-400 animate-toast-in">{error}</div>}

        <div className="space-y-1.5">
          <label className="text-sm text-muted">Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              required
              maxLength={60}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
            />
          </div>
        </div>

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
          <label className="text-sm text-muted">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              placeholder="At least 8 characters"
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
          {loading ? "Creating account..." : "Sign Up"}
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

      <div className="text-sm text-muted animate-fade-up" style={{ animationDelay: "200ms" }}>
        Already have an account?{" "}
        <Link href="/login" className="text-lamp font-medium hover:underline">
          Log in
        </Link>
      </div>
    </div>
  );
}
