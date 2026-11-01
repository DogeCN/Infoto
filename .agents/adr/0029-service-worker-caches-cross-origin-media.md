# 0029: The service worker caches cross-origin media for offline browsing

- **Date**: 2026-11-01
- **Status**: Accepted
- **Context**: The app shell and album snapshot already work offline, but media URLs point
  directly to an external host. Routing them through the album Worker would add a Worker
  request per media fetch, while sending media over the album WebSocket would require a
  separate streaming protocol and client-side reconstruction. The browser already sees every
  media subresource request through the service worker.
- **Decision**:
  - Cache cross-origin image, video and audio responses in a stable CacheStorage bucket using a
    cache-first strategy. This includes opaque responses from hosts that do not enable CORS;
    the service worker stores and returns them without inspecting their status, headers or body.
  - When a media request contains `Range`, fetch the complete resource without that header and
    cache the complete response, so offline media has all bytes available.
  - Treat cache writes as best-effort: a quota or storage failure must not block an online media
    response. Preserve the media bucket across service worker updates.
- **Consequences**: Already-loaded media can be served offline without involving the album
  Worker or Durable Object. Range-based video loads may download the entire file, increasing
  bandwidth and delaying playback depending on the host/browser. Browser storage quotas,
  eviction, private browsing and user-cleared site data mean cached media is not permanent and
  complete offline availability cannot be promised. Opaque responses cannot be measured or
  selectively evicted by this service worker.
- **Alternatives considered**: Serving media through `/l/:id` would add a Worker request and
  backend lookup for each uncached client request. Streaming through `/ws` would couple media
  transfer to album sync and require a new chunking protocol. Requiring CORS would exclude
  existing media hosts. Native HTTP cache alone is browser-managed and does not provide the
  service worker's explicit offline fallback.
