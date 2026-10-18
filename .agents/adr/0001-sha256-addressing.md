# 0001: sha256 Addresses Photos, Not Sequential IDs

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: Photos originally had a numeric autoincrement `id`, used as the index for every in-site read and write. This coupled three unrelated concerns: the DB primary key, the external short link (`/l/{id36}`), and client-side identity of a photo. It also meant an op-log replay after a re-import could point at a different row than intended.
- **Decision**: `sha256` is the **only** index for in-site requests. `Op.targetSha` addresses every photo op; `Op.target` is reserved for announcements (vote/react, which have no content hash). The server's `sync.ts#resolvePhotoId` looks up by sha only — no match means skip, never a fallback lookup by id. `id` survives solely as the external-link index that `/l/{id36}` decodes.
- **Consequences**:
  - Optimistic upload cards can enter the Lightbox and multi-select — there is no longer an id-collision question while a photo is still uploading.
  - Writes that happen _during_ an upload are queued in `deferredPhotoOps` and released by `photoOpQueued(sha)`. This only works because `/sync` replays ops in array order, so **the op must come after the upload op**. That ordering is the premise of the whole mechanism.
  - Changing the index required a manual database rebuild; the code contains **no** compatibility path for the old shape (project red line 1).
- **Alternatives considered**:
  - _Keep `id` and add a `sha256` unique index alongside_: rejected — two sources of truth for "which photo", and the failure mode (silently addressing the wrong one) is worse than a hard failure.
  - _Content-addressed storage keys only, no DB column_: rejected — dedupe lookups still need a column to query.
