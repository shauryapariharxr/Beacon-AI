/* Beacon service worker — what makes the site installable as a desktop app.
 *
 * Scope: root. Registered by src/components/PWARegister.tsx.
 *
 * Strategy, deliberately conservative for a chat app that streams answers:
 *   - /api/** is never touched — chat answers stream through it live.
 *   - Same-origin GET static assets (_next/static, images, icons): cache-first.
 *     Those have hashed filenames, so cache-first is always correct.
 *   - Navigations (page loads): network-first, remembering the last good page
 *     so an installed app with no connection opens into the app instead of a
 *     dinosaur error.
 */

const VERSION = "beacon-v1";
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
      // Drop every cache this version doesn't own, so an emptied cache name
      // change is all it takes to ship fresh offline behavior.
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

  // Everything else with a hashed or static path is stable: cache-first.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
