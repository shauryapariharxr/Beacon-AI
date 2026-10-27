/* Beacon service worker — what makes the site installable as a desktop app.
 *
 * Scope: root. Registered by src/components/PWARegister.tsx.
 *
 * Strategy, deliberately conservative for a chat app that streams answers:
 *   - /api/** and RSC flight payloads (?_rsc=) are never intercepted — chat
 *     answers stream through /api live, and flight data must always match
 *     the HTML that hydrates it.
 *   - Navigations (page loads): network-first, remembering the last good page
 *     so an installed app with no connection opens into the app instead of a
 *     dinosaur error.
 *   - Application code under /_next/ (chunks, CSS): NETWORK-FIRST — never
 *     served from cache while the network is up. Dev chunk filenames don't
 *     change between builds (only their contents), and a cached copy drifting
 *     out of sync with fresh server HTML is exactly what "hydration failed"
 *     overlays are made of. The cache copy exists only to keep offline
 *     launches working.
 *   - Images, icons and the manifest: cache-first (rarely change; hashed or
 *     regenerable).
 */

const VERSION = "beacon-v6";
const ASSET_CACHE = `${VERSION}-assets`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.addAll([
        "/pwa-icon-192.png",
        "/pwa-icon-512.png",
        "/pwa-icon-maskable-512.png",
        "/manifest.webmanifest",
      ]),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache this version doesn't own, so a cache-name bump is
      // all it takes to purge stale chunks/pages from older versions.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // POSTs (sign-in, chat, save) never get cached, replayed, or intercepted.
  // Never touch /api either — responses there stream.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // RSC/flight payloads MUST go to the network and never be cached: a cached
  // flight tree rendered against a fresh document is an instant mismatch.
  if (url.searchParams.has("_rsc")) return;

  // Never cache requests that carry a cache-busting query (?v=…): in dev the
  // timestamp changes on every rebuild, so caching each variant just grows
  // the cache with copies that are instantly out of date.
  const bustable = url.searchParams.has("v");

  if (req.mode === "navigate") {
    // Network-first with a remember-the-last-good-page fallback.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { cacheName: PAGE_CACHE }).then(
            (hit) =>
              hit ??
              new Response("<h1>Offline</h1><p>Beacon will reconnect automatically.</p>", {
                status: 503,
                headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
              }),
          ),
        ),
    );
    return;
  }

  // Application code: network-first, cache as the offline fallback only.
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !bustable) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req, { cacheName: ASSET_CACHE })
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  // Images, icons, fonts, manifest and other stable public files: cache-first.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && !bustable) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
