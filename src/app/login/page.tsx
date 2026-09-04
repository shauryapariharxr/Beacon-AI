"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex items-center justify-center h-screen px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-panel border border-border rounded-2xl p-6 space-y-4">
        <div className="font-serif text-2xl mb-2">Log in</div>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-panel2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-panel2 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
        />
        <button
          disabled={loading}
          className="w-full bg-lamp text-[#1a1204] font-medium rounded-lg py-2 disabled:opacity-40"
        >
          {loading ? "Logging in..." : "Log in"}
        </button>
        <div className="text-sm text-muted text-center">
          No account?{" "}
          <Link href="/signup" className="text-lamp hover:underline">
            Sign up
          </Link>
        </div>
      </form>
    </div>
  );
}
