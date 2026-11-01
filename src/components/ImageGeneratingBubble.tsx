"use client";

import { useState, useEffect } from "react";
import { BotAvatar } from "./BotAvatar";

/**
 * Floating-dot generation placeholder. The old version was a fixed dot
 * matrix under a sweeping sheen on an opaque near-black panel — the
 * backdrop read as a cheap terminal block against the chat surface. This
 * version drops the backdrop entirely (the dots sit straight on the
 * message bubble) and lets the dots drift and pulse individually, like a
 * tray of beads settling. Image generation takes 5–90s and streams no
 * visible progress, so this plus the corner % pill is the honest feedback
 * the user gets.
 */

const COLS = 12;
const ROWS = 8;

// Deterministic per-dot variance — Math.random() would render different
// markup on server and client (hydration mismatch). A cheap hash staggers
// duration, phase and size so the field never moves in lockstep.
function dotMeta(i: number) {
  return {
    dur: 2.8 + ((i * 7) % 30) / 10,        // 2.8s – 5.7s
    delay: -(((i * 13) % 46) / 10),        // negative phase offsets the start
    size: 3.5 + ((i * 3) % 4) * 0.75,      // 3.5px – 5.75px
    warm: i % 3 === 0,                      // every third dot leans amber
  };
}

// The levelling curve: fast at first (results often land in ~10s), then
// creeping toward 95% so the number never lies about completion — the pill
// disappears entirely the moment the real image streams in.
function tick(current: number, elapsedS: number): number {
  if (current >= 95) return 95;
  const step =
    elapsedS < 5 ? 7 :
    elapsedS < 15 ? 3 :
    elapsedS < 40 ? 1.5 :
    0.6;
  return Math.min(95, Math.round(current + step));
}

export function ImageGeneratingBubble() {
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
      aria-label="Generating an image"
    >
      <BotAvatar className="mt-0.5" />
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.10] bg-white/[0.02] p-3">
        <div
          className="image-dots-field"
          style={{
            width: "min(420px, calc(100vw - 120px))",
            aspectRatio: `${COLS} / ${ROWS}`,
          }}
        >
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
          <span className="text-xs text-muted">
            Creating your image…
          </span>
          <span className="ml-auto pill-progress font-mono text-[11px] text-lamp tabular-nums">
            {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}
