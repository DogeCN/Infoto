# 0017: Web Fonts Race Google's China Endpoint Against the Global Host

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: ADR 0011 settled on a single font source, `fonts.googleapis.cn`, and had a guard
  test asserting the global host stayed out of the page. That left font CSS as a hard dependency
  on one endpoint, which ADR 0006-revised had already named as the accepted cost of dropping its
  mirror. The measurements behind 0011 argue the second source is worth having: fetching 14 of
  the family's `woff2` subsets took **45 s with zero failures** from `fonts.gstatic.cn` against
  **102 s with two failures** from `fonts.gstatic.com`. A source that fails two of fourteen
  subset fetches is a real fallback, not a duplicate. 0011 rejected racing the two on the grounds
  that "both are Google's own endpoints serving identical CSS, so racing them adds a request and
  a script to pick between two copies of the same thing" — that reasoning holds only while
  neither copy fails, and 0011's own numbers show one of them does.
- **Decision**: Load one stylesheet per endpoint and cancel the losers. `FONT_SOURCES` is a list
  of matched `{ css, files }` pairs — a stylesheet rewrites its own `src:` URLs onto its own file
  host, so the pair is the unit and the CSP allows both halves of each. Order is preference, not
  priority: nothing waits for the first entry.
  - `fonts.ts` emits a preconnect to all four hosts, then **the script, then the stylesheets** —
    in that order, and the order is load-bearing. A pending stylesheet blocks execution of the
    scripts that follow it, so a race script placed after the links cannot start until the
    _slowest_ source has already downloaded. Measured: with the script last it ran at 1516 ms,
    exactly when the deliberately-slow endpoint answered, so it only ever chose between two
    sheets the browser had already paid for. Because the links arrive after the script, it claims
    each one through a `MutationObserver`, whose callback runs at the end of the parser's
    microtask checkpoint — before any response can land.
  - **The first stylesheet to load wins and every other link is removed in the same task**, so a
    loser never applies the families and never triggers its own `woff2` downloads. A source that
    _errors_ removes only itself and leaves the rest racing; a link already detached ignores its
    own late events, so a removed link can never settle the race afterwards. When every source
    fails, nothing is left declared and `display=swap` keeps the system fallback.
  - **What "cancelled" means was measured, not assumed.** With a fast endpoint answering in 0 ms
    and a slow one delayed 1500 ms, the loser's link was detached at **221 ms** — the cancellation
    genuinely precedes the slow response. The loser's HTTP response may still reach the network
    stack (it did in the probe: the server wrote it, the browser discarded it), so what is saved
    is the _application_: no `@font-face` is ever declared by a loser and none of its `woff2`
    files are requested. The duplicate CSS response itself is not guaranteed to be saved.
  - **The error page runs the race script by SHA-256 hash**, not by re-opening
    `script-src 'unsafe-inline'`. `FONT_RACE_SHA256` sits beside the script text and `fonts.test.ts`
    recomputes it, so the CSP and the script cannot drift. This is narrower than ADR 0006, which
    needed `'unsafe-inline'` and whose removal was one of that ADR's stated wins.
  - Families and weights are unchanged. The USTC mirror stays retired: its TLS handshake still
    fails from here, so it would contribute a console error per load and no redundancy.
- **Consequences**:
  - Font CSS is no longer a single point of failure. A dead or blackholed China endpoint no
    longer blocks the typeface, and the cost of the redundancy is one extra stylesheet request
    that the loser cancels.
  - **The error page carries a `<script>` again**, which reverses the property ADR 0006-revised
    called a real narrowing and that `errors.test.ts` asserted. The page still has no other
    JavaScript, and the hash keeps the hole closed to everything except this one script.
  - Both endpoints are Google-operated, so neither leg carries the third-party proxy trust
    problem that ruled the USTC mirror out.
  - `display=swap` still bounds the failure mode: until a winner declares, and permanently if
    both fail, text renders in `system-ui`.
  - The race script is covered by contract tests over a stub DOM — first-to-load cancels the
    others, a failed source removes only itself, a source that applied before the script ran
    still wins — so the cancellation rule is verified rather than asserted. Those stubs could
    not see the ordering bug above (an event that fires before a listener is attached), which is
    why the placement and the timing were additionally measured in a real browser.
- **Alternatives considered**:
  - _Race the USTC mirror_ (what ADR 0006 did): still rejected. Its handshake fails from here,
    reproduced during 0011 (`SEC_E_ILLEGAL_MESSAGE` from schannel while TCP connect succeeds), so
    it would add a console error per page load and no redundancy. The standing rule is unchanged:
    a source enters the build only after an end-to-end check, and a mirror that completes a
    handshake would qualify.
  - _Race with a load timeout_ rather than relying on the load/error events: rejected for now —
    a source that hangs is indistinguishable from a slow one, and `display=swap` means the page
    is readable either way. If a hanging endpoint ever needs cancelling, a timeout is the thing
    to add, and it should come with a measurement behind its value rather than a guessed constant.
  - _Self-host the font files_: still rejected. Noto Sans SC at the weights the UI uses is large
    to ship on every response path, and the race now covers the failure that motivated it.
