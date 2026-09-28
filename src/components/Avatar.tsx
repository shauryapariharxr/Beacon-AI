"use client";

/**
 * The signed-in user's avatar everywhere: the synced Google/GitHub profile
 * photo when one exists (synced at `/api/auth/firebase` on each provider
 * sign-in), otherwise the amber disc with the first letter.
 *
 * The photo is remote (Google's / GitHub's CDN), so plain <img> is used —
 * next/image would need each provider's domain allow-listed in
 * next.config.mjs and re-optimizes on every render. onError falls back to
 * the initial if the CDN URL ever stops resolving.
 */
export function Avatar({
  url,
  name,
  size = 32,
  className = "",
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = ((name && name.trim()) || "?")[0].toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-lamp/90 text-[#1a1204] font-semibold overflow-hidden align-middle ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="absolute inset-0 z-10 w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      {/* The initial sits UNDER the photo (z-order below): visible when no
          URL or on error, always the correct fallback without extra state. */}
      <span className="relative">{initial}</span>
      {url ? <span className="absolute inset-0 z-20 rounded-full ring-1 ring-black/15" /> : null}
    </span>
  );
}
