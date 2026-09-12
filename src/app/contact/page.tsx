"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, User, MessageSquare, MailCheck } from "lucide-react";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 gap-8">
      <div className="text-center animate-fade-up">
        <h1 className="font-serif font-bold text-4xl text-ink">Contact Beacon</h1>
        <p className="text-muted mt-2 max-w-sm">
          Found a bug, want to file a complaint, or just say hi? Your message goes
          straight to the developer&apos;s inbox.
        </p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-2xl p-6 space-y-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
        {sent ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-14 h-14 rounded-full bg-lamp/10 border border-lamp/30 flex items-center justify-center">
              <MailCheck className="w-7 h-7 text-lamp" />
            </div>
            <h2 className="font-serif font-bold text-2xl text-ink">Message sent</h2>
            <p className="text-muted text-sm">
              Thanks {name.split(" ")[0] || "for reaching out"} — you&apos;ll get a reply at{" "}
              <span className="text-ink">{email}</span>.
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center justify-center h-10 px-5 rounded-xl bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold hover:brightness-105 transition-all text-sm"
            >
              Back to home
            </Link>
          </div>
        ) : (
          <>
            {error && <div className="text-sm text-red-400 animate-toast-in">{error}</div>}

            <div className="space-y-1.5">
              <label className="text-sm text-muted">Your name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                  type="text"
                  required
                  maxLength={100}
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-muted">Your email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                  type="email"
                  required
                  placeholder="So I can reply to you"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-muted">Message</label>
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-muted" />
                <textarea
                  required
                  maxLength={4000}
                  rows={5}
                  placeholder="What's on your mind?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-lamp resize-none"
                />
              </div>
            </div>

            <button
              disabled={loading}
              className="w-full bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold rounded-xl py-2.5 disabled:opacity-40 hover:brightness-105 transition-all"
            >
              {loading ? "Sending..." : "Send message"}
            </button>

            <Link
              href="/"
              className="w-full flex items-center justify-center gap-2 border border-white/10 rounded-xl py-2.5 text-sm text-muted hover:text-ink hover:bg-white/[0.04] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </Link>
          </>
        )}
      </form>
    </div>
  );
}
