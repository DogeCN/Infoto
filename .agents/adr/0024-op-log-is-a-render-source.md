# 0024: The Op Log Is a Render Source — Unconfirmed Uploads Draw as Cards

- **Date**: 2026-10-26
- **Status**: Accepted
- **Context**: A 200-photo batch whose `/sync` timed out (ADR 0023) left 200 unconfirmed `upload`
  ops in IndexedDB after a reload, and **nothing on screen**. The card that had been showing
  those photos lived in the upload store's memory (`$state(new Map())`), the SharedWorker deletes
  its resume record the moment an upload succeeds, and terminal OPFS artifacts are pruned to the
  last 30 every 15 s. Every durable trace of a hosted, paid-for photo — and the only thing that
  could put it on screen — was the `upload` op. The grid was empty while the log held 200 photos,
  and because a sync is never triggered by a reload on its own (ADR 0008), they stayed invisible
  for as long as the failing request kept being retried by hand.
- **Decision**: The op log is a **render** source, not only a write queue. Unconfirmed `upload`
  ops are projected into the gallery's pending cards.
  - The projection is pure and lives in `core/pending.ts` (`queuedUploadFromOp`,
    `queuedUploadCards`): an op is a card when its payload is complete, and the card takes
    `payload.url` as its media — the URL the facade returned, so the bytes are the album's own —
    plus width/height/size/type and the upload instant the SharedWorker stamped. Those are the
    same fields a `done` job's card renders.
  - The artifact is deliberately **not** used: an op carries no `jobId`, OPFS filenames are
    `{jobId}.{ext}`, and `reclaimTerminalJobs` would have pruned most of a 200-photo batch anyway.
  - The log is read at page open and again when a sync attempt ends (`SyncEngine.queuedOps`).
    Both are reads: no retry is armed, no timer, no `visibilitychange` listener, and nothing here
    calls `sync()`. ADR 0008's trigger list is closed and this decision does not widen it.
  - The cards are merged into `pendingPhotos` behind the same landed-sha guard the live `done`
    cards use, and deduped against the shas live tasks own, so a photo can never be drawn twice.
  - **No overlay.** Nothing measured these cards, so they carry no curtain and no fraction; the
    shimmer band that a third state would have drawn is the kind of unrequested visual addition
    §4.5 exists to stop, and parking the curtain at its 90% ceiling would state progress that
    does not exist.
  - Deleting one is the ordinary pending-photo path (withdraw, then tombstone), plus a
    session-scoped suppression set: an `upload` op carries no `targetSha`, so `removeOpsBySha`
    cannot withdraw it and a naive re-read would put the card back until a sync clears it.
- **Consequences**:
  - A reload now shows the photos the log is still holding, and they can be deleted
    individually or in a selection — which is the only way out of a batch that cannot sync.
  - A card can outlive the row it describes: an op the server will drop (a rejected media URL,
    or a duplicate the album already has) keeps drawing until the next sync clears it. That is
    one sync away, and the alternative — hiding the photo — was the bug.
  - Cards appear only while the log holds them, so the album's "pending" count and the visible
    cards now agree.
  - A delete in another tab becomes visible here only at the next read.
- **Alternatives considered**:
  - _Persist the card list itself in IndexedDB_: the op log already is that list; a second store
    would be a second source of truth to keep in step.
  - _Re-read the OPFS artifact through a sha→jobId index_: it would need a new durable index for
    the 30 surviving artifacts of a 200-photo batch, and the hosted URL is already on the op.
  - _An `awaiting` overlay with an indeterminate sweep_: rejected — a permanent band across a
    photo that is already fully uploaded reads as a stalled progress bar, and the state has
    nothing to measure.
  - _Retry the sync on page open when the previous one failed_: that is a new sync trigger, which
    ADR 0008 and rule 12 forbid; showing the photos is the honest half of the fix.
  - _Mark queued-upload shas as existing so marks can be filed immediately_: unnecessary. Marks on
    these cards are already persisted in `pendingMarks`, and `applySync` states them as ops when
    the row arrives, so they land after the upload op without a second mechanism.
