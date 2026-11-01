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
  - ⚠️ **Superseded in part by the Amendments below** (the DO became a sequential op store,
    so "the DO is stateless", the `sync`→`synced` frame names and the "server falls back to
    arrival time" rule below no longer describe the code). The Amendments are normative.
  - The write entry is the `/ws` WebSocket, served by the `Album` Durable Object. Frames
    (`shared/types.ts`): `hello` → `welcome` | `error`; `sync` {ops} → `synced` {response};
    `ping` → `pong`. A `synced` response is the same `SyncResponse` the HTTP route returned,
    so the client's snapshot pipeline (oplog rebuild, photo-record retirement) is unchanged.
  - ⚠️ The DO is stateless _(overturned the same day — see the **second** Amendment; kept here
    so the reversal stays visible)_. Identity rows, op application and snapshots live in D1 through
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
- **Second amendment (same day, implemented 2026-10-31): the DO became the album's sequential
  op store.** The overruling spec rebuilt the server half: every write appends to the DO's own
  SQLite op log (`seq` AUTOINCREMENT — dense, server-assigned order), is folded into an
  in-memory snapshot, and is broadcast to every connection as one `ops` {applied} frame (the
  frame pair this record's Decision called `sync`/`synced`; `AppliedOp` replaced the
  `SyncResponse`-shaped ack). D1 is demoted to the cold snapshot store: written only at the
  archive edges (before a migrate export; by the idle alarm after the last connection left),
  read only to hydrate a cold object; `/l/:id36` asks the DO first and falls back to D1.
  Timestamps: the DO stamps `ts` per op at ingest, the client's commit time rides `ct`, and
  display takes `min(ct, ts)` — the "fall back to arrival time" rule above is gone, as are
  per-request clock fields. Catch-up: `hello` carries `lastSeq`; the answer is the ops after
  it, or a whole snapshot when it cannot be explained. Identity dedup: a newer connection of a
  user replaces the older (close 4001). Client side, all in one SharedWorker coordinator (one
  WebSocket per browser, tabs fan out over ports, ack bookkeeping by client nonce `cid`);
  broadcast ops apply live in every tab.
- **Third amendment (2026-11-01, review cleanup).** Three follow-throughs: (1) the idle alarm
  now takes the **same** archive path as the export flush — the separate log-compaction
  (`foldOps`) and the 256-op archive threshold were deleted: every stored op is already
  folded into the snapshot the archive writes from, so the second mechanism saved nothing and
  added a way to get D1 wrong; (2) a whole-snapshot `welcome` makes the coordinator **adopt**
  the server's `seq` as its stored position (not merely advance it), which un-strands a client
  whose stored `lastSeq` sits above a rehydrated log; (3) where a browser ships no SharedWorker
  (Safari on iOS — the "one WebSocket per browser" above silently assumed one exists), the
  same coordinator runs in the page over a loopback port, so each tab holds its own socket and
  the kick rule cycles them newest-first; no browser is locked into a queue that never sends.
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
  need HTTP writes. DO storage as the canonical album (prototype) — rejected _in that form_: it
  made D1 an unflushed shadow and compaction a data-loss hazard, and broke /admin/migrate,
  which reads D1. The shipped design is the corrected middle: the DO log is hot and canonical
  between archive edges, D1 is the cold snapshot written **at** those edges (export flush, idle
  alarm), so migrate keeps reading D1 and no fold ever deletes an op D1 has not seen. Full op-level
  fan-out with client-side appliers — right end state, but a client store rewrite; deferred
  until this transport exists to carry it.
