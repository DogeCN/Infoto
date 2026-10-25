# 0021: Workers AI Drafts Admin Translations

- **Date**: 2026-10-25
- **Status**: Accepted
- **Context**: Announcements and polls are locale-scoped records (ADR 0010/0013), so a bilingual
  site needs the same content authored twice. An admin can write one language and ask AI for the
  other, but translation must not become a reader-side runtime dependency: `/sync` is a hot path,
  the content has a human owner, and poll votes are addressed by option index. The site ships
  exactly two locales (`en-US`, `zh-CN`).
- **Decision**:
  - Add a root-only, stateless `POST /admin/translate`. Its body carries the card's current
    content (`title`/`contentMd` or `options`/`allowMultiple`) plus `sourceLocale` and
    `targetLocale`; it never reads or writes D1. `sourceLocale` is the card's own `locale`;
    `targetLocale` is the one other registered locale.
  - Use Workers AI `@cf/meta/m2m100-1.2b` through an injected `Translator` service. The
    production runner lives in `src/worker/index.ts`; unit tests inject a fake and never call AI.
  - Local development may opt into a REST transport when `.dev.vars` supplies
    `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The REST runner posts to
    `api.cloudflare.com` and is selected only when both variables exist; production has neither
    and therefore uses the `AI` binding. This exists because the local AI binding's remote edge
    path can be unreachable while `api.cloudflare.com` is reachable. The token is dev-only,
    never rendered, and never logged.
  - Split announcement Markdown into text blocks and literal blocks. Fenced code, blank lines and
    whole-line `::poll:` references stay literal; text blocks are translated in chunks of at most
    800 characters. Poll options are translated one by one, preserving order and count.
  - Return a draft only. The admin UI switches its language and content bucket to the target
    locale and opens the existing create editor seeded with that draft. Saving still goes through
    the existing `POST /admin/announcements` or `POST /admin/polls`, so the result is a normal
    target-locale row reviewed by a human.
  - No translation table, no cache, no `/sync` change, no automatic save. A deployment without
    the `AI` binding returns `503 translation_unavailable`; a model failure or empty output
    returns `502 translation_failed` and opens no editor.
- **Consequences**: Zero schema migrations and no reader-side fallback. Announcements and polls
  remain locale-scoped; poll votes still start at zero in the new locale, matching ADR 0010/0018.
  Fenced code and poll references survive, but inline Markdown may be reworded, so the draft
  requires review; a translated `::poll:` line still names the source poll and the admin must
  create the target-language poll and replace the reference. V1 does not detect an existing
  same-topic target row, so duplicates are possible. The `AI` binding becomes a deployment
  requirement, and every translation test uses a fake translator.
- **Alternatives considered**:
  - _Translate inside `/sync`_: rejected — AI latency, quota and timeouts would pollute the
    synchronization hot path.
  - _Store derived translations and share votes across locales (the "reader-side" design)_:
    rejected for this iteration — it needs a new table, hash invalidation and a new ADR that
    supersedes the locale-scoped poll identity in ADR 0010/0013.
  - _Auto-create a sibling row without opening the editor_: rejected — the admin loses the
    review step, and machine wording would appear as authored content.
  - _Call Workers AI from the browser_: rejected — it exposes the account binding and cannot be
    root-gated by the Worker.
