"use client";

import { useState, useEffect } from "react";
import { BotAvatar } from "./BotAvatar";

/**
 * Dot-matrix generation placeholder — the Beacon take on ChatGPT's image
 * splash: a breathing grid of lamp-colored dots while the model paints, with
 * a progress pill ticking in the corner. Image generation takes 5–90s and
 * streams no visible progress, so this is the honest feedback the user gets
 * instead of an empty bubble.
 */

const COLS = 14;
const ROWS = 10;

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

  const dots = Array.from({ length: COLS * ROWS });

  return (
    <div
      className="flex justify-start items-start gap-2.5 animate-msg-in"
      aria-live="polite"
      aria-label="Generating an image"
    >
      <BotAvatar className="mt-0.5" />
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.10] bg-white/[0.02] p-3">
        <div
          className="rounded-xl overflow-hidden bg-[#05080f]"
          style={{
            width: `min(420px, calc(100vw - 120px))`,
            aspectRatio: `${COLS} / ${ROWS}`,
            // Dots laid out on a grid background: no DOM nodes, zero repaints.
            backgroundImage: "radial-gradient(circle, rgba(232,163,61,0.85) 1.1px, transparent 1.3px)",
            backgroundSize: `${(100 / COLS).toFixed(3)}% ${(100 / ROWS).toFixed(3)}%`,
            backgroundPosition: "center",
          }}
        >
          <div className="w-full h-full image-gen-shimmer" />
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
