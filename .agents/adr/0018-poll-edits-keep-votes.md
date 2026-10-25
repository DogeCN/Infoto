# 0018: Editing a Poll Keeps Its Votes Unless the Question Changed

- **Date**: 2026-10-12
- **Status**: Superseded by 0019
- **Context**: ADR 0010 decided that "changing the options, selection mode, or locale clears the
  poll's existing votes so stored option indices cannot become stale or cross locale boundaries",
  and 0013 restated it as "any change to the option set or the choice mode clears the poll's
  votes". The reason was sound — a vote is a `(poll_id, user_id, option)` row where `option` is an
  **index** into the poll's `options` JSON array, so a changed list can leave an index pointing at
  a different choice or at nothing. The rule was drawn too wide, though: it fired on any
  difference in the option text, so fixing a typo in one option's wording discarded every vote in
  the poll. That is what an operator hit, and it is a data-loss bug rather than a safety measure.
- **Decision**: Clear the votes only when the edit **changes the question**, which is exactly two
  conditions: the number of options changed, or `allowMultiple` changed. A same-length edit keeps
  every vote, because the editor preserves option order (`PollEditorDialog` adds and removes at the
  end and edits text in place; there is no reorder gesture), so the indices still address the same
  choices.
  - The server compares the incoming option count against the stored one and the incoming mode
    against the stored mode, and only then issues `DELETE FROM votes WHERE poll_id = ?`.
  - The client's optimistic fold (`ops.applyPollUpdate`) applies the **same two conditions**
    against the row it holds. Client and server disagreeing here would show a count the next
    snapshot contradicts — the double-source failure 0015 warns about — so the two are written to
    match, not merely to be individually reasonable.
  - **A locale change no longer clears votes.** It was in 0010's list for the "cross locale
    boundaries" reason, but the poll editor does not expose locale and the client's fold never
    changed it, so the server was the only side clearing — the client kept the votes and the
    snapshot took them away. Dropping locale from the condition removes that divergence rather
    than widening it.
  - The `PollEditorDialog` footer says what now happens (`admin.poll.editVotesHint`, both locales,
    key renamed from `editResetVotesHint` because it no longer describes a reset).
- **Consequences**:
  - Fixing an option's wording, or toggling nothing at all, no longer destroys the poll's votes.
  - The **reorder hole is real and is accepted, not closed**: an API caller that sends a
    same-length list in a different order keeps the votes and re-points them at different labels.
    The length test is sufficient only because the editor cannot reorder; closing it properly means
    giving options stable identities and storing a vote against an identity rather than an index,
    which is a schema change (red line 1 forbids a compatibility path, so it would be a table
    reset) and is not worth it for a list the UI can only append to, edit in place, and truncate.
  - A malformed stored `options` value parses to a count of 0, which differs from any valid draft
    and therefore clears the votes — the conservative direction, and the same malformed-input
    stance the rest of the worker takes.
  - The copy and the code now agree. The old hint claimed "reordering keeps them" while the code
    cleared on a reorder (every index held different text), so the hint described behaviour that
    did not exist.
- **Alternatives considered**:
  - _Keep clearing on any option-text change_ (the 0010/0013 rule): rejected — it is the bug
    reported, and it makes a typo fix cost every vote in the poll.
  - _Never clear, prune only out-of-range indices_: rejected as the primary rule. It preserves
    votes across an option **addition**, where the question genuinely grew, and the operator's
    stated boundary is that an added option or a changed mode clears. Pruning is what the server
    would do anyway for a shortened list, but only as part of the clear.
  - _Store votes against a stable option id_: rejected for now — it is the real fix for the reorder
    hole, but it changes the `votes` schema and the snapshot's `Vote` shape, and the UI cannot
    produce a reorder to justify that cost today.
  - _Clear on locale change as well_: rejected — it is unrepresentable from the UI and was the
    source of a client/server disagreement.
