<div align="center">

<img src="web/public/logo.svg" alt="Infoto" width="88" />

# Infoto

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

**Endpoint: `POST /upload`.** One multipart file, field name exactly `file`. The
`filename` carries the extension the browser chose (`m.webp`, `m.webm`, …) and is
advisory; the part's `Content-Type` carries the real media type. No cookies, no
`Authorization` header — do not require either. Success answers `200` with:

```json
{ "data": "https://cdn.example.com/objects/9f2c….webp" }
```

`data` is the only field Infoto reads and is stored verbatim in `photos.url`. Any failure
answers non-2xx with JSON: `{ "error": "<machine-code>", "msg": "<detail>" }` — a non-JSON
body is surfaced as `http_<status>`. `GET /health → 200 { "ok": true }` is a convenient
probe, not part of the contract.

**The URL contract.** The returned URL is checked by `isStorableMediaUrl`
(`src/worker/routes/media.ts`); a URL that fails is **silently dropped** — the upload op is
discarded and the photo never appears. It must be:

- `https:` with no embedded credentials, and
- a public DNS name (or a global-unicast IPv6 literal), and
- **publicly fetchable by Cloudflare** — the read proxy fetches it from the edge with no
  credentials, so a pre-signed URL or an auth-walled bucket renders as a 404.

Rejected:

| Rejected                                                             | Why                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `http://…`                                                           | Must be HTTPS. Plain HTTP is an SSRF and downgrade vector. |
| `localhost`, `*.local`, `*.internal`, trailing-dot variants          | Only resolve inside your own network.                      |
| `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`       | Private IPv4 literals.                                     |
| `0.0.0.0/8`, `100.64/10` (CGNAT), `198.18/15`, `192.0.0/24`, `224/4` | Special-use ranges.                                        |
| `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6                     | Non-global-unicast IPv6.                                   |

One dev-only exception: while `MEDIA_HOST_URL` is unset or points at
`http://127.0.0.1:8788`, Infoto additionally accepts that exact origin — matched by parsed
origin, never by string prefix. A deployed facade never gets the exception.

**CORS.** The upload is cross-origin: answer `OPTIONS` with `204` and
`Access-Control-Allow-Origin` (echo a specific origin, or `*` — the request carries no
credentials), `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
`Access-Control-Allow-Headers: content-type` on both the preflight and the response.
Cache the preflight with `Access-Control-Max-Age: 86400` so the browser does not re-send
it for every upload.

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
`dist/` 由 Worker 的 `ASSETS` 绑定直接托管——API 路由优先于静态资源，整个相册一次部署即成。

媒体文件不经过相册服务器：浏览器端转码（WebCodecs + SharedWorker，照片转 WebP、视频转
WebM），把成品**直传给外部图片宿主门面**，服务器只存返回的 URL；访客通过带 SSRF 防护的
读代理 `GET /l/:id36` 取图。

### 架构

```
src/worker/        Worker 入口与 API（Hono 路由、D1、身份/同步/读代理）
src/shared/        两侧共享契约：媒体标识、i18n 文案、JSON 形状守卫
src/testing/       本地开发与单测适配器（node:sqlite Db；Worker 绝不引用）
schema.sql         D1 建表脚本——唯一事实源；src/worker/schema-ddl.ts 由它生成
web/src/
  base/            通用层：lib/（布局、媒体、工具）+ upload/（上传管线）
  core/            业务逻辑：sync/upload client、oplog、身份、markdown——纯 TS 可测
  state/           Svelte 响应式 store（.svelte.ts）
  lib/components/  UI 组件库
  routes/          页面路由
  transcode/       浏览器端视频转码（WebCodecs + SharedWorker 调度）
dist/              Vite 构建产物（wrangler [assets] 托管）
```

依赖方向严格单向：`routes → components → state/core → base`，`base/` 不引用业务层。

### 快速开始

- **Node ≥ 22.6**（推荐 24，CI 用 22）
- 全仓单 lockfile（根目录），`web/` 下不生成 lockfile

| 命令                 | 作用                                                   |
| -------------------- | ------------------------------------------------------ |
| `npm ci`             | 安装全部依赖（worker + web，一次安装）                 |
| `npm run dev`        | 本地开发：D1 灌库 + Worker (:8787) + Vite (:5173) 并行 |
| `npm run build`      | 构建 SPA → `dist/`                                     |
| `npm test`           | 全部单测（根 + web）                                   |
| `npm run lint`       | ESLint + Prettier 检查（CI 门禁）                      |
| `npm run ts-check`   | 类型门禁：tsc × 3 + `svelte-check --fail-on-warnings`  |
| `npm run db:local`   | 向本地 D1 灌 `schema.sql`（`--force` 重置）            |
| `npm run gen-schema` | 从 `schema.sql` 重新生成 `src/worker/schema-ddl.ts`    |

web 子包专用：`npm run e2e -w infoto-web`（Playwright，本地手动）。

本地开发不需要图片宿主：`MEDIA_HOST_URL` 未设置时 `/sync` 回报 `http://127.0.0.1:8788`，
`npm run dev` 会自动启动 `scripts/local-media-host.mjs`，其 CORS 应答与真实门面完全一致
（本地失败即生产失败）。本地密钥放 gitignore 掉的 `.dev.vars`。

### 图片宿主门面

相册不直连任何图床。你自部署一个小型**门面**，负责签名并把上传转发到你的存储（S3、R2、
转码服务均可），相册只存它返回的 URL——换存储**不需要改 `src/` 任何代码**。门面无状态：
无 KV、无数据库、无用户身份。参考实现随本仓库发布至 v0.1.1，v0.1.2 起从历史中移除；下面的
契约是实现所需的全部内容。

**配置**：把门面 origin 设为仓库 **Variable** `MEDIA_HOST_URL`（Actions → Settings →
Secrets and variables → Actions → _Variables_）。不带末尾斜杠、不带路径；缺失时部署硬
失败。该值由部署工作流以明文 `[vars]` 注入 `wrangler.toml`——它是公开主机名，不是凭据。

**职责划分**：

| 事项                 | 归属                                  |
| -------------------- | ------------------------------------- |
| 对存储的请求签名     | **你**（门面）                        |
| 存文件、返回公开 URL | **你**（门面）                        |
| 访客身份验证         | Infoto（`/sync`），不是门面           |
| 存储 URL             | Infoto（`photos.url`）                |
| 向访客提供字节       | Infoto（`GET /l/:id36` 代理你的 URL） |
| 转码为 WebP / WebM   | 浏览器，上传之前                      |

**接口：`POST /upload`**。一次一个 multipart 文件，字段名必须是 `file`。`filename` 带浏览器
选的扩展名（`m.webp`、`m.webm`…），仅作参考；part 内的 `Content-Type` 才是真实媒体类型。
不带 cookie、不带 `Authorization`——也不要要求这两样。成功返回 `200`：

```json
{ "data": "https://cdn.example.com/objects/9f2c….webp" }
```

Infoto 只读 `data` 字段，原样写入 `photos.url`。任何失败返回非 2xx + JSON：
`{ "error": "<机器码>", "msg": "<可读详情>" }`——非 JSON 响应体会被当作 `http_<状态码>` 处理。
`GET /health → 200 { "ok": true }` 是探针便利接口，不属于契约。

**URL 契约**。返回的 URL 由 `isStorableMediaUrl`（`src/worker/routes/media.ts`）校验，
不合格会被**静默丢弃**——上传 op 被丢弃、照片永远不出现，访客看不到任何错误，所以这是实现
门面最重要的一条。URL 必须满足：

- `https:` 且不带内嵌凭据；
- 公网 DNS 域名（或全球单播 IPv6 字面量）；
- **Cloudflare 能匿名抓取**——读代理从边缘无凭据地抓取它，预签名 URL 或需要鉴权的桶会渲染
  成相册里的 404。

拒绝项：

| 拒绝                                                                  | 原因                                   |
| --------------------------------------------------------------------- | -------------------------------------- |
| `http://…`                                                            | 必须 HTTPS，明文 HTTP 是 SSRF/降级向量 |
| `localhost`、`*.local`、`*.internal` 及尾点变体                       | 只在你的内网解析                       |
| `127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`        | 私有 IPv4                              |
| `0.0.0.0/8`、`100.64/10`（CGNAT）、`198.18/15`、`192.0.0/24`、`224/4` | 特殊用途段                             |
| `::1`、`fc00::/7`、`fe80::/10`、IPv4 映射 IPv6                        | 非全球单播 IPv6                        |

唯一的开发期例外：`MEDIA_HOST_URL` 未设置或指向 `http://127.0.0.1:8788` 时，Infoto 额外接受
该确切 origin——按解析后的 origin 匹配，绝不按字符串前缀。已部署的门面不享受该例外。

**CORS**。上传是跨域请求：`OPTIONS` 预检答 `204`，并在预检和正式响应上都带
`Access-Control-Allow-Origin`（回显具体 origin，或 `*`——请求不带凭据）、
`Access-Control-Allow-Methods: GET, POST, OPTIONS`、`Access-Control-Allow-Headers:
content-type`。用 `Access-Control-Max-Age: 86400` 缓存预检，避免每次上传都重发。

**运维**。门面按设计就是公开端点——任何知道 URL 的人都能消耗你的存储和流量。上线前配
Cloudflare WAF / 速率限制规则，或在请求头里要求 Turnstile token。

### 部署

`.github/workflows/ci.yml` 在 push/PR 时跑 `npm ci → lint → ts-check → test`，并被部署
工作流复用（`workflow_call`）。

`.github/workflows/deploy.yml` **先跑 CI 门禁，通过才部署**：

- push `main` → 测试部署（`infoto-dev`）
- tag `v*` → 生产部署（`infoto`，注入真实 Turnstile secret）
- `workflow_dispatch` 可指定目标

流程：确保同名 D1 存在 → 按目标补丁 `wrangler.toml` → 幂等应用 schema →
`wrangler deploy` → 注入 secrets。`MEDIA_HOST_URL` 缺失会硬失败，绝不悄悄把生产指向
localhost。

### 许可证

[AGPL-3.0](LICENSE) —— 另见 [NOTICE](NOTICE)。
