# 0010: Locale-Scoped Content and Standalone Multi-Select Polls

- **Date**: 2026-10-01
- **Status**: Accepted
- **Context**: Announcements, suggestions, and polls need independent Chinese and English content. The previous poll model embedded voting metadata in announcement Markdown and keyed responses to an announcement, which coupled two separately managed concepts and did not model multi-select responses cleanly. A translation must not leak into the other locale's public or admin view.
- **Decision**:
  - Store `locale` on announcements, feedback, and polls. The public sync snapshot selects the current locale for those records; photos remain shared.
  - Model polls as independent records with stable IDs, a title, options, locale, ordering, and an `allow_multiple` flag.
  - Store each selection as a normalized `(poll_id, user_id, option)` row, with a composite primary key. Single-select polls replace that user's previous selection; multi-select polls allow several distinct option rows.
  - Preserve votes for title-only edits. Changing the options, selection mode, or locale clears the poll's existing votes so stored option indices cannot become stale or cross locale boundaries.
  - Reference a poll from Markdown with the stable token `::vote:<id>`. Resolve the token to the separately loaded poll definition and live counts when rendering. The poll manager owns creation, editing, copying the reference, ordering, and deletion; the announcement editor toolbar does not create polls.
- **Consequences**: Polls can be managed and reused independently of announcement text, multiple selections are represented without serializing voter state into Markdown, and locale boundaries apply consistently to all three content types. The same poll cannot span locales; translations require separate poll records and references.
- **Alternatives considered**:
  - _Keep poll definitions inside announcement Markdown_: rejected because an announcement edit would own poll lifecycle, stable cross-document references would be unavailable, and a poll could not be independently ordered or managed.
  - _Store all selections as one serialized value per user_: rejected because normalized rows support multiple selections with a database-enforced uniqueness constraint and straightforward aggregate counts.
