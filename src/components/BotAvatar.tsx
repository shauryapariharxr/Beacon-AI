"use client";

/**
 * The Beacon mark as a chat avatar: the logo's own amber gradient as a filled
 * circle, with the glyph knocked out in near-black on top of it.
 *
 * The logo asset is already an amber gradient, so it can't simply be dropped
 * on an amber circle — it would vanish. `brightness(0)` paints the glyph solid
 * black while preserving its alpha, which is what gives the flatter, stamped
 * look the chat mock uses. One component so the message list, the "thinking"
 * indicator and the empty state can never drift apart again.
 */
export function BotAvatar({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 rounded-full bg-gradient-to-br from-[#f9d976] via-[#f0b429] to-[#c9750a] flex items-center justify-center ring-1 ring-black/15 shadow-[0_1px_6px_rgba(0,0,0,0.45)] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src="/logo.svg"
        alt=""
        className="w-[52%] h-[52%]"
        style={{ filter: "brightness(0) saturate(100%)", opacity: 0.82 }}
      />
    </div>
  );
}
