// Infoto Service Worker — offline browsing for the SPA and previously loaded media.
//
// Strategy:
//   - Navigation requests (/ and /admin) -> index.html from the cache, so the shell loads
//     fully offline. The app then hydrates from its IndexedDB snapshot (last full sync).
//   - Static assets (JS/CSS) -> cache-first; fall back to network, then cache.
//   - Cross-origin media -> cache-first, including opaque no-CORS responses. Range requests
//     are fetched as full GETs so the cache holds a complete file for offline playback.
//   - Same-origin API requests (/ws, /l/*, /admin/*) -> network-only. Offline, queued ops stay
//     in IndexedDB until the next online sync.
const SHELL = '/index.html';
const ASSET_CACHE = 'infoto-assets-v1';
const MEDIA_CACHE = 'infoto-media-v1';
const MEDIA_DESTINATIONS = new Set(['image', 'video', 'audio']);
const mediaFetches = new Map();

function mediaCacheKey(request) {
  return new Request(request.url);
}

function fullMediaRequest(request) {
  if (!request.headers.has('range')) return request;
  const headers = new Headers(request.headers);
  headers.delete('range');
  return new Request(request, { headers, mode: 'no-cors', credentials: 'omit' });
}

function cacheableMedia(response) {
  // Cross-origin no-CORS responses are opaque (status 0); Cache.put supports them.
  return response.type === 'opaque' || (response.ok && response.status === 200);
}

function fetchAndCacheMedia(request, cache, key) {
  const url = request.url;
  let pending = mediaFetches.get(url);
  if (pending) return pending;

  pending = fetch(fullMediaRequest(request)).then((response) => {
    let cacheWrite = Promise.resolve();
    if (cacheableMedia(response)) {
      cacheWrite = cache.put(key, response.clone()).catch((error) => {
        console.warn('[sw] media cache write failed', url, error);
      });
    }
    return { response, cacheWrite };
  });
  mediaFetches.set(url, pending);
  void pending
    .then(({ cacheWrite }) => cacheWrite, () => undefined)
    .finally(() => {
      if (mediaFetches.get(url) === pending) mediaFetches.delete(url);
    });
  return pending;
}

async function mediaResponse(request) {
  const key = mediaCacheKey(request);
  let cache;
  try {
    cache = await caches.open(MEDIA_CACHE);
  } catch (error) {
    console.warn('[sw] media cache unavailable', request.url, error);
    return { response: await fetch(fullMediaRequest(request)), cacheWrite: Promise.resolve() };
  }

  try {
    const cached = await cache.match(key);
    if (cached) return { response: cached, cacheWrite: Promise.resolve() };
  } catch (error) {
    console.warn('[sw] media cache read failed', request.url, error);
  }

  try {
    const result = await fetchAndCacheMedia(request, cache, key);
    return { response: result.response.clone(), cacheWrite: result.cacheWrite };
  } catch (error) {
    try {
      const cached = await cache.match(key);
      if (cached) return { response: cached, cacheWrite: Promise.resolve() };
    } catch (cacheError) {
      console.warn('[sw] media cache fallback read failed', request.url, cacheError);
    }
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(ASSET_CACHE)
      .then((cache) => cache.add([SHELL, '/', '/admin']))
      .then(() => self.skipWaiting()),
  );
});

// A new version takes over immediately and prunes obsolete caches. The media cache has a
// stable name so deploys preserve offline copies; album media URLs are immutable.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== ASSET_CACHE && key !== MEDIA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const { pathname } = url;

  if (url.origin !== self.location.origin) {
    if (!MEDIA_DESTINATIONS.has(event.request.destination)) return;
    const result = mediaResponse(event.request);
    event.respondWith(result.then(({ response }) => response));
    event.waitUntil(result.then(({ cacheWrite }) => cacheWrite).catch(() => undefined));
    return;
  }

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
