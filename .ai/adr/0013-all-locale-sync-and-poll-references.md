# 0013: All-Locale Sync Snapshots and Language-Addressed Poll References

- **Date**: 2026-10-03
- **Status**: Accepted (supersedes the locale-selected snapshot, the poll title, and the `::vote:<id>` token in 0010)
- **Context**: `/sync` selected one locale and returned only that locale's announcements, polls, and feedback, so changing the UI language had to clear the content lists and issue another request. Two problems followed. First, the client had to keep the request's locale and its `contentLocale` in agreement; when the engine read `activeLocale()` while writes were filed under `store.contentLocale`, rows were written but never displayed after a reload. Second, a poll reference could only carry an id, so a snapshot holding a single locale could not resolve a reference whose poll belonged to another one, and the renderer had no way to tell a missing poll from a wrong-language one.
- **Decision**:
  - `/sync` returns every locale's announcements, polls, and feedback in one snapshot. The client stores them per locale and derives the visible lists from `contentLocale`; `SyncRequest`/`SyncResponse` carry no locale. Changing the language is a local re-render and issues no request.
  - The engine's request coalescing is no longer keyed by locale: `sync()` joins the in-flight request and later edits wait for the next explicit trigger.
  - Admin writes are addressed by an explicit locale bucket rather than "the locale on screen", so a response that lands after a language switch still commits into the language it was made for. No write is discarded for being late, and no list is cleared on a switch.
  - Polls carry no title. A poll is its options plus its choice mode; the admin list identifies a row by mode and timestamp.
  - Reference a poll from Markdown with `::poll:<lang>:<id>`. The token resolves only when both the language and the id match a known poll; an unknown, malformed, or legacy `::vote:<id>` form stays plain Markdown. Polls remain locale-scoped records.
- **Consequences**: A language switch costs no round trip and cannot show the wrong locale's rows, because the snapshot is locale-complete and the views are a pure filter of it. The reference is self-describing, so a rendered announcement never depends on which locale the reader happens to be using. The snapshot grows by the non-active locales' content, which is negligible for these low-cardinality tables. Removing the poll title drops the "title-only edits keep votes" rule: any change to the option set or the choice mode clears the poll's votes.
- **Alternatives considered**:
  - _Keep the locale-selected snapshot and request the other locale on switch_: rejected because it makes a language switch a network round trip and keeps the client/server locale agreement as a standing source of bugs.
  - _Store only the active locale's rows and re-fetch on switch, but retain a raw cache_: rejected because it needs the same all-locale retention plus an imperative re-filter, and it mishandles a write that resolves after the switch.
  - _Keep the poll title as a list label_: rejected because the option rows already identify a poll and a title duplicated them; identification moved to the mode and timestamp.
  - _Let `::poll:<id>` resolve regardless of language_: rejected because it would render another language's poll inside a localized announcement, which the locale model does not allow.
