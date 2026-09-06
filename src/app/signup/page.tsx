"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Signup failed");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen px-4 gap-6">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/logo.svg" alt="" width={28} height={28} />
        <span className="font-serif text-xl">Beacon</span>
      </Link>
      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-2xl p-6 space-y-4">
        <div className="font-serif text-2xl mb-2">Create your account</div>
        <p className="text-sm text-muted -mt-2">This starter skips email verification to keep setup simple — see the README to add it back.</p>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
        />
        <button
          disabled={loading}
          className="w-full bg-lamp text-[#1a1204] font-medium rounded-lg py-2 disabled:opacity-40 hover:bg-lamp/90 transition-colors"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
        <div className="text-sm text-muted text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-lamp hover:underline">
            Log in
          </Link>
        </div>
      </form>
    </div>
  );
}
