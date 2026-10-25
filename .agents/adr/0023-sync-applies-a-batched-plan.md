# 0023: `/sync` Applies One Batched Statement Plan, Not One Round Trip Per Op

- **Date**: 2026-10-26
- **Status**: Accepted
- **Context**: A 200-photo pick reaches `/sync` as one request — 200 `upload` ops, ~62 KB, well
  under `MAX_SYNC_OPS = 500`. Each op was applied by its own `await`: an `upload` did a
  `SELECT id FROM photos WHERE sha256 = ?` existence check and then an `INSERT`, a mark or a
  deletion resolved the photo's row with a second `SELECT`, and `react` checked the
  announcement the same way. That is roughly 400 serial statements for one batch, and each one
  paid a D1 round trip. The statement text is not the problem: replaying the identical sequence
  against `node:sqlite` took 0.6 ms. At a 20–30 ms round trip the request needs 8–12 s before the
  snapshot is even read, so the page abandoned it (`NS_BINDING_ABORTED` on the request, a
  `sync_timeout` on the client) and the client — correctly — kept every op queued. The photos
  were uploaded, hosted and paid for, and the album showed none of them.
- **Decision**: Validate every op in JS, turn it into one or two `DbStatement`s, and apply them
  in one ordered plan of `db.batch` calls.
  - Photo ops address the photo by **sha256**, the unique index, so no op needs a lookup of its
    own first. An upload is a single conditional insert
    (`INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM photos WHERE sha256 = ?)`), a mark is one
    `UPDATE … WHERE sha256 = ?`, a deletion is one `DELETE … WHERE sha256 = ?`. A reaction's
    announcement check travels inside its insert (`SELECT … WHERE EXISTS`), and clearing one
    needs no check at all.
  - The plan is applied in op order, `MAX_BATCH_STATEMENTS = 100` statements per transaction.
    Order is preserved across chunk boundaries, so an op that follows the upload creating its
    row still applies — the property the client's whole deferral mechanism depends on.
  - The only read the plan needs is the poll definitions a batch votes on, and it happens
    before any write. That is safe because a poll is created by an admin endpoint and never by a
    sync op, so its answer cannot change under the ops that consume it.
  - Failure isolation moves from per-op to per-chunk: a chunk that throws is logged and dropped
    and the rest still apply. A failed _request_ still leaves the whole op list in the client's
    log, because `clearKeys` runs only after an `ok` response.
- **Consequences**:
  - A 200-photo batch costs two write round trips instead of 400. The cost is now a function of
    `MAX_BATCH_STATEMENTS`, not of how many ops the page had queued.
  - Every request that votes pays one extra read (the poll definitions), which a batch with no
    votes does not pay at all.
  - A chunk is a transaction, so a mid-chunk failure cannot leave half of it applied — but it
    does take the chunk's other ops with it. That is the same net outcome the old per-op drop
    had for the failing op, now with a blast radius of up to 100 statements.
  - Validation being in JS is what makes the plan safe: a malformed op contributes no statement,
    so it cannot poison a transaction.
- **Alternatives considered**:
  - _Keep the per-op loop and only fold the existence check into the insert_: halves the round
    trips to ~200, which is still 4–6 s of latency for one batch. Rejected as insufficient.
  - _One `db.batch` of everything the request carries_: one round trip, but unbounded in size per
    call and with no containment for a failure. The chunk constant is the compromise.
  - _Move validation into SQL and use `RETURNING`_: it would not reduce the round-trip count —
    each op would still be its own call — and it would put the album's acceptance rules into
    strings that no unit test reads.
  - _Reject large batches client-side (a lower `MAX_SYNC_OPS`)_: it makes a 200-photo upload take
    ten visible requests instead of one, and the per-request cost would still grow with the
    batch size.
