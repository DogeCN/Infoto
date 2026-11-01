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

### What it is

A photo album you host for a group: one shared waterfall of photos and videos, bilingual
(English / 简体中文), with announcements, polls, suggestions, likes and reactions. Anyone can
browse and upload; one account holds the admin rights.

- **Photos and videos** land in one infinite waterfall, sorted by latest / hottest / random,
  with filters and multi-select.
- **Uploads are transcoded in your browser** — photos to WebP, videos to WebM — so what
  reaches storage is already the final artifact. Uploads resume, deduplicate by content, and
  queue while offline.
- **Announcements** can embed photos, polls and Markdown; **polls** support multiple choice;
  **suggestions** are readable by everyone and readable by the admin only when signed in as it.
- **Admin** manages content from `/admin`, and can export or import the whole album as SQL.
- **Partly works offline**: after the first online visit, the app shell and last album snapshot
  can open without a network. Cross-origin images and videos are cached by the service worker as
  they load, including hosts that do not enable CORS. Offline media is limited to files the
  browser retained; storage quotas, eviction, and user-cleared site data prevent a permanence
  guarantee. Videos are fetched as complete files for offline playback. Changes stay queued
  locally and sync when connected; after a dropped connection, click **Sync** to reconnect.

Media never passes through the album server. The browser uploads the finished file directly
to a media host you control, and the album stores only the URL.

### Requirements

- Node **≥ 22.6** (24 recommended)
- A Cloudflare account with **Workers**, **D1**, **Durable Objects** and **Turnstile**
- A **media host facade** — see [Media host facade](#media-host-facade). The album cannot
  store a photo without one.

### Run locally

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Open <http://localhost:5173>. The first run seeds the local database; `npm run dev` starts the
Worker, the SPA and a local stand-in for the media host together.

`.dev.vars` ships with Cloudflare's published Turnstile **test** keys and a local media host.
It is gitignored — commit `.dev.vars.example`, never your real secrets.

| Command            | Purpose                                     |
| ------------------ | ------------------------------------------- |
| `npm run dev`      | Local development, everything together      |
| `npm run build`    | Build the SPA that the Worker serves        |
| `npm test`         | Unit tests                                  |
| `npm run lint`     | Lint and format check (CI gate)             |
| `npm run ts-check` | Type check (CI gate)                        |
| `npm run db:seed`  | Fill the local database with demo content   |
| `npm run db:reset` | Rebuild the local database from scratch     |
| `npm run release`  | Cut a release (see [Releasing](#releasing)) |

`npm run e2e -w infoto-web` runs the browser suite. It needs a browser and the local stack,
so it is run manually rather than in CI.

### Deploy

Deployment is automated by GitHub Actions; you configure it once and then push.

1. **Create the D1 database** (or let the workflow create it): `npx wrangler d1 create <name>`.
2. **Deploy your media host facade** and note its origin. It must be reachable over HTTPS by
   Cloudflare's edge — see [Media host facade](#media-host-facade).
3. **Set repository variables** under _Settings → Secrets and variables → Actions →
   Variables_:

   | Variable             | Required | Value                                            |
   | -------------------- | -------- | ------------------------------------------------ |
   | `MEDIA_HOST_URL`     | yes      | Your facade's origin, no trailing slash, no path |
   | `TURNSTILE_SITE_KEY` | yes      | Public Turnstile site key                        |

   And **secrets**:

   | Secret                  | Required | Value                               |
   | ----------------------- | -------- | ----------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | yes      | Token with Workers + D1 + DO rights |
   | `CLOUDFLARE_ACCOUNT_ID` | yes      | Your Cloudflare account id          |
   | `TURNSTILE_SECRET_KEY`  | yes      | Turnstile secret key                |

4. **Push.** `.github/workflows/deploy.yml` runs the CI gate first and deploys only if it
   passes:
   - push **`main`** → test deployment, Worker name `infoto-dev`
   - push a **`v*` tag** → production deployment, Worker name `infoto`
   - **Actions → Deploy → Run workflow** for an explicit target

   The workflow resolves the D1 database, applies the schema (idempotent), deploys, and
   injects secrets. **A missing `MEDIA_HOST_URL` fails the deploy** rather than pointing
   production somewhere unintended.

**The first deploy creates the Durable Object.** Its storage backend cannot be changed
afterwards, so deploy once with the checked-in configuration and do not edit the
`[[migrations]]` block.

**Upgrading from v0.4.0 to v0.5.0.** No manual D1 schema migration or export/import is
required; the new Durable Object hydrates from the existing D1 snapshot. Before deploying,
open v0.4.0 online on every device that may have queued changes and use **Sync** until those
changes are confirmed. On first connection, v0.5.0 removes legacy queued operations without
client IDs; any operation still pending on a device at that point can be lost.

**Releasing.** The version on the site is the latest git tag, read at build time — nothing
in the repo is edited to cut a version:

```sh
npm run release -- minor "what changed in this one"
```

It bumps both manifests and the lockfile together, commits, tags `v<x.y.z>` and pushes. It
refuses a dirty tree, a branch other than `main`, or a tag that already exists; `--dry-run`
prints the plan without writing.

### Media host facade

Infoto never talks to an image host directly. You deploy a small **facade** that accepts an
upload, puts the file wherever you like (S3, R2, a transcoding service), and returns its
public URL. The album stores that URL and proxies it to viewers. Swapping storage means
replacing the facade — the album does not change.

The facade is stateless: no KV, no database, no user identity.

**Endpoint: `POST /upload`.** One multipart file, field name exactly `file`. The `filename`
is advisory; the part's `Content-Type` carries the real media type. Requests carry **no
cookies and no `Authorization` header** — do not require either. Success answers `200` with:

```json
{ "data": "https://cdn.example.com/objects/9f2c….webp" }
```

`data` is the only field read, and it is stored verbatim. Any failure should answer non-2xx
with `{ "error": "<machine-code>", "msg": "<detail>" }`. `GET /health → 200 { "ok": true }` is
a convenient probe.

**The URL must be** `https:`, with no embedded credentials, on a public DNS name (or a global
unicast IPv6 literal), and **publicly fetchable by Cloudflare** — the album fetches it from
the edge without credentials, so a pre-signed or auth-walled URL renders as a 404. Plain
`http:` URLs, private addresses, loopback names, and special-use ranges are rejected and the
upload is discarded.

**CORS.** The upload is cross-origin: answer `OPTIONS` with `204` and
`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
`Access-Control-Allow-Headers: content-type` on both the preflight and the response. Send
`Access-Control-Max-Age: 86400` so the browser caches the preflight.

**Secure it.** The facade is a public endpoint by design — anyone who learns the URL can
spend your storage. Rate-limit it (Cloudflare WAF or Rate Limiting rules), or require a
Turnstile token in a header.

For local development, `.dev.vars` points `MEDIA_HOST_URL` at a local stand-in that answers
exactly like a real facade, so local failures are real failures. **The port lives in
`MEDIA_HOST_URL` only** — every dev script reads it from there.

### License

[AGPL-3.0](LICENSE) — see [NOTICE](NOTICE).

---

## 简体中文

### 这是什么

一个给一群人自托管共享相册：照片和视频汇成一条瀑布流，支持中英双语，带公告、投票、
留言建议、点赞和表情回应。任何人可以浏览和上传；只有一个账号拥有管理员权限。

- **照片与视频**进入同一条无限瀑布流，可按 最新 / 最热 / 随机 排序，支持筛选和框选。
- **上传在你的浏览器里完成转码**：照片转 WebP、视频转 WebM，进入存储的就已经是最终产物。
  上传可断点续传、按内容去重，离线时排队等待。
- **公告**可内嵌图片、投票和 Markdown；**投票**支持多选；**留言建议**对所有人可读，
  仅在以管理员身份登录后可读。
- **管理后台**在 `/admin`，可导出或导入整站数据（SQL）。
- **部分支持离线**：首次联网后，应用页面和最近的相册快照可在断网时打开。服务工作线程会在跨域图片、
  视频加载时缓存文件，也支持未开放 CORS 的媒体宿主。离线可用范围取决于浏览器保留的文件；存储配额、
  浏览器淘汰和用户清理站点数据意味着无法保证永久保存。视频会按完整文件获取，以便离线播放。更改会保存在本地并在连接后同步；连接断开后，点击“同步”重试连接。

媒体文件从不经过相册服务器：浏览器把成品直传到你自己控制的图床，相册只保存返回的 URL。

### 环境要求

- Node **≥ 22.6**（推荐 24）
- 一个 Cloudflare 账号，需开通 **Workers**、**D1**、**Durable Objects**、**Turnstile**
- 一个 **图片宿主门面** —— 见 [图片宿主门面](#图片宿主门面)。没有它相册无法保存照片。

### 本地运行

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

打开 <http://localhost:5173>。首次运行会初始化本地数据库；`npm run dev` 会同时启动
Worker、前端和本地图床替身。

`.dev.vars` 里是 Cloudflare 公开的 Turnstile **测试**密钥和本地图床地址。它被 gitignore
——只提交 `.dev.vars.example`，永远不要提交真实密钥。

| 命令               | 作用                           |
| ------------------ | ------------------------------ |
| `npm run dev`      | 本地开发，一次启动全部         |
| `npm run build`    | 构建 Worker 托管的 SPA         |
| `npm test`         | 单元测试                       |
| `npm run lint`     | 代码与格式检查（CI 门禁）      |
| `npm run ts-check` | 类型检查（CI 门禁）            |
| `npm run db:seed`  | 往本地数据库灌入演示内容       |
| `npm run db:reset` | 从零重建本地数据库             |
| `npm run release`  | 发布新版本（见 [发布](#发布)） |

`npm run e2e -w infoto-web` 运行浏览器测试套件。它需要浏览器和本地环境，因此手动运行，
不在 CI 里跑。

### 部署

部署由 GitHub Actions 自动完成：配置一次，之后推送即可。

1. **创建 D1 数据库**（也可以让工作流自动创建）：`npx wrangler d1 create <名称>`。
2. **部署你的图片宿主门面**，记下它的域名。它必须能通过 HTTPS 被 Cloudflare 边缘访问
   —— 见 [图片宿主门面](#图片宿主门面)。
3. **配置仓库变量**（_Settings → Secrets and variables → Actions → Variables_）：

   | 变量                 | 必需 | 值                             |
   | -------------------- | ---- | ------------------------------ |
   | `MEDIA_HOST_URL`     | 是   | 门面域名，结尾无斜杠、不带路径 |
   | `TURNSTILE_SITE_KEY` | 是   | Turnstile 公开站点密钥         |

   以及**仓库密钥**：

   | 密钥                    | 必需 | 值                          |
   | ----------------------- | ---- | --------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | 是   | 具备 Workers + D1 + DO 权限 |
   | `CLOUDFLARE_ACCOUNT_ID` | 是   | 你的 Cloudflare 账号 ID     |
   | `TURNSTILE_SECRET_KEY`  | 是   | Turnstile 私密密钥          |

4. **推送**。`.github/workflows/deploy.yml` 先跑 CI 门禁，通过后才部署：
   - 推送 **`main`** → 测试环境，Worker 名为 `infoto-dev`
   - 推送 **`v*` 标签** → 生产环境，Worker 名为 `infoto`
   - **Actions → Deploy → Run workflow** 可显式指定目标

   工作流会解析 D1 数据库、幂等地应用表结构、部署、注入密钥。
   **`MEDIA_HOST_URL` 缺失会直接让部署失败**，而不是把生产指向错误的地方。

**首次部署会创建 Durable Object。** 它的存储后端一旦创建就无法更改，因此请用仓库里的
配置部署一次，之后不要改 `[[migrations]]` 段。

**从 v0.4.0 升级到 v0.5.0。** 无需手动迁移 D1 表结构，也无需导出或导入数据；新的
Durable Object 会从现有 D1 快照初始化。部署前，请在可能存在待同步更改的每台设备上联网
打开 v0.4.0，并点击“同步”，直到确认更改已同步。v0.5.0 首次连接时会清除缺少客户端 ID
的旧格式排队操作；届时设备上仍未同步的操作可能丢失。

**发布版本。** 站点上显示的版本号来自构建时的最新 git tag——仓库里没有任何文件需要手改：

```sh
npm run release -- minor "本次改了什么"
```

它会同时升级两个 manifest 和 lockfile、提交、打 `v<x.y.z>` 标签并推送。工作区不干净、
当前分支不是 `main`、或标签已存在时都会拒绝；`--dry-run` 只打印计划不写入。

### 图片宿主门面

Infoto 不直接对接任何图床。你需要部署一个小的**门面**：接收上传，把文件放到你喜欢的地方
（S3、R2、转码服务……），返回它的公开 URL。相册保存这个 URL 并转发给访客。
更换存储只需替换门面——相册本身不用改。

门面是无状态的：不存 KV、不用数据库、不持有用户身份。

**接口：`POST /upload`。** 一个 multipart 文件，字段名必须正好是 `file`。`filename` 仅供参考，
真实媒体类型由该 part 的 `Content-Type` 决定。请求**不带 cookie、不带 `Authorization` 头**
——不要要求这两者。成功返回 `200`：

```json
{ "data": "https://cdn.example.com/objects/9f2c….webp" }
```

只读取 `data` 一个字段，并原样保存。失败应返回非 2xx 和
`{ "error": "<机器码>", "msg": "<详情>" }`。`GET /health → 200 { "ok": true }` 可作为探活。

**URL 必须是** `https:`、不含内嵌凭据、位于公开 DNS 域名（或全局单播 IPv6 字面量）上，
且**能被 Cloudflare 公开抓取**——相册在边缘不带凭据地抓取它，因此预签名或需要鉴权的
链接会呈现为 404。纯 `http:`、私有地址、回环名称、特殊用途网段一律拒绝，并丢弃这次上传。

**CORS。** 上传是跨域的：`OPTIONS` 需返回 `204` 并带 `Access-Control-Allow-Origin`、
`Access-Control-Allow-Methods: GET, POST, OPTIONS`、
`Access-Control-Allow-Headers: content-type`（预检和正式响应都要带）。返回
`Access-Control-Max-Age: 86400` 让浏览器缓存预检。

**务必加防护。** 门面本质上是公开端点——任何人知道这个 URL 就能消耗你的存储和流量。
请限流（Cloudflare WAF 或 Rate Limiting 规则），或在请求头里校验 Turnstile token。

本地开发时，`.dev.vars` 把 `MEDIA_HOST_URL` 指向本地替身，它的应答与真实门面完全一致，
所以本地失败就是真实失败。**端口只写在 `MEDIA_HOST_URL` 一处**——所有开发脚本都从那里读。

### 许可证

[AGPL-3.0](LICENSE) — 见 [NOTICE](NOTICE)。
