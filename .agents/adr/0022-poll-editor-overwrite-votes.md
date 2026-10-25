# 0022: Poll Editor Reorders Options With Their Votes and Overwrites the Whole Poll

- **Date**: 2026-10-25
- **Status**: Accepted (supersedes 0018)
- **Context**: 0018 kept a poll's votes across a same-length text edit, but cleared them whenever
  the option count or `allowMultiple` changed, and accepted a reorder hole because the editor had
  no reorder gesture. The editor now needs one: an operator asked for a handle on every option so
  rows can be dragged into a new order while each option keeps its own count. Once the list can be
  reordered, a same-length length test is no longer sufficient — votes are stored by index, so a
  reordered list would silently re-point every vote at a different label. The operator also asked
  for votes to stop clearing automatically and for one explicit "clear votes" action instead, plus
  a live view of the counts while editing.
- **Decision**: Reorder the option objects themselves in the editor, with each option carrying its
  own voters. Nothing is remapped on the server: `PUT /admin/polls/:id` is a **direct overwrite**
  that receives the complete option list and the complete vote set, already addressed by the new
  indices, and replaces both in one batch.
  - The editor rows are the drag surface's smallest unit — only the handle starts a drag, because
    the row is a text input and a whole-row drag would steal caret placement. Moving the option
    object carries its votes, so reordering, editing, adding and removing all keep every vote that
    still addresses an existing option. The dragged row follows the pointer with the same lift and
    the displaced rows the same FLIP that `ReorderableList` applies; only the trigger differs.
  - No automatic clearing anywhere. Switching to single choice keeps one vote per user (the editor
    coalesces before sending); the worker rejects a multi-vote single-choice payload instead of
    clearing it.
  - `Clear votes` is the one explicit reset: it empties the editor's local vote set, and Save
    commits it through the same overwrite. There is no separate clear endpoint — a second write
    path for one boolean would be another interface to keep in step.
  - The count is rendered inside each option's field: a transparent input over the `VoteBlock`
    fill bar, with the count at the right edge. There is no separate results preview — the number
    stays on the label it belongs to while the row is edited, which is the point of showing it.
  - The worker validates only the overwrite's shape: options in range, no duplicate
    `(userId, option)` pair, and at most one vote per user in a single-choice poll. The client's
    optimistic fold (`ops.applyPollUpdate`) stores exactly the sent rows, so the next snapshot
    cannot contradict it.
- **Consequences**:
  - The reorder hole is closed: a vote and its label move together, whether the editor reorders,
    removes, adds or rewrites.
  - A typo fix, an added option, a removed option, a reorder and a mode change no longer destroy
    votes that remain valid; only the explicit button does.
  - The admin can overwrite votes arbitrarily. That is deliberate for a root-only API, but it means
    the worker's shape checks are the only guard against malformed rows.
  - A vote still has no stable identity beyond its index; correctness now depends on the editor
    sending indices that match the option list it sends, in the same request. The two travel
    together in one payload, which is what makes that safe.
- **Alternatives considered**:
  - _Server-side index remapping via an `optionSources` parameter_: rejected — the caller already
    knows which vote belongs to which label; sending the full resulting set is one fewer concept
    and keeps the worker a plain overwrite.
  - _A separate clear-votes endpoint_: rejected — it duplicates the overwrite write path for a
    single empty-set case and adds a second route to keep in step.
  - _Reusing `ReorderableList` for the option rows_: rejected — its drag starts anywhere on the
    card and its shell is a card, while these rows are text inputs that need their caret; the
    follow/FLIP mechanics are mirrored instead, with the handle as the only trigger.
  - _A separate read-only `VoteBlock` preview under the options_: rejected — the operator wanted
    the count on the option it belongs to, so the fill/count pair moved inside the field and the
    duplicate list disappeared.
  - _Clearing on option-count or mode changes (0018's rule)_: rejected by the operator — a change
    to the poll should not silently discard data now that the editor has an explicit clear.
  - _Stable option IDs stored with each vote_: still unnecessary. The editor carries votes on the
    option objects, and the save payload carries the final indices alongside the labels, so no
    schema change is needed.
