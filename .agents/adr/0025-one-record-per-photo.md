# 0025: One Durable Record Per Photo, Keyed by sha256

- **Date**: 2026-10-26
- **Status**: Accepted
- **Context**: Client-side photo state had spread across six places — the op log, the snapshot
  cache, a `jobId`-keyed resume store, a `localStorage` map of optimistic marks, a
  `sessionStorage` map of sort timestamps, and OPFS artifact files — with three different keys
  for the same photo (`sha256`, `jobId`, a negative UI id). Three costs came out of that, and the
  first one shipped as a bug:
  - **One fact, two stores, two non-atomic writes.** "This photo is hosted and its upload is
    queued" was an op in the log _plus_ a record in the resume store. At `done` the worker
    deleted the resume record and only then told the page, which appended the op; a reload in
    that gap left a photo hosted, paid for, and with no durable trace anywhere.
  - **Withdrawal could not name what it was withdrawing.** An upload op carries no `targetSha`,
    so removing it meant a tombstone op the projection had to re-learn how to interpret.
  - **Child state outlived its parent.** Optimistic marks lived in `localStorage` keyed by sha
    and were cleaned by a separate call, so a mark could outlive the photo record it described.
- **Decision**: One durable record per photo, in a `photos` store keyed by its `sha256`, and
  three stores total plus bytes:

  | Store       | Authority                             | Contents                                                           |
  | ----------- | ------------------------------------- | ------------------------------------------------------------------ |
  | `oplog`     | the client's write queue              | every op, ordered, cleared on confirmation                         |
  | `photos`    | the client's word about unsent photos | `status`, `meta`, `url`, `createdAt`, `artifact`, `marks`, `opKey` |
  | `metaCache` | the server's                          | the last snapshot + one entry per known sha                        |
  | OPFS        | bytes                                 | the stage-1 artifact                                               |
  - **Transitions are single transactions, and each has one writer.** The worker writes
    `uploading` (stage 1 done) and `failed` (upload leg rejected); the **page** turns
    `uploading` into `hosted` and appends the upload op in one `['oplog','photos']` transaction
    (`appendUpload`); the engine retires the record after a confirmed batch has been folded into
    the store. Deleting a photo is one transaction too: the record, its mark ops and the upload op
    the record owns (`opKey`) — the tombstone `delete` op stays, because an op already claimed by
    an in-flight request cannot be un-sent.
  - **`jobId` is never a key.** It survives as `artifact.key` on the record, because an OPFS file
    name has to exist before its own digest does (the artifact is hashed while it is written —
    see `storeArtifact` / `openArtifactSink`), so the filename cannot be the sha without a second
    pass over the bytes. That is the one deviation from "the sha is the only durable key", and
    the record is what owns it.
  - **Child state rides the parent.** A photo's optimistic marks and its upload instant live on
    its record, so deleting the record deletes them. The store keeps an in-memory mark map only
    as a hydration cache of the same records.
  - **Dedupe sees what the client holds, not only what the server has.** A new job is a duplicate
    when the snapshot cache knows the sha **or** a record for it exists and is not `failed`, so a
    reload no longer re-uploads a photo whose confirmation is still queued.
  - **Cards are a filter over records, not a reconstruction from ops.** An `upload` op no longer
    carries rendering duty; `status === 'hosted'` is the whole condition, minus the two
    single-frame guards (a sha the snapshot just landed, a sha a live job already owns).

- **Consequences**:
  - The lost-photo window is closed by construction: the `hosted` record and the op are written
    together, and the `uploading` record is only ever replaced, never deleted while an upload is
    unconfirmed.
  - `withdrawnShas`, the projection's tombstone rule, the `localStorage` mark map and the
    `sessionStorage` sort stamp all disappear; `removeOpsBySha`'s sha scan is gone for uploads.
  - Resumption derives from records (`status !== 'hosted'` + an artifact that still exists), so a
    record pointing at a pruned artifact cleans itself up on the next load.
  - **The upgrade discards two stores** (`pendingUploads`, and the `localStorage` mark key) —
    `DB_VERSION` 3 creates `photos` and deletes the resume store. Queued ops survive (the `oplog`
    name and shape are unchanged); an upload interrupted across the upgrade will not resume, and
    optimistic marks on photos with no server row are lost. That is red line 1's trade: prefer
    data loss over a silent compatibility layer.
  - One read now answers "what is pending": cards, marks and resumable jobs all come from the
    same records.
- **Alternatives considered**:
  - _Merge everything into one store._ Rejected: the op log is an ordered multi-entity write queue
    (votes, reactions, feedback too) that the server replays in array order; the snapshot cache is
    the server's authority and is replaced wholesale; the bytes are large, evictable and
    worker-owned (ADR 0014 streams them to OPFS). Four authorities, four stores — merging them
    would make "the server said so" and "we hope so" the same row.
  - _Key the OPFS artifact by sha._ Rejected above: the digest is produced by the write.
  - _Keep marks in `localStorage` and write the record separately._ Rejected: that is exactly the
    parent/child split this decision removes; a mark is only meaningful while the photo it marks
    is unsent.
  - _Dual-write the old and new stores for one release._ Rejected by red line 1: a compatibility
    shim with no user-visible benefit, kept only to avoid a one-time loss of unsent metadata.
  - _Give the page ownership of the `uploading` record instead of the worker._ Rejected: only the
    worker knows the artifact exists, and it is the writer that must survive its own restart.
