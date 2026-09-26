"use client";

import type { CSSProperties } from "react";

/**
 * Loading indicator: the Beacon mark on its amber disc, held steady in the
 * centre, while three amber arcs "breathe" around it — expanding apart,
 * rotating half a turn, then merging back into the disc (the classic
 * conic-gradient aperture loader, recoloured to Beacon amber). The keyframes
 * live in globals.css under `beacon-breathe`.
 *
 * Replaces the old three bouncing dots. Used by the dashboard loading state
 * and the signup flow. One component so every loading screen looks the same;
 * `size` scales the whole assembly (the CSS reads it via --loader-size),
 * `label` is optional.
 */
export function BeaconLoader({
  size = 64,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-5" role="status" aria-live="polite">
      <div
        className="beacon-loader flex items-center justify-center"
        style={{ width: size, height: size, "--loader-size": `${size}px` } as CSSProperties}
      >
        {/* The mark itself: amber gradient disc + knocked-out glyph (the same
            treatment as the chat avatar), painted above the arcs so they
            never slice across it. When the arcs merge into their disc phase
            they visually become the rim of this circle. */}
        <div
          className="beacon-loader-core flex items-center justify-center rounded-full bg-gradient-to-br from-[#f9d976] via-[#f0b429] to-[#c9750a] ring-1 ring-black/15 shadow-[0_1px_6px_rgba(0,0,0,0.45)]"
          style={{ width: "54%", height: "54%" }}
        >
          <img
            src="/logo.svg"
            alt=""
            className="w-[52%] h-[52%]"
            style={{ filter: "brightness(0) saturate(100%)", opacity: 0.82 }}
          />
        </div>
      </div>
      {label && <span className="text-sm text-muted">{label}</span>}
    </div>
  );
}
