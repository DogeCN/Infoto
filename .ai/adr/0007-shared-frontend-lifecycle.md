# 0007: Shared Frontend Lifecycle and Utility Boundaries

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: Upload orchestration dominated the page component, related helpers had separate implementations, and overlays handled focus, Escape, and scroll locking independently. Async completion can arrive after component teardown or before local persistence finishes.
- **Decision**:
  - Keep album upload orchestration in `state/uploadStore.svelte.ts`, created inside the owning component. It owns reactive task previews, optimistic cards, batch counters, and teardown; the SharedWorker remains responsible for transcode/upload execution. `App.svelte` composes the stores and UI.
  - Share overlay lifecycle through `base/lib/overlay.ts`: topmost-only keyboard handling, focus containment/restoration, and stack-aware body scroll locking. Closed mounted panels are inert.
  - Keep reusable formatting, slider geometry, and UI helpers in `base/lib`; Markdown transformations/rendering in `core/markdown.ts`; message routing and purpose semantics in `transcode/protocol.ts`; media identifiers/extensions shared by the Worker and frontend in `src/shared/media.ts`.
  - Share JSON request deadlines across sync and admin clients, including response-body consumption. Retain upload-specific idle-progress semantics rather than applying a fixed wall-clock upload deadline.
  - Acknowledge successful upload metadata only after its oplog write resolves. Preserve the existing explicit sync triggers and real-measurement progress contract.
- **Consequences**: Page components have smaller responsibilities, asynchronous preview changes invalidate Svelte derivations, overlay stacking has one owner, and teardown releases timers, subscriptions, and object URLs. Store factories depend on Svelte lifecycle and must be created within a component. Browser tests complement pure helper and API tests.
- **Alternatives considered**: A global upload UI singleton complicates remount cleanup; duplicating per-overlay keyboard handlers permits multiple layers to react to Escape; a general-purpose UI framework adds a dependency without resolving the app-specific lifecycle contracts.
