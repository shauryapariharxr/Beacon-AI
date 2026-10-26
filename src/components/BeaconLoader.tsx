"use client";

import type { CSSProperties } from "react";

/**
 * Loading indicator: the Beacon mark filling up like a vessel of liquid.
 *
 * How it's built: the whole assembly sits inside a container whose CSS mask
 * (the 512px logo PNG, alpha channel) clips EVERYTHING drawn within it to the
 * glyph silhouette. Inside that clip, a translucent amber "ghost" values the
 * empty vessel while a body of brand-amber "water" rises from the bottom,
 * carries two translating wave ellipses on its surface so the top edge never
 * shows a straight line, then drains and rises again in one loop. An
 * unmasked, blurred radial halo behind the stage breathes amber light while
 * the fill is high, reading as the beacon charging.
 *
 * Replaces the old aperture-arcs loader. One component so every loading
 * screen looks the same; `size` scales the stage, `label` is optional.
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
        className="beacon-liquid-stage"
        style={{ width: size, height: size, "--liquid-stage": `${size}px` } as CSSProperties}
        aria-hidden
      >
        {/* Unmasked glow: breathes behind the vessel, brightest as the fill rises. */}
        <div className="beacon-liquid-halo" />
        {/* Masked to the glyph: ghost vessel + rising liquid + waves. */}
        <div className="beacon-fill-vessel">
          <div className="beacon-fill-ghost" />
          <div className="beacon-fill-water">
            <div className="beacon-fill-wave beacon-fill-wave--back" />
            <div className="beacon-fill-wave beacon-fill-wave--front" />
          </div>
        </div>
      </div>
      {label && <span className="text-sm text-muted">{label}</span>}
    </div>
  );
}
