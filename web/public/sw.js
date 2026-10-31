// Infoto Service Worker — offline browsing for the SPA and already-loaded media.
//
// Strategy:
//   - Navigation requests (/ and /admin) -> index.html from the cache, so the shell loads
//     fully offline. The app then hydrates from its IndexedDB snapshot (last full sync).
//   - Static assets (JS/CSS) -> cache-first; fall back to network, then cache.
//   - Media proxy (/l/:id36) -> network-first; media responses already carry
//     Cache-Control: immutable from the Worker, so the browser's HTTP cache serves them
//     offline once loaded. No SW buffering of large bodies.
//   - API requests (/ws, /l/*, /admin/*) -> network-only, no caching. Offline, queued ops stay
//     in IndexedDB until the next online sync; no SW buffering of dynamic bodies.
const SHELL = '/index.html';
const ASSET_CACHE = 'infoto-assets-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(ASSET_CACHE)
      .then((cache) => cache.add([SHELL, '/', '/admin']))
      .then(() => self.skipWaiting()),
  );
});

// A new version takes over immediately and prunes caches from older ones; assets are
// content-hashed, so a replaced cache never serves a stale mix.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== ASSET_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const { pathname } = url;

  // Same-origin only; let cross-origin media hit its own cache directly.
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the SPA shell from cache (offline-first shell).
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match(SHELL).then((cached) => cached ?? fetch(event.request)));
    return;
  }

  // Static assets served by wrangler [assets]: cache-first with network refresh.
  if (pathname.startsWith('/assets/') || pathname.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached ?? fetch(event.request).then((resp) => {
          const copy = resp.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy));
          return resp;
        }),
      ),
    );
    return;
  }

  // Everything else (API requests): network-only, no caching.
  event.respondWith(fetch(event.request));
});
