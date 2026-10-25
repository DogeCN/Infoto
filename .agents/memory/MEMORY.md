# Infoto — Long-Term Agent Memory

> **Purpose**: Single source of truth for all AI agents working on Infoto. Records only **still-effective** conventions, pitfalls, and architectural decisions. Do not record transient task progress or debugging steps.
>
> **Update trigger**: User states a new rule, a design decision is finalized, or a pitfall is discovered.
>
> **Daily logs**: `YYYY-MM-DD.md` for decision rationale, verification records, and process details.
>
> **Scope**: this file is **overwritten** as conventions change. Anything that answers "why did we do it this way" belongs in a permanent ADR under the sibling `../adr/` directory instead.

---

## Hard Red Lines (violating = rework)

1. **No compatibility fallbacks**: Schema/data-model evolution never adds `DEFAULT` fallbacks, legacy tiebreaks, or "field missing → fallback". If incompatible with existing data, directly reset the table (local: DROP+CREATE; production: export→import via `/admin/migrate`). Prefer data loss over silent fallback.
2. **No invented percentages**: If there is no real measurable granularity, use indeterminate (shimmer/sweep) progress — never fabricate fractional percentages.
3. **`schema.sql` / `schema-ddl.ts` byte-identical**: `npm run gen-schema` regenerates the latter; enforced by `src/worker/schema-alignment.test.ts`. **Edit `schema.sql` and regenerate, never hand-edit the generated file.** (Promoted to a red line 2026-09-27 — it was only a parenthetical in the key-files table, which is too weak for an invariant with a test behind it.)
4. **Run `npm run lint` + `npm run ts-check` + `npm test` before finishing every task** (full green required).
5. **Layer dependency direction is strict**: `routes → components → state/core → base`; `base/` must never import business-layer code.
6. **Routine work does not touch `.agents/memory/`**: written only on a stated rule, a finalised decision, or a discovered pitfall.

---

## User Preferences

- **Visual**: v1 aesthetics only — blue-black stepped background (`#0a0e1a`/`#0f1524`/`#151c2e`/`#1a2238`/`#1e2640`). Dark theme + primary cyan `#22d3ee`. "Neutral near-black" is deprecated.
- **Lighting**: No page-wide diffuse glow; in-control dynamic effects (inset highlight, progress fill, shimmer) are acceptable.
- **Minimalism discipline**: No unnecessary backgrounds/borders/divider dots; lucide icons only, no duplicates or unreferenced icons.
- **Interaction structure** (topbar / sidebar / masonry / gestures) — do not change lightly; only move toward clean and spacious.
- **Visual reference**: `https://rayburst.pages.dev` — Inter Var negative tracking, 14px rounded cards without shadows, hairline borders, asymmetric timing (`--ease-enter cubic-bezier(0.2,0,0,1)` / `--ease-exit cubic-bezier(0.3,0,0,8,0.15)`).

---

## Design Tokens Are the Single Source (2026-10-02)

A normalization pass removed ~30 hard-coded colour literals and ~13 magic millisecond values from the frontend. Both drift silently — a literal does not follow the token it was copied from. The rules that came out of it:

- **Never re-type a palette colour or a shadow in a component.** `#22d3ee` is `--color-primary`, `#f43f5e` is `--color-destructive`, `0 4px 12px rgba(0,0,0,.4)` is `--shadow-md`. The three mark colours are tokens, not arbitrary values: like = `destructive`, dislike = `dislike` (`#3b82f6`), report = `warning`. Media and panel surfaces share `--radius-card` (14px).
- **JS-driven animation reads the tokens, it does not restate them.** Web Animations, Svelte `transition:` params and JS timers cannot see a CSS custom property, so `web/src/base/lib/motion.ts` resolves `--duration-*` / `--ease-*` from the document (with `@theme` values as fallback) and `motionEaseFn` converts a `cubic-bezier(...)` token into the `EasingFunction` Svelte expects. Re-typing `cubic-bezier(0.2, 0, 0, 1)` in a component is how the token file and the components diverged.
- **The top bar publishes what it measures.** `barCssVars` emits `--bar-h` _and_ `--bar-icon` / `--bar-badge` / `--bar-badge-text`; eight `size-[calc(var(--bar-h)*0.3125)]` strings became `size-[var(--bar-icon)]`. Same rule as §Responsive Layout: one measurement, no re-derived formula downstream.
- **Enter and exit are different pairs**, but a single class driving both directions runs at enter timing on close. When both matter, derive the duration/ease from the state (`MultiSelectBar` is the worked example).
- **One disabled treatment** (`--control-disabled-opacity`, applied by `button:disabled` in `@layer base`) — do not re-add per-site `disabled:opacity-*`, and do not override `button:disabled{cursor:not-allowed}`.
- **Third-party CSS is a second palette unless every variable is bound** (2026-10-12). `@tailwindcss/typography` styles `.prose` entirely through `--tw-prose-*` variables and ships a **light-surface** default (body `oklch(37.3% .034 259.733)`, near-black), which renders as a dark slab on this palette. `app.css` binds all sixteen to site tokens, body → `--color-foreground` (measured 15.62:1). **The sweep when adopting a CSS plugin is `grep -o '\-\-tw-prose-[a-z-]*' dist/assets/*.css` and bind what it reads** — nothing in the plugin's palette is derived from `@theme`, so the tokens do not reach it for free.
- **Markdown follows `github-markdown-css` for its non-interactive elements** (2026-10-12). Colours are mapped onto site tokens rather than pasted, because GitHub's values assume a white canvas (`#1f2328` on `#ffffff`); what is borrowed is the tonal _relationship_ (body brightest → one muted tier for quotes/lead/markers/captions → borders quietest). Structure is taken directly: **every heading at one weight** (GitHub's rule), the 2/1.5/1.25/1/.875/.875 ladder, a hairline under h1+h2, the quote as `0 1em` + a `0.25em` bar at weight 400 upright, lists at `2em`, `hr` as a `0.25em` band, inline code as a `.2em .4em` / 6px / 85% chip, tables as body-size text on a collapsed 1px grid with zebra rows. **Links keep the site accent and `MarkdownView`'s own media/file affordances are untouched** — interactive elements sit outside this palette, deliberately.
- ⚠️ **A plugin's variant can shrink a block below the body size, and only a measurement shows it.** `.prose-sm` sets `table { font-size: .857143em }` — **12px against the 14px body** — so every cell read smaller than the prose around it. GitHub sets no table size at all: a table is body text in a grid. Fix is `font-size: 100%`; check every element the variant touches, not just the ones that look wrong.
- **A wide table scrolls as a block, it does not wrap.** GitHub's `display: block` + `width: max-content` + `max-width: 100%` + `overflow: auto` is what makes that work, and it also makes a narrow table hug its content rather than stretch. Measured: 10 columns in a 360px column render 360px with `scrollWidth > clientWidth`; 2 columns render 122px.
- ⚠️ **A third-party library's `::before`/`::after` are text, and text gets copied.** The plugin injects `open-quote`/`close-quote` around a quote and a literal backtick around every inline `<code>` (`content: "\`"`). Both were overridden to `content: none`, matching GitHub. Fenced code was already `none`via the plugin's own`pre code`reset, which made the code case look inline-only. **These two are the complete set** —`designTokens.test.ts`asserts both and that the layer adds no`content:` string of its own.
- ⚠️ **`img.complete` is `true` inside a `<template>`, with `naturalWidth === 0`** (2026-10-18). The image has never started a load, and Chromium reports that "nothing pending" state as complete. So a `complete` shortcut runs a measure step with no dimensions, its `w > 0 && h > 0` guard skips, and the holder stays on its `aspect-ratio: 16 / 10` placeholder — every image letterboxed in a box of the wrong shape, with the rounded corners landing on empty space instead of the picture. **`complete` means "not loading", not "loaded": require `naturalWidth > 0`.** This is the general trap whenever parsing is moved into a template — every "already loaded?" check written for a live element now answers yes. Verified after: 800×600 fills a 360px column at 360×270, 600×900 at 360×540, both rounded.
- ⚠️ The plugin's own heading weights are **800/700/600/600/400/400**, so h5 and h6 shipped at _body_ weight and were the faintest thing on the page; that, not colour, is what made the text read thin. **A third-party library's weights are part of its palette — read them, do not assume the ladder is consistent.** The reference values were fetched from `cdn.jsdelivr.net/npm/github-markdown-css@5` rather than recalled, per the "never invent an external value" rule.
- ⚠️ **Tailwind 4 cascade layers beat source order, and that is invisible in a diff.** `.prose-invert` lands in `@layer utilities` and re-declares the same variables; a correct binding written in `@layer base` loses regardless of where it appears in the file, with no error and no readable clue in the built CSS. Bind in the **same layer, later in order**. The `:where()` structural overrides rely on order _within_ the layer for the same reason — and because `:where()` has zero specificity while the plugin's own rules are not `:where()`, order is the only thing making them win, so verify in a browser rather than reasoning about it. The site puts both in `@layer utilities` and `designTokens.test.ts` asserts the layer, because this failed exactly once with a rule that looked right in review.
- **A rhythm margin only looks wrong when nothing absorbs it** (2026-10-12, CONTRACT §4.13). The typography plugin gives every `img` in `.prose` a `1.71429em` top/bottom margin, which equals `prose-sm`'s `line-height: 1.71429` **exactly** — so an image between two paragraphs reads as precisely one blank line, and that is the intent. A block of _only_ images has no neighbour to absorb it and shows 24px of raw whitespace, and the plugin's own `.prose > :first-child { margin-top: 0 }` **cannot absorb it because the margin lives inside the wrapping `<p>`, not on it** — the reset only zeroes the `<p>`'s own margin. Fixed by collapsing it only where the image opens or closes the block (GitHub gives a lone image no margin at all). ⚠️ Measure from the element **above** the prose block: an `img` margin collapses out of its `<p>`, so measuring from the top of `.prose` reads a different number than the rendered gap. ⚠️ The blanket `.prose :where(img) { margin: 0 }` looks obviously right and flattens every multi-image announcement; `designTokens.test.ts` rejects it.
- ⚠️ **A colour utility on a component's `class` beats the component's own variable.** `class="text-muted-foreground"` on `MarkdownView` set `color` on the container and dragged every paragraph from 15.62:1 to 5.23:1. Variables on the container only reach _descendants_ through `:where()` rules, so an outside utility wins outright. Keep `class` for layout (width, margin); tone a surface from inside.

---

## Shared Owners Added (2026-10-02)

Each of these exists because the logic had two hand-written copies that had already drifted:

- `web/src/base/lib/motion.ts` — motion tokens (above).
- `web/src/base/lib/num.ts` — `clamp01`/`clamp`; progress fractions and slider positions clamped the same way.
- `web/src/base/lib/hover.svelte.ts` — `createHoverIntent`; instant enter, debounced leave, for every hover-revealed surface. It must be a rune module: state behind a plain function call is opaque to `$effect`, which froze every timestamp's hover at `false`.
- `web/src/base/lib/clipboard.ts` — `copyToClipboard` returns a boolean so callers keep their own copy labels (base/ may not import `copy.ts`).
- `web/src/base/lib/device.svelte.ts` (2026-10-25) — `canHover()` (one reactive `(hover: hover)` signal) and `prefersReducedMotion()` (one `(prefers-reduced-motion: reduce)` query). It is **not** an `isMobile` flag: hover capability, a component's measured form and motion preference are independent, and merging them is how UploadPanel lost its chevron. Tooltip, UploadPanel, PhotoCard and ReorderableList all read from here; never re-type these two query strings.
- `src/shared/json.ts` — `isRecord` / `safeJsonParse`, the one shape guard and lenient parser for both runtimes. It took nine inlined copies to notice that a malformed body is an expected path, not an exception.
- `web/src/lib/components/PollReferences.svelte` — sole renderer for Markdown interleaved with `::poll:<lang>:<id>` references; a reference resolves only when its language and id both match a known poll.
- `web/src/lib/components/EditorDialog.svelte` — sole editor shell: scroll region, action footer, and the overlay. Both admin dialogs pass only their body.
- `web/src/lib/components/pillMeasure.ts` — sole segmented-pill density measurement (clone probe). The deleted alternative summed `invisible` label-copy widths, which is the "hidden copies lie" trap again.
- `AdminCollection` in `web/src/state/appStore.svelte.ts` — one optimistic admin write path (temp id → apply → commit or roll back → deferred reorder) for announcements and polls. The twins had already diverged: announcement delete/reorder toasts had lost the timeout hint the poll and feedback ones carried.

---

## Decisions That Closed Open Questions (2026-10-02)

- **Editor images are not deduplicated.** `putSha` had no production caller, so the sha cache's `'editor'` purpose was unreachable. The cache is now exactly what it is used for — `isKnownAlbumSha(db, sha)` over the snapshot's hashes, replaced wholesale on every sync. The `'editor'` _upload purpose_ in the transcode protocol is unrelated and stays.
- **The admin editor dialogs are modal.** `AnnouncementEditorDialog` said "non-modal panel"; that was the reason it had escaped `overlay.ts`. Both now run through the shared shell: focus trap, scroll lock, `aria-modal="true"`, Escape handled once at the top layer.
- **An admin write's locale is an argument, not a UI read.** `adminClient` used `activeLocale()` while the store filed its optimistic row under `contentLocale` — two sources of truth for one value. Every write now takes the locale explicitly.
- **One test convention, enforced.** `import { test } from 'vitest'` + `node:assert/strict`, no `describe`/`it`/`expect`. A `describe('Group')` + `it('Case')` pair flattens to one `test('Group: Case')`. Regex assertions use `assert.match` / `assert.doesNotMatch`, never `assert.ok(/re/.test(x))`. This is AGENTS §8.2, now actually true of every file in both suites.
- **`expect(...).toEqual` ignores `undefined`-valued keys; `assert.deepEqual` does not.** Converting `uploadClient.test.ts` surfaced it: the result carries `detail: undefined` for a non-JSON error body, and the old expectation passed only because Vitet ignored it. `node:assert` is the stricter check — good, keep it, and write the `undefined` field explicitly rather than loosening the assertion.

---

## Local Dev Environment (Pitfalls)

- **NEVER `Stop-Process -Name node` / `taskkill /IM node`**: Kills the agent's own shell bridge, causing all subsequent Bash/PowerShell tools to fail with `command expected string / undefined`. To clear a port: `Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`.
- Start dev: `npm run dev` at repo root = Worker(8787) + Web(5173) + `db:local` (idempotent, does not clear data). **Never `nohup npm run dev:worker &`** (creates competing workerd processes fighting for :8787).
- Dev proxy `cookieDomainRewrite` is empty, so the session cookie stays host-only. Rewriting it to `Domain=localhost` drops the cookie on any non-localhost dev host.
- **Never start `npm run dev` on top of a previous instance.** A stray vite still bound to 5173 makes the new one fall back to 5174, and _both_ proxy the single Worker on 8787 — the doubled cold-start traffic triggers workerd "runtime crashed unexpectedly" restarts. It self-heals, but is noisy and avoidable. Always free 8787 / 5173 / 5174 (`Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`) before starting dev.
- wrangler reports Ready but curl hangs = zombie workerd on port; kill `workerd.exe` and restart. localhost unreachable → try `127.0.0.1` (local Vite only listens on IPv6 `[::1]:5173`).
- After renaming a module export, vite may serve stale transform → `touch` the file to invalidate watcher cache.
- **Temp scripts must never live in `web/` root** (triggers full-page reload, log spam = reload storm, can crash Worker). Put them in `scripts/` or use `.tmp-*` patterns.
- **A corrupt `node_modules` looks like a code bug.** A partially-extracted `@lucide/svelte` (its `dist/lucide-svelte.d.ts` barrel missing) produced 22 "Could not find a declaration file" errors from `svelte-check`, and a stale `web/node_modules/vite` produced the rest — neither is a repo defect, and CI (fresh `npm ci`) was green the whole time. **Before chasing a wall of type errors, compare the installed version against the lockfile.** Repair by re-extracting the one package from its `resolved` tarball, not by editing `node_modules` or the lockfile.
- **`npm ci` can leave the tree worse than it found it.** It unlinks first, so an `EPERM` on a locked native binary (`lightningcss.win32-x64-msvc.node`, held by a running dev stack or antivirus) aborts _after_ deleting most of `node_modules`. `npm install` is the safe recovery: it re-adds without unlinking.
- `npm install` backfills `license` into `package-lock.json` from `package.json` — revert that line rather than committing unrelated lockfile churn.
- **PowerShell often returns empty output for `npm run` / `npx`.** Redirect with `*> file` and read the file back; `$LASTEXITCODE` alone is the reliable signal.
- **Inline PowerShell `$` variables get stripped** by the command tool: `foreach($p in …)` becomes `foreach( in …)` → parse error. Workaround: write the script to a `.ps1` file and run `powershell -ExecutionPolicy Bypass -File script.ps1`; prefer `netstat -ano | findstr` + `taskkill /PID <pid> /F` over complex inline PowerShell when feasible.
- **`npm run dev` self-heals its ports** via a `predev` step (`scripts/free-dev-ports.mjs`) that kills whatever holds 8787 / 8788 / 5173 / 5174 and stops a leftover wrangler supervisor. Two traps that cost real time, both now encoded in the script and in AGENTS §9:
  - **`Get-NetTCPConnection` lies about loopback listeners** — it reported free ports that netstat showed as LISTENING. The decisive detail: a bind probe for `127.0.0.1:5173` **succeeds** while Vite holds `0.0.0.0:5173`, because Node sets `SO_REUSEADDR`. Any "is this port free?" check must read the socket table, not probe a bind.
  - **workerd respawns.** Killing the listener is undone in milliseconds by the wrangler above it, and several stacked instances leave 4+ processes on 8787 with rotating PIDs plus workerd "runtime crashed unexpectedly" loops. Killing the listener's _parent_ is required.
  - On this host neither `wmic` (removed from Windows) nor `Get-CimInstance` (type initializer throws) can walk the process tree. `taskkill`'s own output does: `PID a (child process of PID b) has been terminated` — parse the topmost parent from it.
- **IDE "cannot read file node_modules/X/tsconfig.json" is benign.** Some dependencies (e.g. `mediabunny`) ship `.ts` source without a `tsconfig.json`; the TS server expects one and reports it missing. Do **not** "fix" it by editing `node_modules` (wiped on `npm install`). It does not affect `tsc`/`svelte-check` (they use the published `.d.ts`, and `skipLibCheck` is on).
- **HMR leaves stale modules** after repeated edits to one file — symptoms are "not defined" errors for symbols that _are_ defined. `page.goto(url + '?t=' + Date.now())` forces a full reload and is the reliable fix; `touch` is not enough.
- **Browser width probes need a real settle.** The `ResizeObserver + rAF` chain needs ~200ms; sampling at 8ms reads the previous frame's value and looks exactly like a jump. I mis-diagnosed "468–482 still flapping" as a real bug because of this — it was a sampling artifact.
- After changes, run `npm run lint` (includes `prettier --check`, catches unformatted files).
- **The image host is a separate deployable, not part of this Worker.** The external facade owns `TC_SECRET`, signs each request, and forwards it to the real host, returning the upstream URL verbatim (reference implementation removed from this repo's history in v0.1.2; contract in README §Media host facade). It is deliberately stateless: no KV, no user identity, no per-request state — a thin relay that can be swapped or replaced without touching the album. Already-uploaded photos keep working across a host swap because the old host keeps serving them; only new uploads move.
- Infoto has **no `/upload` route and no `TC_SECRET`**. It only stores the URL and names the facade in the `/sync` response as `mediaHostUrl`; the page pushes that to the SharedWorker through the `mediaHost` message (the SW is shared across tabs and outlives any one page, so it cannot call `/sync` itself). Repo variable `MEDIA_HOST_URL` = the facade origin; the deploy workflow hard-fails without it. **There is no fallback host anywhere** — not in the Worker, not in the client: an unset value yields an empty `mediaHostUrl`, and the SW fails the job with `media_host_unset` instead of guessing a host to send someone's photo to.
- Browser → facade requests are cross-origin and must stay **credential-free** (`credentials: 'omit'`, `xhr.withCredentials = false`). A lock test guards this — the session cookie must never reach the facade.
- `media.ts` trusts loopback URLs only while `MEDIA_HOST_URL` itself names a loopback origin — i.e. `.dev.vars` points it at the local simulation. A deployed facade is a real HTTPS host and gets the strict HTTPS+public-host rule; an **unset** value gets no exception either, because "unset" is a misconfigured deployment, not local dev. That exception is the SSRF guard's single hole — compare parsed origins, never string prefixes (`http://127.0.0.1:8788.evil.example` shares a prefix and must stay refused), and a different port than the configured one is a different origin and stays refused.
- **The local stand-in's port is written once, in `MEDIA_HOST_URL`** (2026-10-19, revised the same day): the Worker loads `.dev.vars` through wrangler, and `dev:media`, `predev`'s port sweep and `web/playwright.config.ts` read the same value through `scripts/dev-config.mjs`. `LOCAL_MEDIA_HOST_URL` as a hardcoded `src/` constant was removed — it had to be changed in lockstep with the port and was the one place that would silently go stale. The first attempt kept the port in `package.json`'s `config.mediaPort` as a second copy; that was the same drift in a new file and is gone. The stand-in (`scripts/local-media-host.mjs`, gitignored `.local-media/`) must answer CORS like the real facade, otherwise dev fails for reasons production would not.
- `.dev.vars` is **gitignored, `.dev.vars.example` is tracked** (wrangler's own convention: `.dev.vars*` ignored, `!.dev.vars.example` kept). Its values are not secrets — Cloudflare's published always-pass Turnstile test keys and a loopback origin — but the file is where a developer would paste real keys for a local run, so tracking the template rather than the file keeps that copy local. `scripts/dev-config.mjs` reads `.dev.vars` first and falls back to the template, so a fresh clone runs `npm run dev` before copying anything.
- ⚠️ **A Worker-owned route is invisible behind Cloudflare's asset layer** (2026-10-18, CONTRACT §4.15). Assets are checked before the Worker, and a request the asset layer does not serve **never reaches it**. It declines two ways: a browser **navigation** to a path with no asset gets `index.html` from `not_found_handling` without invoking the Worker, and **any non-GET/HEAD** gets a bare `405` with `Content-Length: 0`. First episode: a copied `/l/<id36>` link showed the SPA's own 404 while `curl` returned the image. Second, the next day: every API write (`POST /sync`, `/admin/announcements`, `/admin/polls`, `/admin/feedback`) was a 405 in production while the GETs stayed healthy — because the list had been written as "paths a person navigates to", which no `fetch` ever is. `run_worker_first` in `wrangler.toml` lists **every path the Worker serves**, each collection base bare _and_ with `/*` (Cloudflare does not document whether `*` crosses `/`), and `src/worker/assets-routing.test.ts` asserts the list against `createApp()`'s route table — a new route that is not listed fails `npm test`. `/` and `/admin` stay with the asset layer; that is what serves the SPA shell.
- ⚠️ **A `curl` is not a browser, and `wrangler dev` is not the edge.** Reproducing that bug needed `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`; `Accept: text/html` alone did not, and a 405 has no body to read at all. Local `wrangler dev` routes every request to the Worker so it shows neither. Do not conclude "works" from either — probe the deployed origin with the method and headers the browser really sends.

---

## Identity & Turnstile

- Identity cookie `uuid` is set by Worker as **HttpOnly** → frontend `document.cookie` cannot read it. **Never** use "cookie exists" to determine authentication; whether authenticated can only be answered by the server → always probe `/sync` first.
- **`users.id` has no AUTOINCREMENT — the id is computed inside the INSERT** (`VALUES ((SELECT COALESCE(MAX(id), -1) + 1 FROM users), ?, ?)`) and the row is read back by uuid. Never split that into "SELECT MAX(id)" then "INSERT": that read-then-write let simultaneous first visits pick the same id. The original code caught the violation and retried 3 times, which measured fine for 2–3 racers and threw on the 4th — a shared album opened by a group is exactly that case. `identity-concurrency.test.ts` locks 8 racers, and it fails against the old shape, so the window cannot come back unnoticed.
- Turnstile widget must `turnstile.remove(widgetId)` before removing DOM, otherwise orphaned widget keeps polling and errors. After token returns, **do not** remove immediately (iframe handshake not complete, postMessage goes to removed window); delay ~800ms, hide overlay during this time.
- In dev, site key is injected by vite from root `.dev.vars` as `VITE_TURNSTILE_SITE_KEY` (fallback only when 401 body missing).
- Cloudflare's published always-pass secret `1x0000000000000000000000000000000AA` accepts any non-empty token and does not call siteverify. A missing secret, an empty token, and every other secret still fail closed. Do not treat that short-circuit as a bypass for the production secret.
- **The deploy workflow's test secret must be that exact published value** — it is not any "looks like a dummy" placeholder. `deploy.yml` shipped `0x0000…00` for months; siteverify rejected every token against it, so identity creation on the test deployment looped through the challenge forever while CI stayed green (nothing exercises the deployed secret). The workflow and `ALWAYS_PASS_SECRET` in `turnstile.ts` cross-reference each other in comments — keep them in sync.

---

## Web Fonts (2026-10-12, ADR 0017)

- **Two Google endpoints race**: `fonts.googleapis.cn` / `fonts.gstatic.cn` against `fonts.googleapis.com` / `fonts.gstatic.com`. Both stylesheets load concurrently; the first to load removes every other link **in the same task**, so a loser never declares the families and never triggers its own `woff2` downloads. A source that _errors_ removes only itself and leaves the rest racing, and a detached link ignores its own late events so it can never settle the race afterwards. `display=swap` keeps text readable on `system-ui` while it loads, and permanently if both fail.
- **A source is a matched `{ css, files }` pair**, not a host. A stylesheet rewrites its own `src:` URLs onto its own file host, so the pair is the unit and the CSP allows both halves of each — a half-updated constant gets every font file blocked by `font-src` rather than falling back. `FONT_SOURCES` is the list; order is preference, not priority, and nothing waits for the first entry.
- ⚠️ **The race script must come BEFORE the stylesheet links, and it claims them with a `MutationObserver`.** A pending stylesheet blocks execution of the scripts that follow it, so a race script written after the links starts only once the _slowest_ source has already downloaded — measured at 1516 ms against a deliberately-slow 1500 ms endpoint, i.e. it only ever chose between two sheets already paid for. Put the script first (only preconnects precede it, and a preconnect is not a stylesheet) and let the observer claim each link on insertion: its callback runs on the parser's microtask checkpoint, before any response can land. The same trap loses events outright — a `load` listener attached after the fact never hears a load that already happened.
- **A link that already applied never reports `load` again**, so the script reads `link.sheet` — but only _after_ registering every link. Settling while still registering leaves the winner with nothing to cancel, which is how the early-winner case silently failed the first time.
- **"Cancelled" means the link is detached, not that the socket is closed.** Measured: with a 0 ms endpoint and a 1500 ms one, the loser's link was gone at **221 ms** — but the server still wrote its response and the browser discarded it. What is saved is the _application_: no `@font-face` from a loser, no `woff2` requested. Do not promise the duplicate CSS transfer is avoided.
- **Never put a backtick or `</script` inside the script literal.** It is inlined between tags, and a backtick closes the template literal it is written in — a compile error that cost one round here. `fonts.test.ts` asserts both.
- **Do not put instrumentation inside the CSP'd page.** A probe that adds its own `<script>` is blocked by the hash (correctly), so it reports "the race did nothing" when the race is fine. Test CSP authorisation and race mechanics in two separate loads.
- **The error page runs the race script by SHA-256 hash**, not by `script-src 'unsafe-inline'`. `FONT_RACE_SHA256` sits beside the script text in `fonts.ts` and `fonts.test.ts` recomputes it from that text, so CSP and script cannot drift. The page's only `<script>` is the race; do not re-add `'unsafe-inline'` for script-src, and note the glitch's JS half stays Worker-less (§CONTRACT 4.8).
- **Why the race came back**: ADR 0011 rejected racing the two as "two copies of the same thing" without measuring either copy's failure rate, and its own measurement contradicts that — 14 subset fetches took 45 s / 0 failures from `.cn` against 102 s / **2 failures** from the global host. **"The same thing served twice" is a redundancy argument only after both copies have been observed failing** (CONTRACT §4.12). A shared vendor is not a shared failure mode.
- **Do not add a font mirror without verifying it end to end.** The USTCLUG mirror that ADR 0006 raced was adopted from a published hostname and never tested — it failed at TLS negotiation, not HTTP (`SSL_ERROR_NO_CIPHER_OVERLAP` in Firefox, `HandshakeFailure` from OpenSSL, while TCP 443 connected). So that race only ever produced a console error and no redundancy. TCP-connecting proves nothing about a font mirror. It stays retired.
- One helper, `src/shared/fonts.ts`. Vite injects it at `<!-- fonts -->` in `web/index.html`; the Worker error page inlines the same helper. Families and weights unchanged.
- **A hanging source is not cancelled** — the script settles on `load`/`error` only, with no timeout. That is deliberate: a hang is indistinguishable from a slow source, and `display=swap` keeps the page readable either way. If a hanging endpoint ever needs cancelling, add the timeout **with a measurement behind its value**, not a guessed constant.
- Do not vendor Noto Sans SC to paper over a dead host.

---

## Internationalization (finalized 2026-09-27)

- `src/shared/copy.ts`: locale keys are **full BCP-47 tags** browsers actually report (`en-US` / `zh-CN`); `pickLocale` is exact lookup, **intentionally no subtag folding** (`pickLocale(['zh'])` falls back to `en-US`, pinned by test). `LocaleCode = keyof typeof locales`; adding a language = write a table + add a row to `locales`.
- **Two copies serve different purposes** (mixing component/pure-module causes "switched but no effect"):
  - **Components** (`.svelte`) import from `$lib/i18n.svelte` — that's a `$state` object, template reads have reactive dependency.
  - **Pure modules** (toast / api / pipeline) import from `$shared/copy` — that's a `new Proxy` live view, `setActiveLocale()` switches, reads at call time.
  - **Components must never use the Proxy version**: proxy reads are invisible to Svelte reactivity, template will not re-render.
  - **`$state(table)` deeply proxies and writes through into `locales`**, permanently polluting the language table silently → must use `$state({ ...locales[initial] })` shallow spread.
  - **Svelte forbids exporting `$derived` from modules** (`derived_invalid_export`), only `$state`.
  - **Module-level constant tables freeze language**: `base/upload/pipeline.ts` error text tables have been changed to `Record<string, (c: Copy) => string>` lazy extraction. After adding new languages, any "module-level `copy.x` snapshot" must be changed this way.
  - **Component-scope `const` freezes it too**, and is the more deceptive case — it _looks_ like it lives in the component so you expect a re-render. `SettingsPanel`'s `TYPE_LABELS` was a plain `const` and left every filter tooltip in the previous language; it is a `$derived`. Any `const X = { … copy.y … }` needs auditing. `grep "const [A-Za-z_]* = copy\."` is the sweep.
  - Component `const x = copy.foo.bar` also freezes → use `$derived`.
- Worker side **must never call `setActiveLocale`** (one isolate serves all languages); `errors.ts` `notFoundPage`/`serverErrorPage` accept `request`, parse by `Accept-Language` and output `Content-Language` + `<html lang>`.
- Guards in `src/shared/copy.test.ts`: key sets exactly match enUS / plural forms only allow categories the locale can actually produce / zh table leaf-by-leaf comparison against enUS for untranslated (4-item whitelist). `copy.test.ts` cannot detect "translated wrong".
- **`copy.ts` owns every user-facing string, and no other source file may hold Han text.** That is a stated rule (restated 2026-10-12), and `copy.test.ts` enforces it as a source-file scan, so the exemption is deliberate rather than an oversight: `scripts/seed-content.md` carries both locales' dev seed rows and is not a source file. A literal in a `.svelte` template, an `aria-label`/`placeholder`/`alt`, or a `toast.*` string is a violation even when it reads naturally — add a key to both tables and read it through `$lib/i18n.svelte` or `$shared/copy` as the layer requires.
- User preference stored in `infoto-locale` (**independent key, not in settings blob**); settings panel "Layout" section dropdown is the entry, switch takes effect immediately.
- **Do not clear `loadedUrl` on photo switch**: a pre-warmed neighbour is already decoded, and blanking it flashes the skeleton over media sitting right there in cache. Each media element reports its own arrival; a URL being left simply stops matching.

---

## Lightbox Media Sizing & Loading (2026-09-27)

- **Never size `<img>` / `<video>` with the `width`/`height` attributes here.** They are presentational hints that set a concrete rendered width, which `max-width` can then only _shrink_ — the box stops tracking the aspect ratio. In practice this clipped the rounded corners and pushed the card-corner control off the visible media. Size entirely in CSS via `.lb-box` (see below); use the attributes for nothing.
- **`.lb-box` is the single size formula**, shared verbatim by `.lb-media` and `.lb-skeleton`: `width: min(var(--w), <viewport budget>, <height budget> × var(--ar))`. One formula means the placeholder and the revealed media occupy an identical box, so nothing moves on arrival. `--ar` alone reserves the space before decode, which is what stops a `<video>` opening at the **300×150 CSS replaced-element default** (a `<video>` with no attributes ignores its intrinsic aspect until metadata arrives).
- **The skeleton centres on the wrapper with `left/top: 50%` + `translate(-50%,-50%)`, not `inset: 0; margin: auto`** — the wrapper holds the media itself and is 0×0 until the media has a box; `margin: auto` cannot centre a box larger than its containing block and pinned the skeleton off-centre.
- ⚠️ **Adding `relative` to the gesture wrapper changes the skeleton's containing block.** Re-derive the anchor: with the media loaded the wrapper is centred by the outer flex box (wrapper centre == media centre == viewport centre); before load the wrapper is a 0×0 flex item sitting at the container centre, and `50% of 0 = 0`, so the two coincide. **Any time a `relative` is added inside a gesture layer, re-check every sibling that positions off `left/top: 50%`.**
- **`preload="auto"` on the `<video>`, no manual pre-fetch.** Without it the browser applies its own heuristic and often settles for `metadata`, leaving the decoder starved exactly when the user switches. Measured against our CDN the whole 25MB arrives in **~0.9s (29MB/s)**, so buffering eagerly is far cheaper than the stall. Rejected: `link[rel=preload] as=video` (downloads the _entire_ resource) and a ranged GET of the first 2MB (saves less than the warm-up itself costs, and the `<video>` does not reuse the partial response). Still images **are** warmed with `new Image()`.
- **Counter-scaled overlays must share the wrapper's transition.** A control that rides inside the transform wrapper counter-scales about its corner via `--inv = 1/scale` set in `applyWrap`; because the custom property applies instantly while the wrapper's `scale` animates, the transition string must be written to **both** elements or the control snaps to its final size on frame 1 (reads as a brief shrink, then a pop). `transform-origin: bottom right` keeps the corner pinned.

---

## Unit Suite Shape (2026-09-27)

- Keep the unit suite under 100 cases. Merge related assertions into one case instead of adding a fine-grained test per branch.
- Sync failures, including HTTP 429, do not schedule retries. Tests use fake timers to verify that queued operations remain local until a permitted trigger.

---

## Verification Discipline (2026-09-27, three false conclusions in one session)

- **Never invent a credential, token, or endpoint value for an external service from recollection.** Copy the vendor's published value and verify the pair (e.g. site key ↔ secret, mirror ↔ TLS) against the real service once, end to end. This mistake has now happened twice: the USTCLUG font mirror was adopted from a hostname nobody tested and failed at TLS negotiation (see Web Fonts), and the deploy workflow carried an invented "Turnstile test secret" (`0x0000…00`, on no Cloudflare doc) that made every identity creation fail — silently, because CI never touches the deployed secret. A plausible-looking placeholder is not a test key.
- **Performance numbers must be measured cold, and the same URL at least twice.** A first `curl` hits the CDN cache: the 25MB video measured "≈10s" cold-start-correct is **0.9s** — a full order of magnitude off. A 10× discrepancy means the measurement is wrong before the code is.
- **A/B tests need a fresh browser context each run.** Reusing one session leaves files in the HTTP cache, so "first visible frame 24ms" was pure cache-hit and the change under test was never exercised.
- **Test the worst-case resource, never a small one.** A 0.3MB video validates nothing about a 25MB one; the small-file run is what hid the original bug for two rounds.
- **When the decision is wrong, suspect the input — and the harness.** Twice the Lightbox work stalled on a test that "could not open the lightbox": the waterfall positions cards absolutely and many sit at **negative x** (a column left of the viewport) with a real `boundingBox()`; `page.mouse.click` at an off-screen point **silently hits nothing**. Also, `.will-change-transform` is **not unique** to the Lightbox (masonry cards use it too) — assert on `.lb-meta`. And a per-frame `skeleton? true` count is meaningless if the sampling window spans the switch _away_; restrict to the target's contiguous run.
- **Optimisation needs a ROI check first.** A ~50-line preload for a 0.5s saving, when the preload itself costs 0.43s, is negative value. Write down the arithmetic before writing the code.

---

## Progress Display Discipline (2026-09-27)

- **No invented percentages without real granularity** → use indeterminate (shimmer). Image transcoding = decode / drawImage / convertToBlob three one-shot calls, no intermediate granularity (once added 0.4/0.6 fake milestones, caught by user and reverted).
- **Weights only appear when "combining multiple legs into one 0→1"**. Each leg is a **same-dimension single ratio** (frames/frames, seconds/seconds, bytes/bytes) — naturally objective, no need to explain weights. Whenever you want to combine two legs into one, first answer where the weights come from.
- **The image leg's hashing + disk write is one tee loop** (`opfs.ts#storeArtifact` feeds `hash.ts#teeToHash`, same `for(;;)`), advances together, inseparable. **It is not a continuation of transcoding**: `transcodeImage` returns a complete Blob, hashing consumes the product **after** transcoding ends, during which `bytes` is always 0. **Do not report transcoding progress from this loop** — the user made this exact inference and it is wrong.
- **The video/GIF leg has no hashing phase at all** (ADR 0014): the page worker streams the encoder's output through `opfs.ts#openArtifactSink` into OPFS while hashing the same chunks, and `videoResult` carries `sha256`/`bytes` instead of a Blob. One measured progress (`mediabunny` `onProgress` / GIF `(i+1)/frameCount`) spans encode + mux + write + digest, so the row never resets. `hashing` exists only for images now.
- **A streaming write puts a partial artifact on disk.** Every abandonment path must abort the stream and delete the file: the page sends `abortJob` and waits for `aborted` before terminating the worker (a worker killed mid-write leaves the file locked, and the retry's `createWritable` then fails); the SW deletes the artifact on lease revocation and when dropping a dead owner. Never terminate a video worker that is mid-write without that handshake.
- **A hidden page is not a dead page** (ADR 0014): the page reports `leaseVisibility` on grant and on `visibilitychange`; the reaper keeps the 15 s heartbeat timeout for a visible page but retires a hidden lease only past the 120 s dead-owner threshold. Hiding must never release the lease — the encode is still running.
- **The lease client holds a SET of leases, not one slot** (ADR 0014). The video pool grants up to two concurrent leases to the same page, so a single-slot client stopped the older lease's heartbeat on every new grant; the SW read that silence as a dead page, revoked it after 15 s and re-encoded that job from zero, and the next grant starved the other — two concurrent videos ping-ponged indefinitely, which is what "the row resets and restarts from 0" actually was. `release(jobId)` returns one job's token; `release()` (pagehide / teardown) returns them all. A page-side trace of phase changes and backwards fractions is how this was pinned down; do that before theorising about which subsystem is at fault.
- **`visibilitychange` is fired at the Document**, so it is observed there. A listener on `window` depends on bubbling the Page Visibility spec does not promise, and its silence made the SW reap throttled hidden pages.
- **A batch total is only stated for a fully measured batch** (`transcode/pipeline.ts#batchProgress`): the mean of the rows that measure themselves, or `null` (→ sweep) when any row cannot. `openArtifactSink` accumulates the digest only while chunks continue the byte stream, so a back-patching muxer falls back to hashing the finished file rather than digesting an out-of-order accumulation.
- **hashing leg reports a real fraction** (the "deliberate silent gap" design was dropped 2026-09-27): `teeToHash(source, write, onBytes?)` → `storeArtifact(…, onBytes)` → SW `notifyBytes(rec, total, written)`. Numerator and denominator are **both bytes** (`blob.size` known up front, no second measuring pass). Wired for `runImageJob`. `state/uploadStore.svelte.ts#PANEL_STAGES` gained `'hashing'`; `pendingPhotos` unchanged (card still only at `uploading`).
- Phase breakdown: `queued`/`lease-wait`/image `transcoding` → shimmer; video transcoding start also shimmer (worker startup + demux + codec detection has no reportable quantity); video/GIF transcoding → mediabunny `onProgress` / GIF `(i+1)/frameCount`; image `hashing` → `written/total` bytes; `uploading` → XHR `upload.onprogress` (its leading `fraction: 0` is kept — an honest starting point, unlike the transcode leg's fake one).
- `notifyBytes` three details: `total <= 0` **does not send fraction**; loop **does not report 1** (residue makes next leg start full); only sends when `phase === 'hashing'` (late OPFS callbacks must not pollute another leg).
- ⚠️ **Video progress must filter 0**: `mediabunny`'s first tick is "started, nothing finished", and GIF's first is `1/frameCount` (never 0), so dropping `fraction === 0` is safe and is what keeps the transcode row sweeping instead of pinned at 0%.
- `UploadPanel.indeterminate` needs no phase check for hashing — `fraction == null` already covers it, and a present fraction flips the row to determinate automatically.

---

## Responsive Layout: Measure, Never Guess (2026-09-27)

The top bar went through **three rounds of fixing the wrong thing**. The rule that finally mattered:

- ⚠️ **When the decision is wrong, suspect the input first.** Three consecutive attempts patched `resolveBarMode`'s predicate (hysteresis direction, padding breakpoint, gap count) and all were wrong — the measured numbers were feeding back on themselves: an `invisible absolute` twin measured **215px against a true 258px**. **Two different readings of the same state is a signal the input is broken, not that the predicate needs tuning.**
- ⚠️ **Hidden copies lie about width** (three distinct traps):
  1. `absolute`/`fixed` `offsetWidth` resolves against the **containing block**, not the content → need `w-max` to get a content width.
  2. A probe **inside** the header breaks layout: `fixed`/`absolute` becomes the containing block for the paged `w-[200%]` track and drags both screens off-screen. Put it outside.
  3. `visibility: hidden` **is overridable by a descendant** — a real arrow was painting at the viewport origin. Use `opacity-0` + `pointer-events-none` + `inert`.
- ⚠️ **DOM measurement is not a reactive source.** `clientWidth` read inside `$derived` evaluates once and never invalidates (the bar stayed frozen at 64px). A `ResizeObserver` must write it into `$state`; the derived reads that state.
- ⚠️ **"Does it fit" is the wrong question.** A layout whose requirement is met _exactly_ has its `flex-1` spacer squeezed to 0px and sits one sub-pixel from overflow — measured `slack: 0` at 483px, still flapping with a 500ms settle. The predicate must require **slack** (`BAR_MIN_SLACK_PX = 12`).
- **Hysteresis must be asymmetric**: tightening uses the slack floor (act immediately), loosening uses the hysteresis band (`BAR_HYSTERESIS_PX = 24`). Collapsing both into "does the current mode still have room" makes a downgraded bar **never climb back** — a downgraded mode always has room. That bug shipped and was only caught by testing the widening direction.
- **A height ramp's usable step count is `8 × dpr`** (one CSS px maps to `dpr` device px), so the height is **deliberately not rounded**: on the reference phone (density 540 → dpr 3.375) the 8px ramp has 27 positions, not 8, and `Math.round` throws all but 8 away. On a dpr-1 desktop the rasteriser drops the fraction — same 8 steps, no worse.
- **Structural gap counts are written down but must track the markup.** Arrow lives on both screens → 3 items / 2 intervals per paged screen, not 2 / 1. Miscounting shifted every threshold enough to overflow a 13px window.
- Padding is a **constant** (`BAR_PAD = 12`, the old `px-3`): `px-3 md:px-6` was measured too roomy on desktop and drifting the controls off the window edge. Height ramps 480→1600px (8px over 1120px ≈ one step per 140px).
- **The pager arrow lives on both screens** (outer edge of each). Single-screen placement leaves the other screen with no way to switch — found by measuring, not by reading. Screen 2: arrow left, `flex-1`, buttons hugging the **right** edge. `w-[200%]` track + `w-1/2` screens + `-translate-x-1/2` lands exactly at any bar width. The `rotate-180` shares `--duration-enter/--ease-enter` with the slide, so the flip lands as the arrow arrives.
- Detecting density in a test: read the `tablist`'s `textContent`, **not** a wrapper class (the `invisible`-twin scheme is gone).

## Waterfall: Target Band Width Drives Density (2026-09-27)

- Persist `layout.band` as a CSS-pixel target width (default 260; slider 100–800, step 10). The existing layout engine derives the effective row/column count from the measured cross size and this target width. The floor is 100, not 200, so the same slider can reach a compact phone layout; there is still no viewport-specific default.
- `loadSettings` clamps a stored band to 100–800 and gap to 0–32. A value outside the slider is not a second default.
- At band 100 a card is about 97px wide, and a panorama can be ~30px tall. Mark badges, the error label, and the volume control shrink below 140px wide or 64px tall. A failed video has no mute button — there is no media to mute.
- Direct pixel width stays the control. A viewport-specific default is still rejected. The slider floor is 100px so a phone can choose a compact multi-column view; the untouched default remains 260px, which can still be one column on a narrow screen.
- **Zoom is a uniform scale**: `gap * zoom` and `band * zoom` together. Scaling only the band doubles the gap's share and changes density on the way down.
- The virtualiser's `maxExtent` must be the **real maximum box length** — a tall portrait is far higher than the band and a panorama far wider than one column; under-estimating makes the binary search skip on-screen boxes.
- **Shape changes bump `SETTINGS_VERSION` and drop the blob whole**. v2 column-count settings are discarded instead of being interpreted as pixel widths; no per-field migration — project red line.

---

## Upload Pipeline & Overlay

- **Only one overlay on homepage** `UploadPanel.svelte` (props `tasks` already filtered rows / `progress` / `onRemove` / `hidden`), title built-in. **Editor no longer has overlay** (user decision) — its upload feedback is the save button. `TranscodePanel.svelte` / `UploadProgressPanel.svelte` deleted, do not create a second one.
- Header `icon + title` left, the **remaining count** right (one fading number; the `{done}/{total}` pair read as clutter at header size). Count **describes the overlay's own leg**: `total` accumulates by accepted files, `done` deduplicates +1 when phase leaves transcoding or cancel → **when list is empty, done===total**. Do not change to done/failed or active row count.
- Multi-select causes overlay to slide away (`hidden` → `translate-y-[150%]`): bottom multi-select bar is `fixed bottom-0` full-width z-40, one level higher than overlay z-30.
- **`.upload-panel::before{inset:-8px}`** (expands hover area) **eats inline button clicks**, inner card must have `relative`.
- **Cancel is full-pipeline**: panel row button + card overlay top-right remove. `cancelJob` truly cancels (`uploadAbort.abort()` interrupts in-flight /upload; sends `leaseRevoked` when there is a lease). Image transcoding is in SW thread, **super-large image decode delays UI by hundreds of ms~seconds** is architectural cost, verify with small files.
- **Editor upload takes any file** (2026-10-11): the input has no `accept`, and `uploadEditorFile` + the SW's `addJob` skip the album's `routeByMime` gate for `purpose==='editor'` (no queue, no transcode — `runEditorUpload` hands the source Blob straight to upload, failures always use upload-leg text). `/upload` filename: album explicitly `m.webp|m.webm`, editor infers from source MIME, so the extension survives into the returned URL. `markdownImageRule` then renders `![](url)` as `<img>` / `<video>` / `<audio>` by that extension (video = webm/mp4/mov/mkv/…, audio = mp3/wav/ogg/…). `extFor` in `uploadClient.ts` carries the audio/video MIME→extension table, so its entries are load-bearing, not cosmetic.
- ⚠️ **A DOM post-pass cannot undo a side effect the parser already started** (2026-10-12; superseded by ADR 0019 on 2026-10-18). markdown-it used to render every `![]()` as `<img src>`, and the browser begins fetching that `src` the instant the node enters a **live** document. The fix is no longer a post-pass at all: `markdownImageRule` (the parser's `image` rule) emits the final `<img>` / `<video>` / `<audio>` / `<a download>` itself, so no placeholder element exists and the old inert-`<template>` stage is gone. Measured before: a `.pdf`, a `.zip` and an extension-less URL each downloaded in full just to show a download button, and a video and an audio file each fetched **twice**; after: non-media **zero** requests, each media exactly **one**.
- ⚠️ **A detached _document_ is not inert, and this is the trap.** `document.implementation.createHTMLDocument()` + `innerHTML` **fetches** — verified, it made the request, even though `defaultView` is null and the nodes are never attached. Only `<template>` (and `DOMParser`, also measured) suppress loading. "Detached" is not one property: a document has its own loader, a fragment inside a template has none. This is why the element must be decided before attachment; the renderer rule does that by producing the final markup as a string.
- ⚠️ **Fixing it in the Markdown source is the wrong layer here.** Rewriting non-media `![]()` into `[]()` before parsing does prevent the fetch, but the result is a plain Markdown link — it loses `class="markdown-file"` and `download`, i.e. the button affordance. Implemented, measured, reverted. Keep the classification in the renderer rule; do not change the syntax and hope the styling follows.
- **Panel mode follows its measured presentation, not `matchMedia('(hover: hover)')` alone** (2026-10-25, user request). `drawer = !canHover || compact`, where `compact` is measured from the shell (`rect.left < 8`, i.e. the full-width bottom sheet below `md`). The first cut gated the chevron on `!canHover` alone, so a narrow desktop window showed the mobile sheet **without the arrow** the user asked for — hover capability and layout form are independent signals. Drawer: the header is a real `<button>`, one tap opens/closes, chevron at the right edge shows up=closed / down=open; the corner card keeps hover (enter instant / leave delay 160ms / hit area +8px) plus click-to-pin. The old touch drag through `startPointerResize` is gone — do not reintroduce it; height is `openH = min(headerH + tasks.length * ROW_H + 8, sheetMaxH)` and follows the row count while open. `headerH` is measured (shell − body), with 48 as the pre-measure fallback (py-3.5 + the text-sm counter); the label alone is 44, so a constant is wrong whenever the counter is hidden.
- **The waterfall reserves the upload panel's footprint differently per scroll axis** (2026-10-25): the panel reports `height` (live shell) and `restHeight` (shell − expanding body, stable during the drawer animation) through `onGeometry`; `App` forwards both only when `uploadPanelAtLeftEdge` (mobile full-width).
  - `dir='v'`: spacer after the canvas of `height + bottomSlack` → last row scrolls above the panel (and above an open drawer). Same for `sequential` and `shortest`.
  - `dir='h'`: no scroll-axis room (canvas height = cross, `touch-pan-x`), so **only `restHeight` is subtracted from `cross`** — no `bottomSlack` (user call: extra space pushed the horizontal grid too far up). Every column ends exactly at the resting panel's top edge. Use `restHeight`, not the live height, or every column reflows on each drawer-animation frame. An open drawer overlays a horizontal grid by design; only vertical can scroll past it.
  - `bottomSlack` = two zoomed layout gaps, min 16px, applied **only to the vertical spacer** → follows the gap slider. Desktop panel (bottom-right, 18rem) reports 0 for both heights; it does not span the gallery's bottom edge.
- ⚠️ Bottom spacer must sit **outside** the absolute-positioned canvas: the canvas has an explicit `height: totalH`, so padding/margin on it either eats the layout (border-box) or perturbs it. An in-flow sibling spacer adds scrollable height without touching box geometry.
- ⚠️ **`layoutKey` must include `viewportH` in horizontal mode** (2026-10-25): `cross` is derived from the measured height there, but the key only held width/dir/strategy/band/gap/items, so resizing the window's height (or a mobile URL bar moving) skipped the recompute. It is added only for `dir === 'h'`; adding it unconditionally reflows the vertical grid on every URL-bar move for no reason.
- ⚠️ **A CONTRACT entry is not evidence the code implements it — again** (2026-10-25). §3 said "every overlay control calls `stopPropagation()`"; only the volume button did. The card root is the click target that opens the Lightbox, so dismiss bubbled: it removed the failed card and then ran `handlePhotoClick` on a photo that no longer existed (`Cannot read properties of undefined`), and Retry opened the Lightbox on media that does not exist. `TooltipIconButton.onclick` now receives the event, every card control stops it, and `handlePhotoClick` accepts `undefined` because the laid-out boxes are debounced and outlive the store. Caught by `ui.spec.ts`'s `failed image uploads` pageerror check, which only asserts _no_ error — a silent one is indistinguishable from a clean run unless the assertion exists.
- Collapse **forbids `max-h-0`** (gives child elements zero-width content box, progress bar disappears): use `grid-rows-[1fr]↔[0fr]` or `out:collapse` (`grid-template-rows: tfr`). After last row leaves, shell stays ~280ms more before unmounting.
- **Card insertion timing**: hashing does not insert card (still uploading to insert), but hashing progress is carried by **panel row** (`PANEL_STAGES` includes `'hashing'`) — row is row, card is card, not contradictory. Duplicate only shows Toast.
- Card overlay's "actual media" relies on local object URL (`previewUrlByJob`, revoke on dropTask), `overlay.preview` lets PhotoCard degrade undecodable preview to skeleton.
- ⚠️ **A prewarm in the SharedWorker does not warm the page's cache** (2026-10-25). The card used to swap from the OPFS object URL to the hosted URL the instant `done` arrived, and the SW fetched that URL (no-cors, 2s cap) beforehand hoping the swap would land on a warm cache. It does not: a worker's fetch is not the renderer's cache, so the swap replaced a painted image with bytes the document still had to fetch — the "long loading animation" at completion, and a second download of every artifact. The fix is in the **page**: `ensureHostedReady` fetches with the element that will paint it (`Image`, or a `video` stopped at its first frame), the card keeps the local preview until that reports `ready` (`pendingMediaUrl`: pending→local, ready/failed→hosted), and the SW prewarm is gone. Also seed the preview from the **picked file** at enqueue (`seedSourcePreview`): the OPFS artifact read is async and on a fast link finishes _after_ `done`, so there was nothing to hold. Measured with a 900 ms delay on the hosted response: before, the card's first paint was the unloaded hosted image (skeleton for the whole delay); after, ~52 frames of local preview, swap already complete, 0 blank frames.
- **No auto-sync after upload** (user decision): only `engine.addOp(op)`, relies on page open / pagehide / manual sync to send. Cost is new photos stay as optimistic cards until next sync.
- **Toasts always `expand`**: sonner's hover-expand is a pitfall here (left-swipe close with pointer outside list, `interacting` mark unclear → remaining notifications never expand).
- **Toast 避让底边是实测高度，不是常量**。`UploadPanel` 通过 `onGeometry?.({ height, atLeftEdge })` 上报内层 `ResizeObserver` 的实测高度与"是否贴着视口左边缘"（`rect.left < 8`），`App.svelte` 的 `toastOffsetBottom` 按 `multiMode → 80px` / `panelRows>0 && atLeftEdge → 16px + 实测高度` / 否则 `16px` 取值。左边缘贴边=面板全宽、压在左下 toast 列上；右下角桌面面板不重叠，无需避让。曾用 `matchMedia('(min-width: 768px)')` 断点（与面板 `md:` 恰好同值，所以当时无 bug，但阈值两处各写一遍会漂移），已按"measure, never guess"改为实测。三个坑：① effect 必须依赖 `hidden`（translate 不改 `offsetHeight`，从 hidden 回来高度会卡在 0）；② App 侧回调必须是模块级 `const`（内联箭头每次渲染换新引用，会把子组件的 RO 拆了重建）；③ 单位用 px 不用 rem（实测值过根字号换算会插入误差）。桌面端浮层在右下、toast 在左下，互不冲突，所以只在面板贴左边缘（全宽）时避让。
- **触发 toast 的可靠零副作用路径**：`page.setInputFiles('input[type=file]', '非媒体文件')` → accept 校验拒绝并 toast，不写库。sonner 的 Toaster DOM 只在有 toast 时存在，空闲页面读不到 offset。
- **一次 POST 有两个超时预算（2026-10-06）**：body 还在动时用 `UPLOAD_IDLE_TIMEOUT_MS = 45s`，按*静默*计、每个 progress 事件重置；body 发完（`xhr.upload.onload`，或最后一个 100% progress 事件）切到 `UPLOAD_RESPONSE_TIMEOUT_MS = 120s`，覆盖 facade 转发上游 + 上游落盘这一段。**此前两段共用同一个 45s**，于是大文件恰好在尾巴上被砍——上传停在 100%、卡片幕布停在 `CURTAIN_MAX_OPEN = 0.9`（"卡在最后一点"就是这个幕布），45s 后报 timeout。`timeout` 的 detail 现在区分 `no progress before deadline` / `no response before deadline`。
- **上传腿有自己的并发上限，不复用图片池**：`uploadPoolSize()` = 3（downlink < 2 Mbps 时 2），闸门在 `sw.ts` 的 `acquireUploadSlot` / `releaseUploadSlot`，image / video / editor / resume 四条上传腿全部经过它，交班时槽位直接转给队首等待者（计数不回落，新人无法插队）。图片池（按核数，最多 6）只该管*转码*；用它同时管网络腿会让一次多选上传对同一个上游开出 6 个并发 POST，把一次限流或一次流停滞变成该文件的终局失败（`runUpload` 只尝试一次，没有自动重试）。等待槽位的 job 不上报 fraction，卡片保持全遮，与转码阶段视觉一致。

---

## /sync & Op Layer

- **Three sync trigger categories**: explicit user request / page open (`engine.init()`) / `pagehide` flush. Adding operations, queue size, visibility changes, periodic timers, network recovery, and HTTP 429 never trigger synchronization. Failed/unconfirmed operations remain in IndexedDB until the next permitted trigger. User-initiated SQL import refresh remains part of that explicit manual operation; admin mutation endpoints are independent writes, not background oplog sync.
- **`metaCache` holds the whole last `/sync` snapshot** (2026-10-11), under the reserved key `snapshot` (a 64-hex album hash can never collide with it) alongside the per-sha dedupe entries. `rebuildCache` writes it, `engine.init` reads it and hands it to the store via `onCachedSnapshot` **before** the first request, so a returning visitor renders the album instead of the empty state for one round trip; the sync then replaces it with the authoritative snapshot. Hydration deliberately reapplies no queued ops (`context.queuedOps` is empty) — the cached snapshot is the raw server state, and the sync that follows folds the queue. A corrupt/absent read is swallowed and the sync fills the store.
  - ⚠️ **Every surface that reads the store must wire `onCachedSnapshot`**, not just the gallery. The first pass wired only `App.svelte`; `Admin.svelte` stayed on `onSyncResponse` alone, so with the server unreachable the admin tabs were empty while the gallery rendered from cache. Measured with `/sync` aborted: gallery 4 cards, admin announcements/polls/feedback all blank before the fix, all three present after. The user's rule is "if the frontend shows it, it is cached locally and readable offline" — so a new consumer of the store is a new call site for this hook.
- **Photo ops always use sha256 addressing** (user mandate: id is only index for external link `/l/{id36}`, in-site requests never use id). `Op.targetSha` for all photo ops; `target` only serves announcement vote/react. Therefore **optimistic cards can enter Lightbox and multi-select**; **ops must come after upload op** (/sync replays in array order), this is the premise of the whole mechanism. A mark on a sha the snapshot does not carry is therefore **not written to the log at all** — the mark itself (`pendingMarks`, persisted) is the state, and `photoOpQueued(sha)` states it as ops: the upload store awaits it when the upload op lands, and `applySync` also calls it for a row the snapshot just delivered (that row's upload op was written in an earlier session, so nothing else would fire). ⚠️ The condition is the whole subtlety: the first version of this mechanism tested only "an upload op is queued" (`queuedUploadShas`), a flag set when one is written — so a mark on any photo loaded from a snapshot was dropped forever. That is why `eb1dd41` deleted the mechanism, not redundancy; it is back with the corrected condition (2026-10-07). Never key the ordering on the upload-op flag alone.
  - ⚠️ **That "unknown sha" drop is for MARKS only — never route a delete through it** (2026-10-07, found by driving the real UI). `deletePhotos` removes the row optimistically _first_, so by the time the op is submitted the sha is gone from `photos` and a shared guard dropped **every synced-photo deletion**: the card vanished, nothing was queued, the photo came back on the next snapshot, and no toast said so. A delete of an unknown sha is a server no-op anyway, and the pending photo's tombstone depends on it. `deletePhotos` therefore submits its op straight to `submit`; only `submitMarkOp` carries the guard.
- **A photo's `createdAt` is when its upload URL arrived** (2026-10-12). `serverTime` is read **once per /sync request** (`sync.ts`), so every photo in a batch shared one timestamp and "latest" could not order a multi-file upload. The SharedWorker now stamps `Date.now()` at `rec.url = r.url`, carries it in the job-status message, and `writeUploadOp` puts it in the `UploadPayload`; the server keeps it but **clamps to `Math.min(createdAt, serverTime)`** so a skewed client cannot pin a photo into the future. `uploader` stays server-authoritative. A payload without `createdAt` is dropped, like any other missing required field — do not add a `?? serverTime` fallback, that recreates the bug. `sortPhotos('latest')` breaks equal timestamps by id (insertion order), because same-millisecond pairs are still possible.
  - Measured before/after on the local D1: pre-fix rows 205–207 all carried `1791023636596` (one batch, one value); five new uploads landed as …363, …364, …393, …393, …413. Two of them shared a millisecond, which is exactly why the id tiebreak exists.
- **The op log supersedes last-value writes** (2026-10-07, ADR 0016). `engine.addOp` replaces a queued op on the same dimension in place (`putOp`, same key) when `coalesceKey` names one — a photo's attitude (like/unlike/dislike/undislike), its reports, a poll vote per voter, a reaction per announcement and voter. `upload` / `delete` / `fb_create` have no key and keep their place. Two rules are load-bearing: **never supersede an op an in-flight request carries** (the response clears that key on success, taking the replacement with it — a silently lost edit; append instead), and **never drop a cancelling pair** (`like`+`unlike` collapses to `unlike`, not to nothing — an op whose response was lost may have landed, and dropping both abandons the correction). Replacing in place is what keeps a mark behind the upload op that creates its row.
- **The server owns the like/dislike exclusion** (2026-10-07, ADR 0016). `setMark` clears the opposite column in the _same_ statement that adds either, so the invariant is a server guarantee rather than a client convention — and that is what lets like and dislike share one coalescing dimension, making a switch one op instead of two. `applyMarkToSet` mirrors the clear in the local fold (otherwise the optimistic row disagrees with the snapshot that follows). `reports` is its own dimension and may coexist with either attitude; the removal path is unchanged and must leave `'[]'`, never NULL (`json_group_array` over an empty set already yields `'[]'`).
- **Deleting a pending photo withdraws its ops, it does not delete after the fact** (2026-10-07). A sha with no server row routes `deletePhotos` to `withdrawPendingUpload`: cancel sink (stops the transfer before it writes an upload op) → `engine.removeOpsBySha` (withdraws the queued upload + mark ops) → a `delete` op filed **last** as the tombstone. The order is load-bearing: `removeOpsBySha` matches by sha and would take the tombstone with it, and the tombstone is what makes an upload op already claimed by an in-flight sync request harmless (lands → next sync deletes the row; fails → no-op on an unknown sha). The old order `[delete, upload]` let the "deleted" photo land for real, and the optimistic card stayed as a ghost until reload — a pending card belongs to the upload store, not the photo store, which is why the cancel goes through `setPendingUploadCancelSink` (second user of the `setMediaHostSink` bridge pattern). The other half of that race is closed in `onUploadOp`: it writes nothing when no tracked task still owns the sha, because the card's disappearance means the job was cancelled, dismissed or deleted.
- **Announcements and feedback writes go through independent admin API, not /sync oplog**. Announcements: `POST/PUT/DELETE /admin/announcements`, `POST /admin/announcements/reorder` (root-only). Feedback: create still goes through `/sync`'s `fb_create` (each visitor sends with own identity, not privileged), delete/sort go through `DELETE /admin/feedback/{id}` + `POST /admin/feedback/reorder`. Reads still go through /sync snapshot.
  - **New write endpoints must sync three places**: worker routes + `app.ts` mount + **`web/vite.config.ts` proxy whitelist** (missing it falls back to SPA returning HTML — this was the cause of "save failed" back then).
  - Shared JSON transport lives in `web/src/core/api/request.ts` (15s deadline through response-body consumption); sync and admin clients reuse it. Uploads retain their separate idle-progress watchdog.
  - **Failure feedback only goes through `toast.error` + rollback**, "saving/saving failed" badges have been completely removed.
  - **Editing a poll keeps its votes unless the question changed** (2026-10-12, ADR 0018 — reverses the clause in 0010/0013). A vote is a `(poll_id, user_id, option)` row where `option` is an **index** into the poll's `options` array, so the clearing condition is exactly two: the option **count** changed, or `allowMultiple` changed. A same-length edit (fixing wording) keeps every vote, because `PollEditorDialog` preserves option order — it appends, edits in place, and truncates, with no reorder gesture, which is the only reason a length test is sufficient. **Client and server must apply the same two conditions** (`ops.applyPollUpdate` and the `PUT /admin/polls/:id` handler); one side keeping a row the other dropped shows a count the next snapshot contradicts. ⚠️ Residual hole, accepted: an API caller sending a same-length list in a different order keeps the votes and re-points them at different labels. Closing it means storing a vote against a stable option identity rather than an index — a `votes` schema change, so not worth it while the UI cannot reorder. The old rule cleared on _any_ text difference, which made a typo fix cost every vote, and its hint copy claimed "reordering keeps them" while the code cleared on reorder — copy and code now agree.
  - Sorting never blocked by temporary id: new creation takes effect locally immediately (tempId), if still tempId during sorting, suspend and wait for real id then supplement.
  - feedback `sort INTEGER NOT NULL` (no DEFAULT), uniqueness guaranteed by construction (insert `MIN(sort)-1` to top, renumber `0…n-1` during sorting), snapshot single `ORDER BY sort ASC`.
  - **Shared drag list `lib/components/ReorderableList.svelte`**: generic `T extends {id; sort}`, owns card shell + all pointer drag + FLIP, caller only provides row content. **New sortable lists must reuse it, do not copy that 200 lines**. Sorting helpers in `ops.ts`: `applyReorder` / `beginReorder` / `moveReorderToIndex` / `finalizeReorder` / `ReorderDraft`.
  - Feedback list **can drag even in search-filtered state** (`FeedbackList.commitVisibleOrder` fills visible rows' new order back into full list slots, hidden rows not lost).
  - _*"/admin/* write path → admin API" covers announcements and feedback_*; `Admin.svelte` has removed SyncButton, admin page reads rely on `engine.init()` first-frame sync.

---

## Component Pitfalls

- Reaction menus use the native popover top layer to escape announcement-card clipping. Keep their DOM inside the sidebar for focus containment, and let native popovers consume Escape before the parent overlay.
- Tooltip placement must calculate clamped coordinates in local variables before assigning reactive coordinates; reading and rewriting the same coordinate inside its positioning effect can exceed Svelte's update depth near viewport edges.
- `muted` and `popover` have the same color. A menu on `bg-popover` needs a contrasting/tinted hover background, not `hover:bg-muted`. Verify the composited color, not merely the presence of a hover utility.
- Google Lens must receive the absolute id36 `/l/{id36}` proxy URL, not the original image URL. External Lens processing cannot be verified with local fixtures; browser tests verify the encoded target and actual new-tab activation only.

- **Sticky bottom bar + scroll container padding**: adding `padding-bottom` to `overflow-y-auto` container makes sticky stop above it, scroll content shows through gap. Fix: scroll container only `px-4 pt-4`, bottom spacing handled by panel itself.
- **Inner z-index escapes**: parent with `position: relative` and `z-index: auto` **does not create stacking context**, inner `relative z-10` can press over sticky bottom bar (really happened with vote bar covering input). Add `isolate` to parent.
- **Native image drag steals gesture**: selection interaction needs `<img>` `draggable="false"` **and** container `ondragstart={e => e.preventDefault()}`.
- **Native `input[type=range]` as slider is wrong** (already rewritten to real DOM handle + pointer events): when dual handles overlap, input must be `pointer-events: none` to let thumb be independently clickable, cost is whole track becomes dead zone; Firefox doesn't recognize `::-webkit-slider-thumb` anyway.
- **sonner**: `Toaster`'s `theme` defaults to `'light'`, dark sites must explicitly set `theme="dark"`; color overrides go through `toastOptions.style` (utility classes lose to its two-level attribute selectors).
- **ActionSheet must not do drag-to-close**: competes with panel inline buttons for pointer, and inline transform overrides `transition:fly`.
- Component layer `web/src/lib/components/` **zero shadcn / zero bits-ui** (`ui/` and `components.json` deleted, contract states no more).
- `untracked` does not exist, correct name is **`untrack`**, and can only be imported from `'svelte'` (not `'svelte/runtime'`).
- ⚠️ **Before positioning something in X's corner, ask whether X's box already exists.** Usually the parent _is_ X's shrink-wrapped box, so `relative` + `absolute` is enough. Copying a sizing formula (e.g. the skeleton's `min(--w, …)`) creates a shadow copy that drifts from its source — the drift here was a copied box that never received a height, so an absolutely-positioned child collapsed the frame to 0 and pinned itself to the viewport's vertical centre line.
- ⚠️ **When a parent and child share a CSS variable that drives different properties, their `transition` must be set explicitly and identically.** One value applying instantly while the other animates guarantees a one-frame visual mismatch (element snaps to final size, then pops).

- **指针 resize 只有一条实现**：`base/lib/pointer.ts#startPointerResize({ event, axis, sign, start, clamp, onMove, onStart/onEnd/onStop })` 返回 stop 函数；`OverlaySidebar`（水平宽度 + 方向 `sign`）与 `AnnouncementSidebar`（垂直高度，`sign: -1`）都复用它，不要在组件里再手写 `pointermove`/`up`/`cancel`。stop 由组件保存，并在 `onDestroy`（以及面板关闭）时调用。

---

## Slider Specification (finalized 2026-09-25, design draft `D:\ToDo\code.html`)

- Track 4px (`bg-border`) + solid `bg-primary` fill, hit area 32px; handle 18px primary + 3px `border-background` stroke, hover 1.1 / drag 1.22x, no transition during drag.
- Value **not always displayed**, only via bubble (`bg-surface-top`, 11px/600, `shadow-md`, 4px triangle below; shows on hover/press/drag/keyboard focus).
- **Bubble positioning = tip alignment**: triangle pinned to handle center, bubble stops at row edge when handle at ends, triangle slides along bubble bottom edge to follow handle. Position calculated in px using **real-time track width + bubble `bind:clientWidth` measured width** (using `ch` to estimate half-width will misalign at endpoints).
- Dual and single handles both use real DOM handles + pointer events, internal state [0,1] normalized, only emit on mapped business value change (prevents masonry reflow); dual handles cannot cross.

---

## Time Display

- **Single entry point** `lib/components/TimeLabel.svelte`, **default relative time**, hover **horizontally slides** to "omitted prefix absolute time", `aria-label` always absolute time. Announcements/feedback/Lightbox three places already integrated, new time displays must use it.
- Hover is **JS-driven** (`hovered` $state + `data-hovered`, not `:hover`), `::before{inset:-8px -12px}` expands determination, leave delay 160ms. Pseudo-element **cannot be added to `.time-label`** (`overflow:hidden` will clip it).
- `formatSmartAbsolute` omits prefix by **calendar boundary**: same day → `HH:MM`, same year → includes month/day, cross-year → includes year. **Chinese must use "年月日" units, slashes/hyphens forbidden** (to be consistent with "X minutes ago" Chinese units; slash form is pre-i18n legacy). Cross-day but small hour difference (yesterday 23:55) still includes date.
- Implementation: TimeLabel uses `inline-grid` + two labels same `grid-area:1/1` → width takes wider one, hover zero reflow.
- Old items deleted: `formatAbsoluteTime` / `AbsoluteTimeOptions` / `RelativeTime.svelte`.

---

## Performance Troubleshooting

- **Client requests must have timeout**: when backend is down connection is not rejected (dev proxy keeps holding), fetch without timeout never settles → `engine.syncing` always true, all writes stuck. Countermeasure `SYNC_TIMEOUT_MS = 15_000` (one AbortController per attempt, timeout throws `sync_timeout`) + `onError` dedup toast.
- **Determining "jank" must use real user machine data**: Playwright browser **has no extensions**, all 60fps probes don't mean user isn't janky (local user has 猫抓 + 篡改猴 + uBlock installed, profile shows extensions 3.4%, app JS only 0.04%). Prioritize getting Firefox profile and parse with skill `frontend-jank-triage`'s `analyze_profile.py`.
- First visit profile: `load` 348ms / first image 16665ms / 401→Turnstile→200 takes 4.3s — slow in identity chain, not resources.

---

## e2e / Screenshot Verification

- Playwright uses system Edge: `chromium.launch({ channel: 'msedge' })` (no Playwright chromium build locally), scripts run in directory with playwright dependency (`web/`) (ESM does not honor NODE_PATH). Delete after use (not in `.prettierignore`, keeping will fail lint).
- `waitUntil: 'networkidle'` will timeout, use `'load'` + fixed wait.
- `/?e2e=1` and `/harness` panel deleted. Gate copy anchor "通过验证后即可浏览" is still visible during `done` fade-out (opacity-0), hidden after idle unmount.
- **SharedWorker-issued requests (/upload etc.) cannot be intercepted by `page.route`, nor seen by `page.on('request')`** — network assertions involving upload must switch signals: pipeline console logs (like `duplicate: sha256 cache hit`), panel row appear/disappear, server snapshot (`context.request.post('/sync')`).
- **duplicate task's "duplicate" row lives less than one frame** (dedup effect immediately removes), DOM assertion inevitably flaky.
- Mock data: `page.route` intercept `/sync`, or directly POST /sync with upload ops (use fake domain for url then route returns SVG data). Local Turnstile dummy token `XXXX.DUMMY.TOKEN.XXXX` can create identity.

---

## Documentation & Module Layout

- **Sole documentation is `AGENTS.md`** (architecture layers + red lines); everything else is code/comments.
- **A comment states what the code does and the constraint it must respect — never what changed or was asked for.** Restated as a hard rule 2026-10-12. Past tense aimed at the code ("this used to…", "the old constant…", "before this was…") and requirement narration ("per the user's decision", "fixes the bug where…") both belong in this file, not in the source: a comment has to survive the next edit unchanged, and one describing a past state goes stale the moment the state changes. What earns a comment is the constraint a reader cannot infer — why the clamp must run after the write, why the value is measured rather than guessed, why two surfaces share an owner. State it in the present tense as a rule ("the ceiling is frozen for the gesture, because a live ceiling pulls the sheet down mid-drag") and it stays true after the code moves.
- **`.agents/` is the only tracked home for agent-facing knowledge.** `memory/` (daily logs + `MEMORY.md`), `adr/` (permanent decisions), `CONTRACT.md` (observable behaviour), `documents/` (design records too large or too working-state for an ADR).
- ⚠️ **`.workbuddy/` and `.trae/` are gitignored**, so anything left there is invisible to every other agent and dies with the machine. Both tools keep writing their own logs and documents there; **the content has to be merged into `.agents/` in the same session** or it is lost. This already cost one round: three WorkBuddy daily logs and one Trae transcode design record sat untracked until 2026-10-04.
  - Merging is **not** copying over — the same date can hold genuinely different content written by a different session (it did, across 10-02/10-03/10-04). Compare headings first, then append.
  - Do **not** delete the source directories: they are each tool's live state, not scratch.
- `schema.sql` / `schema-ddl.ts` must be byte-identical (enforced by `schema-alignment` test). **Now red line 3** — it was only a parenthetical in the key-files table, which is too weak for an invariant with a test behind it.
- **Module paths flattened (09-26), do not look for old paths**: `src/testing/localDb.ts` (formerly `src/d1-shim.ts`, before that `src/local/d1-shim.ts`), `web/src/core/engine.ts` (formerly `core/sync/engine.ts`), `web/src/transcode/protocol.ts` (formerly `transcode/shared/protocol.ts`). `src/shared/types.ts` **kept** (`$shared` alias, ~40 references, do not move). The `createRequire` rule lives on `src/testing/localDb.ts` + `scripts/lib/apply-local-schema.mjs` now, not on the old shim path.
- Reference: `D:\ToDo\v1` is initial version (pure static public/ + Hono Worker), production `inf.prom.cc.cd` (unreachable locally).

---

## Working Rhythm: Screenshot-Directed Iteration

- The user verifies in the real browser and reports back with screenshots. A change is **not** done when the code and the automated check pass — it is done when the screenshot matches. Expect several rounds, and treat each screenshot as the authoritative statement of what is still wrong.
- **A screenshot can be caught mid-transition.** "I can still capture the loading animation" may mean one frame, not seconds. Measure the **frame count** of the bad state, not just whether it occurs, before deciding how much work it needs.
- **A regression the user sees is a real regression, even if every automated check is green.** A negative round ("this is a complete regression, rethink the direction") means the _approach_ was wrong, not the next line of code — stop patching, re-derive the model, and revert the speculative parts rather than stacking another layer on them.
- Per-round fix histories (which intermediate bug was fixed when) belong in the day's log only, never in this file.

---

## "Looks like fallback but actually required, do not delete"

`photos.likes/dislikes/reports` `DEFAULT '[]'` (upload INSERT does not list these columns) · `CREATE TABLE IF NOT EXISTS` (deploy idempotent) · `env.assets?` (worker unit tests without assets) · `migrate.ts` `restoreOldTables` (import failure rollback) · oplog DB_VERSION+contains guard · transcode VP8/GIF media fallback · `sync.ts` `idList`/`rec()` malformed input defense · `OverlaySidebar`/`readCachedSelfId` preference first-frame defaults.

## Shared Lifecycle and Refactoring Boundaries (2026-09-27)

- ADR 0007 defines the upload-store and shared-overlay boundaries. Create `createUploadStore` within a component so teardown runs; use `SvelteMap` for asynchronously populated preview/probe data consumed by derived UI.
- Await oplog persistence before acknowledging an upload to the SharedWorker. A rejected local write leaves the artifact resumable; upload completion does not add a new automatic sync trigger.
- Sync captures and drains the queued snapshot in batches of at most `MAX_SYNC_OPS` (500), deleting only confirmed keys. Operations appended during a request stay queued for the next sync; partial failures retain the unconfirmed tail.
- Sidebar, ActionSheet, and Lightbox share `base/lib/overlay.ts`. Only the top layer handles keyboard focus/Escape; scroll unlock happens when the stack empties. Hidden mounted panels are inert. Icon buttons have explicit accessible names; tooltips only describe them.
- `src/shared/media.ts` owns base-36 media IDs and file extensions for both runtimes. `core/markdown.ts`, `base/lib/format.ts`, `base/lib/slider.ts`, and `transcode/protocol.ts` hold their respective consolidated helpers.
- Media proxy validation checks HTTPS, credentials, local hostnames/private literals, and each redirect; output MIME comes from stored media type with nosniff and sandbox CSP. This does not resolve DNS names or prevent DNS rebinding; stronger isolation requires an upstream allowlist or infrastructure enforcement.
- Vite binds all interfaces with a `.e2b.app` host suffix allowlist and a strict port. Do not disable host validation globally. UI browser regressions are in `web/tests/e2e/ui.spec.ts`; they mock sync/media and do not prove production challenge or upstream-upload behavior.

- Svelte outgoing transitions pause effects inside the leaving subtree before action destruction. ActionSheet releases its shared overlay from a component-scope effect, reading `open` before optional action access, so a closing menu cannot swallow Escape intended for the underlying Lightbox.
- Card keyboard handlers handle only events targeted at the card itself; nested buttons keep native keyboard activation. Collapsed announcement bodies are inert so clipped vote/reaction controls do not enter the focus order.
- The user requires the deterministic all-zero root UUID for local seed authentication, with no administrator/visitor selector page. Seeded browser tests establish normal server cookies through `/sync`; no development login route or production authentication change is needed.

- Identity verification belongs inside the engine-owned sync attempt. Do not run a separate bootstrap request before `engine.init()`, or start bootstrap from `onError`: both issue extra requests after failure. A Turnstile-required response permits one token handshake within the same attempt; widget/token/HTTP failure stops until another allowed trigger. Turnstile automatic retry and refresh are disabled.

## Refactor Commit Discipline (2026-10-03, ADR 0015)

A retrospective over every commit asked which were refactors and whether each was a net win. The
variable that predicted the damage was not size, it was **how many dimensions one commit carried**.

**The rules (ADR 0015).**

- **One dimension per refactor commit**: pure path move, module merge, component extraction, token
  unification, test-stack migration, or semantic change — pick one. No visual, layout, spacing, motion
  or copy change rides along.
- **The only permitted exception is value-preserving**: a literal → the token whose value equals it.
  Bypassing the token file is not an exception (`ca1b082` hardcoded `0.45s cubic-bezier(…)` into
  `.card-motion` one commit after `motion.ts` was built to prevent exactly that).
- **A new abstraction ships with its contract test, before its first use.** If the contract cannot be
  written as a test, the abstraction is not ready to extract. `66d91b7`'s `motion.test.ts` is the model:
  assert per phase, and feed `'0.5s'` / `'  '` / `'var(--nope)'` to force the fallback branch.
- **A module merge deletes the old files in the same commit.** `d915d61` left `oplog/cache.ts` and
  `oplog/store.ts` behind; `7e5a633` left `src/d1-shim.ts` and `src/testSupport.ts`. Nothing references
  them precisely because the merge already replaced them, so "grep says unused" never finds them.
- **"Eliminate a double source" changes every reader and every writer, or none.** `189b47a` converted
  only the writer, which turned an optimistic-row mismatch into rows that were written and never shown.

**Why a static green check is not evidence.** All three `189b47a` regressions shipped with lint, `tsc`
and the unit suite green: `motionMs('duration-enter')` (the parameter already carried the prefix the
function body re-added) and a closure-returned boolean are both perfectly type-legal. **Static checks
verify types and syntax, never a contract that was never written down.** A refactor that introduces new
_state_ is the dangerous kind, not one that introduces new code.

**How to judge a refactor commit after the fact** (this is the cheap check, and it needs no review):

1. Run `git log --follow --format="%h %s" -- <file>` for the files it moved. **Zero follow-up commits
   titled Fix / Revert / Restore is the signature of a good refactor.** `f4869b0`, `31ffb82`,
   `97819d8`, `c481e04` have none; `189b47a` has five.
2. Ask whether `git diff --stat` per file proves it was a _pure move_ (`transcode/protocol.ts` at +2/−4).
   Large and pure is fine — `e8c2340` (32 renames) and `31ffb82` (84 files) were both net wins.
3. Count the dimensions. If the message cannot name one, it is not a refactor commit.
4. Check whether the commit message describes something the diff does not contain. `ac96442` ("Chore")
   announced a toast close button that had not existed for a commit; `3367991` ("translate comments")
   carried a complete 313-line `ErrorPage` rewrite and a deleted `message` prop.

**A structural move and a logic change in one commit is the actual hazard**, because it makes the
revert a gamble. Named references: the `enabled` option on `base/lib/overlay.ts` (documented in
MEMORY.md §Shared Lifecycle) was added by `d54aa95` and omitted at exactly one of its three call
sites, so the Lightbox held the body scroll lock after closing; `OverlaySidebar` and `ActionSheet` both
passed it. **When you extract a shared action, audit every call site against its contract in the same
commit** — three days passed with two later commits touching that file without noticing.

**Squash merges silently delete functional comments, and a wrong comment is worse than none.** `8e4b62d`
had to restore them verbatim after `6217c37` stripped six files. The dangerous case was `schema.sql`'s
users.id note, rewritten to "SQLite's implicit integer primary-key assignment" — which contradicts
`f86a5a6`, where `createUser` computes `COALESCE(MAX(id),-1)+1` inside the INSERT precisely so the first
visitor gets id 0 and `ROOT_ID` works. **ADR and memory files are code.** Diff a squash against its
source branch before accepting it.

**Test count is not a coverage metric.** `ec40dbd` cut the suite from 208 cases to 49 to satisfy "keep it
under 100" and dropped `topbarFit.test.ts` from 20 to 2; those cases were never proven redundant.
`MEMORY.md` §Unit Suite Shape holds the shape, but the gap is real: appearance and `pillMeasure` still
have no regression net (CONTRACT.md §5).

**No temporary artifact lands in the trunk, and a diagnostic is not a change.** `ca1b082` shipped a
`tmp-crawl-l.yml` labelled "TEMPORARY — delete after reading the run"; it cost four later commits of
add/remove churn. Same class as `1a369a9` repainting three icons inside a diagnostic commit, which
CONTRACT.md §4.5 records. If state lives in a Cloudflare dashboard, CI cannot converge on it
(CONTRACT.md §4.6).

**Do not judge a refactor by its title.** Of the commits titled `refactor` / `restructure` / `normalize`
/ `chore`, only four changed structure without changing behaviour. The two worst were titled
`Normalize the codebase` (five dimensions) and `Refactor shared lifecycle and enforce explicit sync
triggers` (a structural win plus a product-level behaviour change).

**Two writers in one tree will interleave, and the failure looks like a harness bug.** A parallel
session rewrote `Lightbox.svelte` every few seconds while this one held it open; `read` results went
stale and an `edit` was refused with "file changed since it was read", which reads like a tooling
fault rather than a lost race. **When an edit is refused on a file you read seconds ago, the file is
not yours — check the mtime before re-reading and re-applying.** The cheap check is
`Get-ChildItem -Recurse -File | Where-Object LastWriteTime -gt (Get-Date).AddMinutes(-3)`. Two
untracked modules (`base/lib/lightboxEngine.ts` and its test) appeared the same way and turned out to
be good work — but "it showed up mid-session and nothing imports it" is also exactly what dead code
looks like, so ask before adopting _or_ deleting. CONTRACT.md §5 gap 4 records it too.

**A shared definition must be checked against each consumer's resources, not only for agreement.**
Extracting one glitch stylesheet for two surfaces made them identical — and exposed that neither font
query shipped the `font-weight: 800` the glyph asked for, so both rendered synthetic bold while the
now-identical surfaces looked fine side by side. **Unifying a definition answers "do they agree",
never "can each of them actually render it".**
