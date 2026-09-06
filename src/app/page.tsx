"use client";

import Link from "next/link";
import Image from "next/image";
import { ChatWindow } from "@/components/ChatWindow";
import { MODELS } from "@/lib/models";

const FEATURES = [
  {
    title: "No signup to start",
    body: "Open Beacon and ask your first question immediately. No email verification, no password, nothing between you and an answer.",
  },
  {
    title: "History that sticks around",
    body: "Create a free account whenever you want your conversations saved and organized in a sidebar, so nothing gets lost between study sessions.",
  },
  {
    title: "Three ways of thinking",
    body: "Zap for quick facts, Sage for harder reasoning, Forge for code — switch mid-conversation depending on what the problem actually needs.",
  },
  {
    title: "Answers in your language",
    body: "Ask in English, Roman Urdu, or Urdu script. The whole interface — not just the chat — switches with you.",
  },
  {
    title: "Streamed, not delayed",
    body: "Responses appear token by token as they're generated, so you're reading while the model is still thinking, not staring at a spinner.",
  },
  {
    title: "Built for late nights",
    body: "A dark, low-glare interface with a warm accent, designed to be easy on the eyes a few hours into a study session.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Ask anything",
    body: "Type a question the moment you land on the page — Zap is ready with no setup required.",
  },
  {
    n: "02",
    title: "Switch modes as needed",
    body: "Hit a harder proof or a stubborn bug? Swap to Sage or Forge from the same dropdown, mid-conversation.",
  },
  {
    n: "03",
    title: "Save it for later",
    body: "Sign up whenever you want the conversation kept — it'll be waiting in your sidebar next time you're back.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 flex justify-center pt-3 px-3">
        <div className="glass w-full max-w-5xl rounded-2xl px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="" width={26} height={26} />
            <span className="font-serif text-lg tracking-tight">Beacon</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted">
            <a href="#demo" className="hover:text-ink transition-colors">Try it</a>
            <a href="#models" className="hover:text-ink transition-colors">Models</a>
            <a href="#how-it-works" className="hover:text-ink transition-colors">How it works</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-muted hover:text-ink transition-colors">
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-sm bg-lamp text-[#1a1204] font-medium px-3.5 py-1.5 rounded-lg hover:bg-lamp/90 transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-3xl mx-auto px-4 pt-16 md:pt-24 pb-12 text-center">
          <h1 className="font-serif text-4xl md:text-5xl leading-tight text-ink">
            Your late-night study companion.
            <br />
            <span className="text-lamp">It&apos;s called Beacon.</span>
          </h1>
          <p className="mt-5 text-muted text-lg max-w-xl mx-auto">
            Ask a question and get an answer immediately — no account needed.
            Sign up later if you want your conversations saved.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#demo"
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-lamp text-[#1a1204] font-medium hover:bg-lamp/90 transition-colors"
            >
              Try it below
            </a>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl glass text-ink hover:bg-white/[0.07] transition-colors"
            >
              Create a free account
            </Link>
          </div>
        </section>

        {/* Live demo — this is the real app, not a scripted mockup */}
        <section id="demo" className="max-w-3xl mx-auto px-4 pb-20 scroll-mt-20">
          <div className="glass-strong rounded-2xl overflow-hidden">
            <div className="h-11 px-4 flex items-center justify-between border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                <span className="ml-2 font-mono text-xs text-muted">beacon — live, not a demo recording</span>
              </div>
            </div>
            <div className="h-[520px]">
              <ChatWindow isAuthed={false} />
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="font-serif text-2xl md:text-3xl text-center text-ink mb-10">
            Everything you need, nothing to configure
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="glass rounded-2xl p-6">
                <h3 className="font-medium text-ink mb-2">{f.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Models */}
        <section id="models" className="max-w-5xl mx-auto px-4 py-16 scroll-mt-20">
          <h2 className="font-serif text-2xl md:text-3xl text-center text-ink mb-10">
            Three modes, one conversation
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(MODELS).map(([key, m]) => (
              <div key={key} className="glass rounded-2xl p-6 flex flex-col">
                <span className="font-serif text-xl text-lamp mb-2">{m.label}</span>
                <p className="text-sm text-muted leading-relaxed flex-1">{m.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="max-w-4xl mx-auto px-4 py-16 scroll-mt-20">
          <h2 className="font-serif text-2xl md:text-3xl text-center text-ink mb-10">
            Three steps to get started
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center md:text-left">
                <div className="w-10 h-10 rounded-full glass flex items-center justify-center font-mono text-sm text-lamp mx-auto md:mx-0 mb-3">
                  {s.n}
                </div>
                <h3 className="font-medium text-ink mb-1.5">{s.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="max-w-3xl mx-auto px-4 py-20 text-center">
          <div className="glass-strong rounded-2xl px-8 py-12">
            <h2 className="font-serif text-2xl md:text-3xl text-ink mb-3">
              Ready when you are.
            </h2>
            <p className="text-muted mb-7">No card, no waitlist — just scroll back up and ask.</p>
            <a
              href="#demo"
              className="inline-flex items-center justify-center h-11 px-7 rounded-xl bg-lamp text-[#1a1204] font-medium hover:bg-lamp/90 transition-colors"
            >
              Start studying
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] py-6">
        <div className="max-w-5xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={16} height={16} className="opacity-70" />
            <span>Beacon</span>
          </div>
          <span>Built for late-night studying.</span>
        </div>
      </footer>
    </div>
  );
}
