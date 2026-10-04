# Infoto

全栈共享相册：Cloudflare Workers（Hono + D1）后端 + Svelte 5 SPA，SPA 构建产物 `dist/` 由 Worker 的 `ASSETS` 绑定直接托管（API 路由优先于静态资源）。图片等媒体上传走**独立部署的图片宿主门面**（`media-proxy/`，ADR 0009），本 Worker 不经手媒体文件。

## 技术栈

| 层   | 技术                                                               |
| ---- | ------------------------------------------------------------------ |
| 后端 | Cloudflare Workers, Hono, D1 (SQLite), Turnstile, Transcoding 代理 |
| 前端 | Svelte 5 (runes), Vite 6, Tailwind 4, TypeScript 5                 |
| 测试 | Vitest 2.1（单测，node 环境）, Playwright（e2e，本地手动）         |
| 工程 | ESLint 10 (flat) + Prettier 3, npm workspaces, GitHub Actions      |

## 架构分层

```
src/worker/        Worker 入口与 API（Hono 路由、D1 实现、身份/同步/媒体代理）
src/shared/        两侧共享契约：媒体标识、i18n 文案、JSON 形状守卫
src/testing/       本地开发与单测适配器（node:sqlite Db；Worker 绝不引用）
media-proxy/       独立图片宿主门面（单独部署，持有 TC_SECRET）
schema.sql         D1 建表脚本（db:local 本地灌库，部署流程幂等应用）
web/src/
  base/            通用层：lib/（布局、媒体、工具）+ upload/（上传管线）
  core/            业务逻辑：api/（sync/upload client）、oplog、身份、markdown —— 纯 TS，可测
  state/           Svelte 响应式 store（.svelte.ts）
  lib/components/  UI 组件库
  routes/          页面路由（App 级别组件）
  transcode/       浏览器端视频转码（WebCodecs + SharedWorker）
dist/              vite 构建产物（不入库，wrangler [assets] 托管）
```

依赖方向：`routes → components → state/core → base`；`base/` 不得反向引用业务层。

## 环境要求

- **Node >= 22.6**（推荐 24，与 CI/部署一致）
- npm workspaces：**全仓单 lockfile**（根 `package-lock.json`），`web/` 下不存在也不应生成 lockfile

## 命令

在仓库根目录执行：

| 命令                 | 作用                                                           |
| -------------------- | -------------------------------------------------------------- |
| `npm ci`             | 安装全部依赖（worker + web，一次安装）                         |
| `npm run dev`        | 本地开发：D1 本地灌库 + Worker (:8787) + Vite (:5173) 并行     |
| `npm run build`      | 构建 SPA → `dist/`                                             |
| `npm test`           | 全部单测（根 vitest + web vitest）                             |
| `npm run lint`       | ESLint + Prettier 检查（CI 门禁）                              |
| `npm run lint:fix`   | 自动修复并格式化                                               |
| `npm run ts-check`   | 类型门禁：tsc × 3 + `svelte-check --fail-on-warnings`          |
| `npm run db:local`   | 向本地 D1 灌 `schema.sql`（表已存在则跳过，加 `--force` 强制） |
| `npm run db:reset`   | 重置本地 D1 数据                                               |
| `npm run gen-schema` | 从 schema.sql 生成 `src/worker/schema-ddl.ts`（禁止手改）      |

web 子包专用：`npm run e2e -w infoto-web`（Playwright，本地手动；需 `msedge`/`chromium` 浏览器）、`npm run test:watch -w infoto-web`。

本地开发不需要真实图片宿主：`MEDIA_HOST_URL` 未设置时自动回退到 `http://127.0.0.1:8788`（`npm run dev` 会启动 `scripts/local-media-host.mjs`）。本地密钥放 `.dev.vars`（wrangler 自动加载）；Turnstile 可用官方测试 site key `1x00000000000000000000AA`。

## 部署与媒体宿主

- `.github/workflows/ci.yml`：push/PR 时 `npm ci → lint → ts-check → test`，也被部署流程复用（`workflow_call`）。
- `.github/workflows/deploy.yml`：**先跑 ci 门禁，通过才部署**。push `main` → `infoto-dev` 测试部署；tag `v*` → `infoto` 生产部署（注入真实 Turnstile secret）；`workflow_dispatch` 可指定目标。流程：确保同名 D1 → 补丁 wrangler.toml → 幂等应用 schema → `wrangler deploy` → 注入 secrets。
- 仓库需配置 **Variable** `MEDIA_HOST_URL`（图片宿主门面的 origin），缺失时部署硬失败。门面本身的部署与 API 契约见 `media-proxy/README.md`。

## 红线（完整版见 AGENTS.md）

1. **单 lockfile**：不要在 `web/` 下生成 `package-lock.json`；安装永远在根执行 `npm ci`。
2. **单测试栈**：测试文件用 `import { test } from 'vitest'` + `node:assert`，不用 `node:test`。
3. **vitest 锁定 2.1.x**：根与 web 统一；升级 5.x 有已知 SSR/node:sqlite 兼容问题。
4. **`node:sqlite` 必须走 `createRequire`**：vite SSR 会剥 `node:` 前缀导致静态 import 解析失败（见 `src/testing/localDb.ts`）。
5. **schema.sql 与 `src/worker/schema-ddl.ts` 必须字节一致**：只经 `npm run gen-schema` 再生成，绝不手改。
6. **e2e 不进 CI**：需要浏览器渠道与本地栈，本地手动跑；CI 只跑 lint/类型/单测。
7. **提交前 `npm run lint` + `npm run ts-check` + `npm test` 必须全绿**。
8. **分层不许倒挂**：`base/` 不 import 业务层；新组件放 `lib/components`，通用逻辑下沉 `core/`（纯 TS 可测）。
9. **图片宿主绝不编译进本 Worker**：无 `/upload` 路由、无 `TC_SECRET`、`src/` 内不得硬编码上游域名。

## Agent 协作

`AGENTS.md` 是所有 AI agent 的唯一入口（硬规则、架构、工作流）；设计契约与组件行为见 `.ai/CONTRACT.md`，长期约定见 `.ai/memory/`，架构决策见 `.ai/adr/`。
