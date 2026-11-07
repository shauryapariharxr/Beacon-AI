"use client";

import { useState, useEffect } from "react";
import { BotAvatar } from "./BotAvatar";

/**
 * Document-generation placeholder. Reuses the floating-dot field the image
 * feature used (the classes live in globals.css), but the backdrop panel is
 * gone — the dots sit on the message bubble, and the paper outline pulses
 * behind them so the wait reads as "a page is being laid out", not a black
 * terminal block. Drafting + rendering can take 10–90s with no visible
 * progress, so this plus the corner % pill is the honest feedback the user
 * gets until the real file card streams in.
 */

const COLS = 12;
const ROWS = 8;

// Deterministic per-dot variance — Math.random() would render different
// markup on server and client (hydration mismatch). A cheap hash staggers
// duration, phase and size so the field never moves in lockstep.
function dotMeta(i: number) {
  return {
    dur: 2.8 + ((i * 7) % 30) / 10,
    delay: -(((i * 13) % 46) / 10),
    size: 3.5 + ((i * 3) % 4) * 0.75,
    warm: i % 3 === 0,
  };
}

// Levelling curve mirrors the old image bubble: quick early steps, then a
// crawl toward 95% so the number never lies about completion.
function tick(current: number, elapsedS: number): number {
  if (current >= 95) return 95;
  const step =
    elapsedS < 5 ? 6 :
    elapsedS < 15 ? 2.5 :
    elapsedS < 40 ? 1.2 :
    0.5;
  return Math.min(95, Math.round(current + step));
}

export function DocumentGeneratingBubble() {
  const [percent, setPercent] = useState(3);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      setPercent((p) => tick(p, elapsed));
    }, 900);
    return () => window.clearInterval(id);
  }, []);

  const dots = Array.from({ length: COLS * ROWS }, (_, i) => ({ i, ...dotMeta(i) }));

  return (
    <div
      className="flex justify-start items-start gap-2.5 animate-msg-in"
      aria-live="polite"
      aria-label="Generating a document"
    >
      <BotAvatar className="mt-0.5" />
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.10] bg-white/[0.02] p-3">
        <div
          className="doc-dots-field relative rounded-xl border border-white/[0.08]"
          style={{
            width: "min(420px, calc(100vw - 120px))",
            aspectRatio: `${COLS} / ${ROWS}`,
          }}
        >
          {/* Paper-sheet shimmer: a soft column sweep behind the dots. */}
          <div className="doc-sheet-shine" />
          {dots.map(({ i, dur, delay, size, warm }) => (
            <span
              key={i}
              className="image-dots-dot"
              style={{
                width: size,
                height: size,
                background: warm ? "rgba(255, 205, 130, 0.85)" : "rgba(232, 163, 61, 0.85)",
                animationDuration: `${dur.toFixed(2)}s`,
                animationDelay: `${delay.toFixed(2)}s`,
              }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2 px-1">
          <span className="text-xs text-muted">Creating your document…</span>
          <span className="ml-auto pill-progress font-mono text-[11px] text-lamp tabular-nums">
            {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}
