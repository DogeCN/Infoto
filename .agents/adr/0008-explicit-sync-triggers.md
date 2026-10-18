# 0008: Synchronization Uses Explicit User and Page-Lifecycle Triggers

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: The user requires synchronization only when explicitly requested, when a tab opens, or when it exits. Queue-length triggers and timed retries issue requests without those actions.
- **Decision**:
  - Persist operations without submitting them from `addOp`, regardless of queue length.
  - Sync on initialization, explicit user requests, and the bounded keepalive flush on `pagehide`. Visibility changes and network recovery are not triggers.
  - Remove engine retry timers and HTTP 429 backoff. A failed request returns its error immediately after the request deadline or response; unconfirmed operations remain queued.
  - Keep bounded, ordered batching within one permitted sync attempt. Concurrent edits remain queued for a later permitted attempt.
  - Retain immediate admin mutation requests and the snapshot refresh belonging to a user-initiated SQL import. Neither creates a background synchronization loop.
- **Consequences**: Users control network submissions and can inspect pending counts. Failures do not silently recover while a tab remains idle. Page-exit delivery is best-effort and browser-limited; unsent operations persist for reopening or a manual request. Error copy describes manual recovery instead of automatic retries.
- **Alternatives considered**: Threshold-based or exponential-backoff synchronization would reduce pending queues but conflicts with the requested trigger policy.
