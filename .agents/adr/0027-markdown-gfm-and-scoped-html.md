# 0027: Markdown Is CommonMark + GFM, With Raw HTML Scoped Per Surface

- **Date**: 2026-11-01
- **Status**: Accepted
- **Context**: The renderer used `markdown-it` with `html: false`, `linkify: true` and
  `breaks: true`, and each call site re-listed those options by hand. The result was CommonMark
  plus exactly **one** of GFM's five extensions (tables). The other three were silently absent,
  which is the worst failure mode for a dialect: a writer types spec-correct syntax, nothing
  happens, no error is shown, and they conclude Markdown is limited rather than that the parser
  is. Measured against the spec's own examples:

  | GFM extension      | Before                                                                                    |
  | ------------------ | ----------------------------------------------------------------------------------------- |
  | §4.10 tables       | correct                                                                                   |
  | §6.5 strikethrough | two-or-more tildes only (spec: one **or** two), emitted `<s>` (spec: `<del>`)             |
  | §5.3 task lists    | `- [ ] x` rendered the literal brackets, no checkbox                                      |
  | §6.9 autolinks     | a bare `www.example.com` stayed plain text — `linkify-it` defaults to protocol/email only |
  | §6.10 raw HTML     | refused everywhere                                                                        |

  Two further defects surfaced from the same root cause (configuration scattered across call
  sites): the public renderer emitted `!shot` instead of `shot`, because `.disable(['image'])`
  leaves the `image` syntax to be half-matched by the `link` rule; and the announcement surface
  could not render an `<img>`-free embed without a parser rewrite.

  The constraint that shapes the raw-HTML half: announcements are authored by the album owner,
  while feedback is authored by any visitor. The two cannot share one HTML policy.

- **Decision**:
  1. **GFM gaps are filled in the parser layer.** Strikethrough is replaced at the rule level
     (`md.inline.ruler.at('strikethrough', …)` plus its post-process): one-or-two tildes in,
     `<del>` out. Task lists are a core post-pass over the finished token tree, because whether
     a marker opens a list item's **first** block is a property of that tree rather than of
     source lines. `fuzzyLink: true` supplies GFM autolinking.
  2. **One assembler owns the wiring** — `createMarkdownRenderer(options)` in
     `web/src/core/markdown.ts`, so the component and the tests cannot configure different
     parsers. It takes `MARKDOWN_TRUSTED` (media rendered, HTML accepted) or `MARKDOWN_PUBLIC`
     (media dropped to alt text, HTML refused).
  3. **Raw HTML is a parameter, not a global.** Announcements and the editor preview opt in;
     a visitor's feedback and the admin's copy of it never do.
  4. **The sanitizer policy is stated as data** (`MARKDOWN_SANITIZER_CONFIG`) rather than left
     implicit at the call site.
  5. `breaks: true` **stays**, as a documented departure from the spec: GFM's soft breaks are
     `\n`, but GitHub's user content hard-breaks every newline, and this surface serves that
     writing habit.

- **Consequences**:
  - Announcements can now carry tables, task lists, strikethrough and bare-domain links that
    render as GitHub renders them, and can use `<details>`, `<kbd>` and similar presentational
    HTML.
  - The public surface is strictly narrower: no HTML, and `![alt](url)` becomes its alt text
    with no request at all.
  - `markdown.test.ts` asserts the **spec's** output, not this implementation's current output,
    so a future regression is caught by the same examples GitHub publishes. Mutation-checked:
    each of the eight guards fails when the behaviour it describes is removed.
  - Two renderer configurations mean a new call site must consciously pick one; the default is
    gone.
  - Raw HTML raises the stakes on the sanitizer. Measured in a browser, DOMPurify already strips
    `script`/`iframe`/`embed`/`object`, the `<style>` **element**, and `javascript:` URLs;
    `form` and `input` are **allowed by default**. `form` (with `textarea`/`select`/`button`)
    is now forbidden, since it is the only thing that submits a visitor's input to a third
    party. `input` is **narrowed per element** rather than forbidden: GFM task lists need
    `<input type="checkbox">`, and a blanket ban silently removed it — the first version
    shipped exactly that, with green tests and an empty checkbox, because the tests stopped at
    the renderer's string. The `style` **attribute** is deliberately kept, because GFM table
    alignment is emitted through it.
  - Not implemented, and not part of the spec: footnotes and `> [!NOTE]` alerts. A future
    surface that wants "playable" embeds should extend the existing `::poll:` reference pattern
    (an inline reference resolved to a Svelte component) rather than open `html: true` further —
    that keeps the sanitized string boundary intact.

- **Alternatives considered**:
  - **Flip `html: true` globally.** Rejected: it would let any visitor's feedback carry markup,
    and the public surface has no reason to render HTML at all.
  - **Add a GFM plugin bundle instead of writing the rules.** Rejected: the three missing
    behaviours are a rule replacement, a token post-pass and one option; a dependency that
    pulls its own renderer assumptions into the sanitizer boundary costs more than it saves, and
    the strikethrough plugin ecosystem disagrees about `<s>` versus `<del>`.
  - **Keep `.disable(['image'])` and strip the `!` from the string afterwards.** Rejected: it
    fixes the symptom in the wrong layer and leaves the URL in the document.
  - **Forbid the `style` attribute and emit alignment as classes.** Rejected: it would require
    rewriting markdown-it's table renderer and a matching CSS layer, to avoid a per-element
    property that is already sanitized.
