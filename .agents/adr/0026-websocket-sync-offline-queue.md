# 0026: Album sync moves to a WebSocket with an offline op queue

- **Date**: 2026-10-31
- **Status**: Accepted
- **Context**: The write path was POST /sync: one HTTP round trip carrying ops and returning a
  full snapshot. Three assumptions baked into it wore badly. The sync button was always on
  screen even though a connected client syncs without being told to. The server stamped a
  whole request's ops with one `serverTime`, so an offline backlog landed with the time it
  was _sent_, not the times it was _made_ — feedback rows and photo ordering lied after a
  day offline. And the page-exit flush needed a `keepalive` fetch hack sized against the
  browser's 64 KiB body cap.
- **Decision**:
  - ⚠️ **Superseded in part by the Amendment below** (the DO became a sequential op store,
    so "the DO is stateless", the `sync`→`synced` frame names and the "server falls back to
    arrival time" rule below no longer describe the code). The Amendment is normative.
  - The write entry is the `/ws` WebSocket, served by the `Album` Durable Object. Frames
    (`shared/types.ts`): `hello` → `welcome` | `error`; `sync` {ops} → `synced` {response};
    `ping` → `pong`. A `synced` response is the same `SyncResponse` the HTTP route returned,
    so the client's snapshot pipeline (oplog rebuild, photo-record retirement) is unchanged.
  - **The DO is stateless.** Identity rows, op application and snapshots live in D1 through
    `worker/album-ops.ts` (extracted verbatim from the deleted `routes/sync.ts`, with
    per-op timestamps added). The DO holds sockets and resolves sessions — nothing else.
    There is no DO op log, no compaction alarm, no snapshot copy: every redundancy the
    prototype carried was a data-loss risk with D1 already canonical.
  - **Connection-aware UI.** The sync button hides while the socket is open _and_
    authenticated, and shows whenever it is not — offline, dropped, or pre-hello. Sync
    triggers stay ADR 0008's (page open, page exit, explicit request); a broken socket is
    never retried in the background, only by the visible button.
  - **Offline queue with client timestamps.** Every op the client commits carries `ts`
    (ms epoch, stamped at commit). The queue lives in IndexedDB as before; browsing and
    operating offline work unchanged. On reconnect the whole backlog leaves in **one**
    `sync` frame (chunked only past `MAX_SYNC_OPS`), never one frame per op. The server
    clamps each op's `ts` to its own clock and falls back to the frame's arrival time when
    the field is absent (ops queued before this change).
  - **Identity over the socket.** The upgrade request's `uuid` cookie resolves a returning
    visitor before `hello`; `hello` carries a Turnstile token only when there is no
    identity yet. The server re-issues the HttpOnly cookie on the 101 handshake response.
    A freshly created identity cannot receive a handshake cookie (hello happens after the
    101), so the client mirrors `welcome.uuid` into a JS-set cookie — the next handshake
    re-issues it as HttpOnly, self-healing after one reconnect. The admin routes' root gate
    keeps reading the same cookie.
- **Amendment (same day): the admin mutation routes move into the WebSocket after all.**
  The first revision restored the HTTP admin routes because the client still drove them;
  the consolidated spec overrules that — admin CRUD queues as ops (`ann_create`,
  `ann_update`, `ann_delete`, `ann_reorder`, `poll_create`, `poll_update`,
  `poll_delete`, `poll_reorder`, `fb_delete`, `fb_reorder`), root-gated in the
  Durable Object's applier. `run_worker_first` slims back to `/ws`, `/l/*`,
  `/robots.txt`, `/admin/migrate`, `/admin/translate`. `/admin/translate` stays HTTP
  (stateless), `/admin/migrate` stays HTTP (50 MB bodies); migrate export flushes the DO
  into D1 first and import rehydrates the DO afterwards. This supersedes the §8.12
  carve-out for the admin mutations: they are still immediate user-initiated writes, just
  carried by the socket.
- **Consequences**: The page knows "connected vs offline" as first-class state, and the
  queue's cost model is one frame per flush instead of one request per batch. The uuid
  cookie is client-settable for fresh identities, which weakens HttpOnly until the next
  reconnect re-issues it — accepted, because the uuid only carries the power the page
  already has (post content, place marks). There is still no cross-client push: two
  browsers converge only when each next syncs; the stateless DO was chosen so that adding
  a per-connection op log and fan-out later is an addition, not a rewrite. The e2e suite
  was reworked onto the socket in the same migration: `web/tests/e2e/albumSocket.ts`
  stands in for the sync SharedWorker (an in-page port, because the socket lives inside
  that worker and `page.routeWebSocket` cannot intercept it) and drives `/ws` frames, with
  a `LiveAlbum` real-client variant for integration specs. (e2e stays manual-only.)
- **Alternatives considered**: Keeping HTTP /sync with a beacon — keeps every assumption the
  request overturns. Server-sent events for push — one-way only, and the client would still
  need HTTP writes. DO storage as the canonical album (prototype) — duplicates D1, made
  compaction a data-loss hazard, and broke /admin/migrate which reads D1. Full op-level
  fan-out with client-side appliers — right end state, but a client store rewrite; deferred
  until this transport exists to carry it.
