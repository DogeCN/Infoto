<div align="center">

# 📸 Infoto

**A self-hosted shared photo album. The browser does the transcoding, the server never touches a byte of media.**

[![CI](https://github.com/DogeCN/Infoto/actions/workflows/ci.yml/badge.svg)](https://github.com/DogeCN/Infoto/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522.6-brightgreen)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

[English](#english) · [简体中文](#简体中文)

</div>

---

## English

Infoto is a full-stack shared photo album: a **Cloudflare Workers** (Hono + D1) backend and
a **Svelte 5** SPA. The SPA build output in `dist/` is served by the Worker's `ASSETS`
binding — API routes take priority over static assets, so the whole album is one deploy.

Media never flows through the album server. The browser transcodes photos to WebP and
videos to WebM (WebCodecs + SharedWorker), uploads the finished artifact **directly to an
external media-host facade**, and the server stores only the URL that comes back — served
back to viewers through the SSRF-guarded read proxy `GET /l/:id36`.

### Architecture

```
src/worker/        Worker entry & API (Hono routes, D1, identity / sync / read proxy)
src/shared/        Contracts shared by both runtimes: media ids, i18n copy, JSON guards
src/testing/       Local dev & unit-test adapters (node:sqlite Db; never imported by the Worker)
schema.sql         D1 DDL — source of truth; src/worker/schema-ddl.ts is generated from it
web/src/
  base/            Common layer: lib/ (layout, media, utils) + upload/ (upload pipeline)
  core/            Business logic: sync/upload clients, oplog, identity, markdown — pure TS
  state/           Svelte reactive stores (.svelte.ts)
  lib/components/  UI component library
  routes/          Page routes
  transcode/       Browser-side transcoding (WebCodecs + SharedWorker scheduler)
dist/              Vite build output (served by wrangler [assets])
```

Dependency direction is strict: `routes → components → state/core → base`. `base/` never
imports business-layer code.

### Getting started

- **Node ≥ 22.6** (24 recommended; CI runs 22)
- One lockfile at the repo root — never generate one in `web/`

| Command              | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `npm ci`             | Install everything (worker + web, one shot)                    |
| `npm run dev`        | Local dev: D1 seed + Worker (:8787) + Vite (:5173) in parallel |
| `npm run build`      | Build the SPA → `dist/`                                        |
| `npm test`           | All unit tests (root + web)                                    |
| `npm run lint`       | ESLint + Prettier check (CI gate)                              |
| `npm run ts-check`   | Type gate: tsc × 3 + `svelte-check --fail-on-warnings`         |
| `npm run db:local`   | Seed local D1 with `schema.sql` (`--force` to reset)           |
| `npm run gen-schema` | Regenerate `src/worker/schema-ddl.ts` from `schema.sql`        |

Web-only: `npm run e2e -w infoto-web` (Playwright, local and manual).

Local development needs no media host: with `MEDIA_HOST_URL` unset, `/sync` reports
`http://127.0.0.1:8788` and `npm run dev` starts `scripts/local-media-host.mjs`, which
answers CORS exactly like a real facade. Local secrets live in the gitignored `.dev.vars`.

### Media host facade

Infoto does not talk to any image host directly. You deploy a small **facade** that signs
and forwards uploads to your storage of choice (S3, R2, a transcoding service — anything),
and the album stores the URL it returns. **Nothing in `src/` needs to change** to swap
storage. The facade is stateless: no KV, no database, no user identity. A reference
implementation existed in this repository until v0.1.1 and was removed from history in
v0.1.2; the contract below is everything an implementation needs.

**Configuration.** Set the facade's origin as the `MEDIA_HOST_URL` repository **Variable**
(Actions → Settings → Secrets and variables → Actions → _Variables_). No trailing slash,
no path. The deploy workflow fails the build if it is empty. The value is injected as a
plain-text `[vars]` entry in `wrangler.toml` — it is a public hostname, not a credential.

**Responsibilities.**

| Concern                                  | Owner                                    |
| ---------------------------------------- | ---------------------------------------- |
| Signing the request to your storage      | **You** (the facade)                     |
| Storing the file, returning a public URL | **You** (the facade)                     |
| Authenticating the visitor               | Infoto (`/sync`), not the facade         |
| Storing the URL                          | Infoto (`photos.url`)                    |
| Serving the bytes to viewers             | Infoto (`GET /l/:id36`) proxies your URL |
| Transcoding to WebP / WebM               | The browser, before upload               |

**Endpoint: `POST /upload`.** One multipart file, field name exactly `file`. No cookies,
no `Authorization` header — do not require either. Success answers `200` with
`{ "data": "<public-url>" }`; `data` is stored verbatim in `photos.url`. Any failure
answers non-2xx with JSON: `{ "error": "<machine-code>", "msg": "<detail>" }` (a non-JSON
body is surfaced as `http_<status>`). `GET /health → 200 { "ok": true }` is a convenient
probe, not part of the contract.

**The URL contract.** The returned URL is checked by `isStorableMediaUrl`
(`src/worker/routes/media.ts`); a URL that fails is **silently dropped** — the upload op is
discarded and the photo never appears. It must be:

- `https:` with no embedded credentials, and
- a public DNS name (or a global-unicast IPv6 literal), and
- **publicly fetchable by Cloudflare** — the read proxy fetches it from the edge with no
  credentials, so a pre-signed URL or an auth-walled bucket renders as a 404.

Rejected: plain `http:`, `localhost` / `*.local` / `*.internal`, private and special-use
IP ranges (RFC 1918, CGNAT, loopback, link-local, non-global-unicast IPv6). One dev-only
exception: while `MEDIA_HOST_URL` is unset or points at `http://127.0.0.1:8788`, Infoto
additionally accepts that exact origin — matched by parsed origin, never by string prefix.

**CORS.** The upload is cross-origin: answer `OPTIONS` with `204` and
`Access-Control-Allow-Origin` (echo a specific origin, or `*` — the request carries no
credentials), `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
`Access-Control-Allow-Headers: content-type` on both the preflight and the response.

**Operations.** The facade is a public endpoint by design — anyone who learns the URL can
spend your storage and egress. Rate-limit it (Cloudflare WAF / Rate Limiting rules) or
require a Turnstile token in a header before exposing it.

### Deployment

`.github/workflows/ci.yml` runs `npm ci → lint → ts-check → test` on push/PR, and is
reused by the deploy workflow (`workflow_call`).

`.github/workflows/deploy.yml` **runs the CI gate first and deploys only on pass**:

- push `main` → test deploy (`infoto-dev`)
- tag `v*` → production deploy (`infoto`, real Turnstile secret)
- `workflow_dispatch` for an explicit target

Flow: ensure the D1 database exists → patch `wrangler.toml` per target → apply the schema
idempotently → `wrangler deploy` → inject secrets. A missing `MEDIA_HOST_URL` hard-fails
the deploy rather than silently pointing production at localhost.

### License

[AGPL-3.0](LICENSE) — see [NOTICE](NOTICE).

---

## 简体中文

自托管共享相册：**Cloudflare Workers**（Hono + D1）后端 + **Svelte 5** SPA。SPA 构建产物
`dist/` 由 Worker 的 `ASSETS` 绑定直接托管，API 路由优先于静态资源，整个相册一次部署即成。

媒体文件不经过相册服务器：浏览器端转码（WebCodecs + SharedWorker，照片转 WebP、视频转
WebM）后，把成品**直传给外部图片宿主门面**，服务器只存返回的 URL，访客经 `GET /l/:id36`
读代理（带 SSRF 防护）取图。

- **架构分层与依赖方向**：`routes → components → state/core → base`，`base/` 不引用业务层。
- **环境**：Node ≥ 22.6；全仓单 lockfile（根目录），`web/` 下不生成 lockfile。
- **命令**：见上表（`npm ci / dev / build / test / lint / ts-check / db:local / gen-schema`）。
- **本地开发**：`MEDIA_HOST_URL` 未设置时回退 `127.0.0.1:8788`，`npm run dev` 自动启动
  `scripts/local-media-host.mjs`；本地密钥放 gitignore 掉的 `.dev.vars`。

**图片宿主门面**：相册不直连任何图床。自部署一个小型门面，负责签名并转发上传到你的存储
（S3、R2、转码服务均可），相册只存它返回的 URL——换存储**不需要改 `src/` 任何代码**。门面
无状态（无 KV、无数据库、无身份）。参考实现曾随本仓库发布至 v0.1.1，v0.1.2 起从历史中移除；
上方英文节是完整的实现契约（`POST /upload`、URL 规则、CORS、限流职责），以英文节为准。

**要点速记**：

| 事项             | 规则                                                             |
| ---------------- | ---------------------------------------------------------------- |
| 上传接口         | `POST /upload`，multipart 字段名必须是 `file`，成功返回 `{data}` |
| 失败返回         | 非 2xx + JSON `{error, msg}`，否则按 `http_<status>` 处理        |
| URL 要求         | HTTPS 公网可匿名抓取，私网/特殊段一律拒绝，违规**静默丢弃**      |
| CORS             | 预检 `204`，带 `Access-Control-Allow-*` 三件套                   |
| `MEDIA_HOST_URL` | 仓库 **Variable**（非 Secret），缺失时部署硬失败                 |
| 安全             | 门面是公开端点，上线前配 WAF/限流，或要求 Turnstile 请求头       |

**部署**：push `main` → `infoto-dev` 测试环境；tag `v*` → `infoto` 生产环境；工作流先跑
CI 门禁，通过才部署，流程含幂等建表。

**许可证**：[AGPL-3.0](LICENSE)，另见 [NOTICE](NOTICE)。
