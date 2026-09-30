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
6. **Routine work does not touch `.ai/memory/`**: written only on a stated rule, a finalised decision, or a discovered pitfall.

---

## User Preferences

- **Visual**: v1 aesthetics only — blue-black stepped background (`#0a0e1a`/`#0f1524`/`#151c2e`/`#1a2238`/`#1e2640`). Dark theme + primary cyan `#22d3ee`. "Neutral near-black" is deprecated.
- **Lighting**: No page-wide diffuse glow; in-control dynamic effects (inset highlight, progress fill, shimmer) are acceptable.
- **Minimalism discipline**: No unnecessary backgrounds/borders/divider dots; lucide icons only, no duplicates or unreferenced icons.
- **Interaction structure** (topbar / sidebar / masonry / gestures) — do not change lightly; only move toward clean and spacious.
- **Visual reference**: `https://rayburst.pages.dev` — Inter Var negative tracking, 14px rounded cards without shadows, hairline borders, asymmetric timing (`--ease-enter cubic-bezier(0.2,0,0,1)` / `--ease-exit cubic-bezier(0.3,0,0,8,0.15)`).

---

## Local Dev Environment (Pitfalls)

- **NEVER `Stop-Process -Name node` / `taskkill /IM node`**: Kills the agent's own shell bridge, causing all subsequent Bash/PowerShell tools to fail with `command expected string / undefined`. To clear a port: `Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`.
- Start dev: `npm run dev` at repo root = Worker(8787) + Web(5173) + `db:local` (idempotent, does not clear data). **Never `nohup npm run dev:worker &`** (creates competing workerd processes fighting for :8787).
- **Never start `npm run dev` on top of a previous instance.** A stray vite still bound to 5173 makes the new one fall back to 5174, and _both_ proxy the single Worker on 8787 — the doubled cold-start traffic triggers workerd "runtime crashed unexpectedly" restarts. It self-heals, but is noisy and avoidable. Always free 8787 / 5173 / 5174 (`Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`) before starting dev.
- wrangler reports Ready but curl hangs = zombie workerd on port; kill `workerd.exe` and restart. localhost unreachable → try `127.0.0.1` (local Vite only listens on IPv6 `[::1]:5173`).
- After renaming a module export, vite may serve stale transform → `touch` the file to invalidate watcher cache.
- **Temp scripts must never live in `web/` root** (triggers full-page reload, log spam = reload storm, can crash Worker). Put them in `scripts/` or use `.tmp-*` patterns.
- **PowerShell often returns empty output for `npm run` / `npx`.** Redirect with `*> file` and read the file back; `$LASTEXITCODE` alone is the reliable signal.
- **Inline PowerShell `$` variables get stripped** by the command tool: `foreach($p in …)` becomes `foreach( in …)` → parse error. Workaround: write the script to a `.ps1` file and run `powershell -ExecutionPolicy Bypass -File script.ps1`; prefer `netstat -ano | findstr` + `taskkill /PID <pid> /F` over complex inline PowerShell when feasible.
- **IDE "cannot read file node_modules/X/tsconfig.json" is benign.** Some dependencies (e.g. `mediabunny`) ship `.ts` source without a `tsconfig.json`; the TS server expects one and reports it missing. Do **not** "fix" it by editing `node_modules` (wiped on `npm install`). It does not affect `tsc`/`svelte-check` (they use the published `.d.ts`, and `skipLibCheck` is on).
- **HMR leaves stale modules** after repeated edits to one file — symptoms are "not defined" errors for symbols that _are_ defined. `page.goto(url + '?t=' + Date.now())` forces a full reload and is the reliable fix; `touch` is not enough.
- **Browser width probes need a real settle.** The `ResizeObserver + rAF` chain needs ~200ms; sampling at 8ms reads the previous frame's value and looks exactly like a jump. I mis-diagnosed "468–482 still flapping" as a real bug because of this — it was a sampling artifact.
- After changes, run `npm run lint` (includes `prettier --check`, catches unformatted files).
- Local dev uses a simulated image host (`scripts/local-media-host.mjs`) started by `npm run dev`. It accepts multipart uploads at `POST /upload`, stores files in `.local-media/`, and serves them at `GET /{filename}`. The Worker's upload proxy points to `http://127.0.0.1:8788/upload` — no external image host is contacted. Production deploy injects the real `TC_SECRET` and the Worker uses the real image host URL.

---

## Identity & Turnstile

- Identity cookie `uuid` is set by Worker as **HttpOnly** → frontend `document.cookie` cannot read it. **Never** use "cookie exists" to determine authentication; whether authenticated can only be answered by the server → always probe `/sync` first.
- Turnstile widget must `turnstile.remove(widgetId)` before removing DOM, otherwise orphaned widget keeps polling and errors. After token returns, **do not** remove immediately (iframe handshake not complete, postMessage goes to removed window); delay ~800ms, hide overlay during this time.
- In dev, site key is injected by vite from root `.dev.vars` as `VITE_TURNSTILE_SITE_KEY` (fallback only when 401 body missing).

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

## Verification Discipline (2026-09-27, three false conclusions in one session)

- **Performance numbers must be measured cold, and the same URL at least twice.** A first `curl` hits the CDN cache: the 25MB video measured "≈10s" cold-start-correct is **0.9s** — a full order of magnitude off. A 10× discrepancy means the measurement is wrong before the code is.
- **A/B tests need a fresh browser context each run.** Reusing one session leaves files in the HTTP cache, so "first visible frame 24ms" was pure cache-hit and the change under test was never exercised.
- **Test the worst-case resource, never a small one.** A 0.3MB video validates nothing about a 25MB one; the small-file run is what hid the original bug for two rounds.
- **When the decision is wrong, suspect the input — and the harness.** Twice the Lightbox work stalled on a test that "could not open the lightbox": the waterfall positions cards absolutely and many sit at **negative x** (a column left of the viewport) with a real `boundingBox()`; `page.mouse.click` at an off-screen point **silently hits nothing**. Also, `.will-change-transform` is **not unique** to the Lightbox (masonry cards use it too) — assert on `.lb-meta`. And a per-frame `skeleton? true` count is meaningless if the sampling window spans the switch _away_; restrict to the target's contiguous run.
- **Optimisation needs a ROI check first.** A ~50-line preload for a 0.5s saving, when the preload itself costs 0.43s, is negative value. Write down the arithmetic before writing the code.

---

## Progress Display Discipline (2026-09-27)

- **No invented percentages without real granularity** → use indeterminate (shimmer). Image transcoding = decode / drawImage / convertToBlob three one-shot calls, no intermediate granularity (once added 0.4/0.6 fake milestones, caught by user and reverted).
- **Weights only appear when "combining multiple legs into one 0→1"**. Each leg is a **same-dimension single ratio** (frames/frames, seconds/seconds, bytes/bytes) — naturally objective, no need to explain weights. Whenever you want to combine two legs into one, first answer where the weights come from.
- **Hashing + disk write is one tee loop** (`opfs.ts#storeArtifact` feeds `hash.ts#teeToHash`, same `for(;;)`), advances together, inseparable. **It is also not a continuation of transcoding**: `transcodeImage` returns a complete Blob, hashing consumes the product **after** transcoding ends, during which `bytes` is always 0. **Do not report transcoding progress from this loop** — the user made this exact inference and it is wrong.
- **hashing leg reports a real fraction** (the "deliberate silent gap" design was dropped 2026-09-27): `teeToHash(source, write, onBytes?)` → `storeArtifact(…, onBytes)` → SW `notifyBytes(rec, total, written)`. Numerator and denominator are **both bytes** (`blob.size` known up front, no second measuring pass). Both `runImageJob` and `onVideoResult` wired. `App.svelte#PANEL_STAGES` gained `'hashing'`; `pendingPhotos` unchanged (card still only at `uploading`).
- Phase breakdown: `queued`/`lease-wait`/image `transcoding` → shimmer; video transcoding start also shimmer (worker startup + demux + codec detection has no reportable quantity); video/GIF transcoding → mediabunny `onProgress` / GIF `(i+1)/frameCount`; `hashing` → `written/total` bytes; `uploading` → XHR `upload.onprogress` (its leading `fraction: 0` is kept — an honest starting point, unlike the transcode leg's fake one).
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

- Persist `layout.band` as a CSS-pixel target width (default 260; slider 200–800, step 10). The existing layout engine derives the effective row/column count from the measured cross size and this target width.
- This restores the earlier direct-width control at the user's request. The column-count model had replaced it because a fixed 260px band yielded one column on a 320px phone, and the 200px slider minimum could not provide a compact multi-column view. The restored model deliberately accepts that narrow-screen consequence in exchange for directly controlling card scale.
- **Zoom is a uniform scale**: `gap * zoom` and `band * zoom` together. Scaling only the band doubles the gap's share and changes density on the way down.
- The virtualiser's `maxExtent` must be the **real maximum box length** — a tall portrait is far higher than the band and a panorama far wider than one column; under-estimating makes the binary search skip on-screen boxes.
- **Shape changes bump `SETTINGS_VERSION` and drop the blob whole**. v2 column-count settings are discarded instead of being interpreted as pixel widths; no per-field migration — project red line.

---

## Upload Pipeline & Overlay

- **Only one overlay on homepage** `UploadPanel.svelte` (props `tasks` already filtered rows / `progress` / `onRemove` / `hidden`), title built-in. **Editor no longer has overlay** (user decision) — its upload feedback is the save button. `TranscodePanel.svelte` / `UploadProgressPanel.svelte` deleted, do not create a second one.
- Header `icon + title` left, `{done}/{total}` right. Count **describes the overlay's own leg**: `total` accumulates by accepted files, `done` deduplicates +1 when phase leaves transcoding or cancel → **when list is empty, done===total**. Do not change to done/failed or active row count.
- Multi-select causes overlay to slide away (`hidden` → `translate-y-[150%]`): bottom multi-select bar is `fixed bottom-0` full-width z-40, one level higher than overlay z-30.
- **`.upload-panel::before{inset:-8px}`** (expands hover area) **eats inline button clicks**, inner card must have `relative`.
- **Cancel is full-pipeline**: panel row button + card overlay top-right remove. `cancelJob` truly cancels (`uploadAbort.abort()` interrupts in-flight /upload; sends `leaseRevoked` when there is a lease). Image transcoding is in SW thread, **super-large image decode delays UI by hundreds of ms~seconds** is architectural cost, verify with small files.
- **Editor upload does not transcode**: `purpose==='editor'` does not enter any queue, `runEditorUpload` hands source Blob directly to upload, failures always use upload leg text. `/upload` filename: album explicitly `m.webp|m.webm`, editor infers from source MIME → PNG comes back still `.png`, this is observable evidence of "no transcoding".
- Panel expands without button, relies on `matchMedia('hover: hover)')`: pointer=hover (enter instant / leave delay 160ms / hit area expanded 8px), touch=drag header 1:1 follow.
- Collapse **forbids `max-h-0`** (gives child elements zero-width content box, progress bar disappears): use `grid-rows-[1fr]↔[0fr]` or `out:collapse` (`grid-template-rows: tfr`). After last row leaves, shell stays ~280ms more before unmounting.
- **Card insertion timing**: hashing does not insert card (still uploading to insert), but hashing progress is carried by **panel row** (`PANEL_STAGES` includes `'hashing'`) — row is row, card is card, not contradictory. Duplicate only shows Toast.
- Card overlay's "actual media" relies on local object URL (`previewUrlByJob`, revoke on dropTask), `overlay.preview` lets PhotoCard degrade undecodable preview to skeleton.
- **No auto-sync after upload** (user decision): only `engine.addOp(op)`, relies on pagehide / accumulate 256 / manual sync to send. Cost is new photos stay as optimistic cards until next sync.
- **Toasts always `expand`**: sonner's hover-expand is a pitfall here (left-swipe close with pointer outside list, `interacting` mark unclear → remaining notifications never expand).
- **Toast 避让底边是实测高度，不是常量**。`UploadPanel` 通过 `onHeight?(px)` 上报内层卡片的 `ResizeObserver` 高度，`App.svelte` 的 `toastOffsetBottom` 按 `multiMode → 80px` / `窄屏 + panelRows>0 → 16px + 实测高度` / 否则 `16px` 取值。三个坑：① effect 必须依赖 `hidden`（translate 不改 `offsetHeight`，从 hidden 回来高度会卡在 0）；② App 侧回调必须是模块级 `const`（内联箭头每次渲染换新引用，会把子组件的 RO 拆了重建）；③ 单位用 px 不用 rem（实测值过根字号换算会插入误差）。桌面端浮层在右下、toast 在左下，互不冲突，所以只在窄屏避让。
- **触发 toast 的可靠零副作用路径**：`page.setInputFiles('input[type=file]', '非媒体文件')` → accept 校验拒绝并 toast，不写库。sonner 的 Toaster DOM 只在有 toast 时存在，空闲页面读不到 offset。

---

## /sync & Op Layer

- **Four trigger points**: page open (`engine.init()`) / `pagehide` dump / oplog accumulates **256** / homepage topbar manual sync. `addOp` itself does not trigger. **`visibilitychange` trigger has been deleted per user decision** (oplog is naturally persistent, late send does not lose data, any new page will supplement). `engine.install()` only registers pagehide.
- **Photo ops always use sha256 addressing** (user mandate: id is only index for external link `/l/{id36}`, in-site requests never use id). `Op.targetSha` for all photo ops; `target` only serves announcement vote/react. Therefore **optimistic cards can enter Lightbox and multi-select**; uploading write ops first go into `deferredPhotoOps`, wait for `photoOpQueued(sha)` to release — **ops must come after upload op** (/sync replays in array order), this is the premise of the whole mechanism.
- **Announcements and feedback writes go through independent admin API, not /sync oplog**. Announcements: `POST/PUT/DELETE /admin/announcements`, `POST /admin/announcements/reorder` (root-only). Feedback: create still goes through `/sync`'s `fb_create` (each visitor sends with own identity, not privileged), delete/sort go through `DELETE /admin/feedback/{id}` + `POST /admin/feedback/reorder`. Reads still go through /sync snapshot.
  - **New write endpoints must sync three places**: worker routes + `app.ts` mount + **`web/vite.config.ts` proxy whitelist** (missing it falls back to SPA returning HTML — this was the cause of "save failed" back then).
  - Unified through `web/src/core/api/adminClient.ts` (`adminWrite()` + 15s timeout), do not write timeout logic separately.
  - **Failure feedback only goes through `toast.error` + rollback**, "saving/saving failed" badges have been completely removed.
  - Sorting never blocked by temporary id: new creation takes effect locally immediately (tempId), if still tempId during sorting, suspend and wait for real id then supplement.
  - feedback `sort INTEGER NOT NULL` (no DEFAULT), uniqueness guaranteed by construction (insert `MIN(sort)-1` to top, renumber `0…n-1` during sorting), snapshot single `ORDER BY sort ASC`.
  - **Shared drag list `lib/components/ReorderableList.svelte`**: generic `T extends {id; sort}`, owns card shell + all pointer drag + FLIP, caller only provides row content. **New sortable lists must reuse it, do not copy that 200 lines**. Sorting helpers in `ops.ts`: `applyReorder` / `beginReorder` / `moveReorderToIndex` / `finalizeReorder` / `ReorderDraft`.
  - Feedback list **can drag even in search-filtered state** (`FeedbackList.commitVisibleOrder` fills visible rows' new order back into full list slots, hidden rows not lost).
  - _*"/admin/* write path → admin API" covers announcements and feedback_*; `Admin.svelte` has removed SyncButton, admin page reads rely on `engine.init()` first-frame sync.

---

## Component Pitfalls

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
- Mock data: `page.route` intercept `/api/photos`, or directly POST /sync with upload ops (use fake domain for url then route returns SVG data). Local Turnstile dummy token `XXXX.DUMMY.TOKEN.XXXX` can create identity.

---

## Documentation & Module Layout

- **Sole documentation is `AGENTS.md`** (architecture layers + red lines); everything else is code/comments.
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
