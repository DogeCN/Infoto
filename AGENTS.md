# AGENTS.md — Infoto Project Conventions

> This file is the **single entry point** for all AI agents (Claude Code, Cursor, Copilot, Trae, CodeBuddy, OpenCode, etc.). It defines the project's hard rules, architecture, and agent workflow. Memory/knowledge lives in `.ai/` (`memory/` + `adr/`).

---

## 1. Project Overview

Full-stack shared photo album: **Cloudflare Workers** (Hono + D1) backend + **Svelte 5** SPA. The SPA build output in `dist/` is served directly by the Worker's `ASSETS` binding (API routes take priority over static assets).

---

## 2. Hard Red Lines (violating these = rework)

> Full details in `.ai/memory/MEMORY.md` — this section is the quick-reference summary.

1. **No compatibility fallbacks** — reset the table, never add `DEFAULT`/legacy tiebreaks.
2. **No invented percentages** — indeterminate (shimmer) when no real measurement exists.
3. **`schema.sql` / `schema-ddl.ts` byte-identical** — regenerate via `npm run gen-schema`, never hand-edit.
4. **Run `npm run lint` + `npm run ts-check` + `npm test` before finishing every task** (full green required).
5. **Layer dependency direction is strict** — `routes → components → state/core → base`; `base/` never imports business-layer code.
6. **Routine work does not touch `.ai/`** — memory is written only per §10 conditions.

---

## 3. Architecture Layers

```
src/worker/        Worker entry & API (Hono routes, D1 implementation, identity/sync/upload)
src/shared/        Shared types + copy/i18n
src/testing/       Local dev + test adapters (node:sqlite Db; NEVER import in Worker)
schema.sql         D1 DDL script (idempotent on deploy)
web/src/
  base/            Common layer: lib/ (layout, media, utils) + upload/ (upload pipeline)
  core/            Business logic: api/ (sync/upload client), oplog, identity, markdown — pure TS, testable
  state/           Svelte reactive stores (.svelte.ts)
  lib/components/   UI component library
  routes/          Page routes (App-level components)
  transcode/       Browser-side video transcoding (WebCodecs + SharedWorker)
dist/              Vite build output (not in git, served by wrangler [assets])
```

---

## 4. Tech Stack

| Layer    | Technology                                                          |
| -------- | ------------------------------------------------------------------- |
| Backend  | Cloudflare Workers, Hono, D1 (SQLite), Turnstile, Transcoding proxy |
| Frontend | Svelte 5 (runes), Vite 6, Tailwind 4, TypeScript 5                  |
| Testing  | Vitest 2.1 (unit, node env), Playwright (e2e, local manual only)    |
| Tooling  | ESLint 10 (flat) + Prettier 3, npm workspaces, GitHub Actions       |

---

## 5. Environment Requirements

- **Node >= 22.6** (24 recommended, matches CI/deploy)
- npm workspaces: **single lockfile** (root `package-lock.json`); never generate one in `web/`

---

## 6. Commands

Run from the repo root:

| Command              | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `npm ci`             | Install all deps (worker + web, one-shot)                            |
| `npm run dev`        | Local dev: D1 local seed + Worker (:8787) + Vite (:5173) in parallel |
| `npm run build`      | Build SPA → `dist/`                                                  |
| `npm test`           | All unit tests (root vitest + web vitest)                            |
| `npm run lint`       | ESLint + Prettier check (CI gate)                                    |
| `npm run lint:fix`   | Auto-fix + format                                                    |
| `npm run ts-check`   | Type gate: tsc × 3 + `svelte-check --fail-on-warnings`               |
| `npm run db:local`   | Seed local D1 with `schema.sql` (idempotent; `--force` to reset)     |
| `npm run db:reset`   | Reset local D1 data                                                  |
| `npm run gen-schema` | Generate `src/worker/schema-ddl.ts` from `schema.sql`                |

Web-only: `npm run e2e -w infoto-web` (Playwright, local manual; requires `msedge`/`chromium`), `npm run test:watch -w infoto-web`. Run `npm run e2e -w infoto-web -- ui.spec.ts` for mocked gallery, keyboard, overlay, locale, narrow-screen, and failed-upload regressions. Full pipeline specs require the real upload service configuration.

Local dev uses a simulated image host (`scripts/local-media-host.mjs`) started by `npm run dev`. It accepts multipart uploads at `POST /upload`, stores files in `.local-media/`, and serves them at `GET /{filename}`. The Worker's upload proxy points to `http://127.0.0.1:8788/upload` — no external image host is contacted. Production deploy injects the real `TC_SECRET` and the Worker uses the real image host URL.

---

## 7. CI / Deploy

- `.github/workflows/ci.yml`: On push/PR runs `npm ci → lint → ts-check → test`, also reused by deploy (`workflow_call`).
- `.github/workflows/deploy.yml`: **Runs ci gate first; deploys only on pass**. Push `main` → `infoto-dev` test deploy; tag `v*` → `infoto` prod deploy (injects real Turnstile secret); `workflow_dispatch` can specify target. Flow: ensure D1 exists → patch wrangler.toml → idempotent schema apply → `wrangler deploy` → inject secrets.

---

## 8. Coding Conventions

1. **Single lockfile**: Never create `package-lock.json` in `web/`; always install at root with `npm ci`.
2. **Single test stack**: Test files use `import { test } from 'vitest'` + `node:assert`, never `node:test`.
3. **Vitest pinned to 2.1.x**: Root and web unified; 5.x has known SSR/node:sqlite compatibility issues.
4. **`node:sqlite` must be loaded through `createRequire`**: Vite's SSR transform strips the `node:` prefix from a static import, breaking the module under vitest. See `src/testing/localDb.ts` and `scripts/lib/apply-local-schema.mjs` — never `import { DatabaseSync } from 'node:sqlite'` directly.
5. **e2e not in CI**: Needs browser + local stack; run locally and manually. CI only runs lint/type/unit tests.
6. **All comments in English**: Describe functionality only; no historical/narrative comments. (Memory files under `.ai/memory/` are exempt — they are agent-facing knowledge, not code comments.)
7. **No shadcn / bits-ui**: Component layer (`web/src/lib/components/`) is zero-shadcn / zero-bits-ui by design.
8. **No second upload overlay**: The only overlay is `UploadPanel.svelte`; do not create additional ones.
9. **Time display**: Always use `lib/components/TimeLabel.svelte` as the single entry point.
10. **Reusable drag-sort list**: Always use `lib/components/ReorderableList.svelte` for new sortable lists.
11. **Measure, never guess, in responsive layout**: Derive a control's state from a measured value, not a viewport breakpoint — `web/src/lib/components/topbarFit.ts` is the worked example, including the three ways measuring goes wrong (hidden-copy widths, probe placement, and a zero-slack fit).

---

## 9. Local Dev Environment (Pitfalls)

- **NEVER `Stop-Process -Name node` / `taskkill /IM node`**: Kills the agent's own shell bridge, causing all subsequent Bash/PowerShell tools to fail with `command expected string / undefined`. To clear a port: `Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`.
- Start dev: `npm run dev` at repo root (Worker + Vite + `db:local`). **Never `nohup npm run dev:worker &`** (creates competing workerd processes fighting for :8787).
- **Never start `npm run dev` on top of a previous instance**: a stray vite still bound to 5173 makes the new one fall back to 5174, and _both_ proxy the single Worker on 8787 — the doubled cold-start traffic triggers workerd "runtime crashed unexpectedly" restarts (it self-heals, but is noisy and avoidable). Always free 8787 / 5173 / 5174 (`Get-NetTCPConnection -LocalPort <p>` → `Stop-Process -Id <pid>`) before starting dev.
- wrangler reports Ready but curl hangs = zombie workerd on port; kill `workerd.exe` and restart.
- If localhost unreachable, try `127.0.0.1` (local Vite only listens on IPv6 `[::1]:5173`).
- After renaming a module export, vite may serve stale transform → `touch` the file to invalidate watcher cache.
- **Temp scripts must never live in `web/` root** (triggers full-page reload, log spam = reload storm, can crash Worker). Put them in `scripts/` or use `.tmp-*` patterns (already in `.gitignore` / `.prettierignore`).

---

## 10. Memory & Knowledge

### Knowledge Directory

All agent knowledge lives under `.ai/` and is **tracked in git** — it is project knowledge, not scratch. `memory/` and `adr/` are **siblings**: the split is by mutability, not by hierarchy, and neither contains the other.

```
.ai/
  memory/            ← Evolving knowledge (overwritten as conventions change)
    MEMORY.md          Long-term: still-active conventions, pitfalls, decisions
    YYYY-MM-DD.md      Daily logs: decision rationale, verification records
  adr/               ← Architecture Decision Records (permanent; see format below)
    NNNN-title.md
```

Tool-private directories (`.codebuddy/`, `.trae/`) are **not** knowledge and are gitignored; never read or write memory there.

### Memory Update Rules

Applies to `.ai/memory/`; the ADR format below is covered by its own section.

- **Record only what is still effective** (conventions, pitfalls, decisions with lasting impact).
- **Do not record**: transient task progress, debugging steps, anything already in code/comments.
- **Update trigger**: User states a new rule, a design decision is finalized, or a pitfall is discovered.
- **Format**: Append to `MEMORY.md` under the relevant section; create/update daily log for process details.

### ADR (Architecture Decision Record) Format

When a significant architectural decision is made, create `.ai/adr/NNNN-title.md`:

```markdown
# NNNN: [Decision Title]

- **Date**: YYYY-MM-DD
- **Status**: Accepted / Superseded by NNNN / Deprecated
- **Context**: What is the problem? What constraints exist?
- **Decision**: What was decided? Be specific.
- **Consequences**: What are the positive/negative outcomes? What becomes harder/easier?
- **Alternatives considered**: What else was evaluated and why rejected?
```

### Memory vs ADR

`MEMORY.md` is **overwritten** as conventions change; an ADR is **permanent**. Anything that answers "why did we do it this way" belongs in an ADR, not only in memory.

---

## 11. Agent Workflow

1. **Read this file first** — it is the project's constitution.
2. **Check `.ai/memory/MEMORY.md`** for active conventions and pitfalls before starting work.
3. **Follow the layer dependency direction** strictly; never invert it.
4. **Run lint + ts-check + test** before declaring any task complete.
5. **Update memory** when: user states a new rule, a design decision is finalized, or a pitfall is discovered.
6. **Create an ADR** when: choosing between architectural approaches, changing data model semantics, or establishing a new project-wide pattern.
7. **No hooks enforcement** — this project relies on §2 red lines for self-discipline; no pre-commit or lifecycle hooks are configured.

---

## 12. Key Files Reference

| File                                            | Purpose                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `schema.sql`                                    | D1 DDL — source of truth; regenerate `schema-ddl.ts` from it (red line 3)                 |
| `src/shared/copy.ts`                            | i18n copy tables (en-US / zh-CN), BCP-47 exact-match keys                                 |
| `src/testing/localDb.ts`                        | Local/unit-test Db over `node:sqlite` (via `createRequire`); never imported by the Worker |
| `src/worker/schema-ddl.ts`                      | Generated DDL string for the Worker — never hand-edit                                     |
| `web/src/core/engine.ts`                        | Sync engine (oplog, sync trigger points)                                                  |
| `web/src/base/upload/pipeline.ts`               | Upload pipeline (pure logic, testable)                                                    |
| `web/src/transcode/pipeline.ts`                 | Transcode pipeline orchestrator                                                           |
| `web/src/transcode/sw.ts`                       | SharedWorker scheduler (image/video pools, lease heartbeats)                              |
| `web/src/base/lib/band.ts`                      | Target pixel-band defaults and slider bounds for the waterfall                            |
| `web/src/lib/components/topbarFit.ts`           | Top-bar density resolution (measured widths, hysteresis)                                  |
| `web/src/lib/components/UploadPanel.svelte`     | Sole upload overlay                                                                       |
| `web/src/lib/components/TimeLabel.svelte`       | Sole time display component                                                               |
| `web/src/lib/components/ReorderableList.svelte` | Reusable drag-sort list                                                                   |
