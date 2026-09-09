"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff, MessageCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 gap-8">
      <div className="text-center">
        <h1 className="font-serif font-bold text-4xl text-ink">Welcome back</h1>
        <p className="text-muted mt-2">Continue where you left off.</p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-2xl p-6 space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}

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
            <button
              type="button"
              className="text-xs text-lamp hover:underline"
              title="Password reset isn't implemented yet"
            >
              Forgot password?
            </button>
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
          className="w-full bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold rounded-xl py-2.5 disabled:opacity-40 hover:brightness-105 transition-all"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>

        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-muted">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <Link
          href="/"
          className="w-full flex items-center justify-center gap-2 border border-white/10 rounded-xl py-2.5 text-sm text-muted hover:text-ink hover:bg-white/[0.04] transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Continue without account
        </Link>
      </form>

      <div className="text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-lamp font-medium hover:underline">
          Create one
        </Link>
      </div>
    </div>
  );
}
