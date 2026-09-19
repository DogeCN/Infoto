# 并行协作分工（2026-09-20）

本文件仅用于两个并行执行方之间的协调，不是契约。契约唯一真源仍是 `00-contracts.md`。
改动前先读本文件，改完把「已完成」和「认领中」更新一下，避免互相覆盖。

## 我（A 方）已完成的改动

**后端 `src/worker/`**
- `routes/admin.ts`：root 访问 `GET /admin` 改为经 ASSETS 返回 SPA 入口（`index.html`），非 root 仍为自定义 404；无 ASSETS 绑定时回落占位页。契约端点表要求「root 返回 SPA 入口」，此前返回阶段一占位 HTML，导致线上 `/admin` 前端路由永远不可达。

**前端 `web/`**
- `App.svelte`：`getEngine()` 注入 `onSyncResponse` → `store.applySync()`（此前 `lastSync` 恒为 null，瀑布流永远空）；启动时先跑 `ensureIdentity` 首次入站引导（无 Cookie 时用户此前永久卡死）；标记/删除类 op 全部接 op-log；`onUploadOp` 交给引擎入队；TopBar 随机重排；下载改走 `core/download`。
- `state/appStore.svelte.ts`：新增 `applySync` / `bindEngine` / `removePhotos`，`feedback` 入 store。
- `transcode/pipeline.ts`：`onUploadOp` 出口；`lease.install()` + 完成/失败/onerror/创建失败四处 `lease.release()`。
- `transcode/lease.ts`：`install` 只注册 pagehide（原先 visibilitychange→hidden 会误释放令牌）。
- `PhotoCard.svelte` / `Lightbox.svelte`：`type !== 0` 走 `<video>`（type=1 无音轨动图此前被当静态图）；接入 `PhotoFallback` 加载失败兜底；举报计数；Lightbox 菜单「取消标记」语义修正 + 「取消」项。
- `Lightbox.svelte`：**手势层**（左滑喜欢/右滑不喜欢/下滑下载/上滑菜单、单击左右半区翻页、双击与捏合缩放、Ctrl+滚轮缩放、方向键对应四向、PgUp/PgDn 翻页、双击 Ctrl 复原）。
- `WaterfallLayout.svelte`：缩放（Ctrl+滚轮经 passive:false action、移动端双指捏合，作用于目标带宽 50%–200%）；多选删除/下载接线；`onDownload` 单张下载。
- `Root.svelte`：`/harness` 与 `/?e2e=1` 懒加载渲染开发面板（此前 Harness 无路由，E2E 全部拿不到 identity 按钮）。
- `routes/admin/Admin.svelte`：建议页接 feedback（总数、搜索、`fb_delete`）。

## 我（A 方）认领中 / 接下来要做

- 上传期间的瀑布流呈现（信息卡片钉在最前 + 阶段二媒体条目 + 蒙版即进度条，替换现在的 `UploadProgressPanel` 浮层）。涉及 `WaterfallLayout.svelte` 的条目构造与定位渲染、`App.svelte` 传 tasks。**这一块会和瀑布流定位渲染撞车，B 方如正在改 `WaterfallLayout` 的渲染结构，请在此文件留言，我等你先落地。**
- 待办（未认领，谁先做谁留言）：默认布局随视口（移动端 Masonry↓ / 桌面 Justified↓）；筛选「范围」子组五项双柄 Slider 的 UI；Lightbox 打开过渡实际不播放（`.show` 在 `{#if}` 内挂载即带类）；管理面板公告 CRUD 与拖动排序；`MarkdownEditor.svelte`。

## B 方（另一位）已落地的内容（我核对过，不重复造）

- `web/src/core/ops.ts`（乐观更新 reducers + 临时负 id 映射）、`core/download.ts`（单张 `{id36}.{ext}` / 多张 fflate zip）、`core/reactions.ts` + `ReactionBar.svelte` / `ReactionPicker.svelte`、`SortTabs.svelte` / `SyncButton.svelte` / `PhotoFallback.svelte`、`settings.ts` 的范围筛选（`RangeKey` / `applyFilters` / `countActiveFilters`）。
- 我已复用 `core/download.ts`，不再自写下载逻辑。

### B 方第二批（2026-09-20 稍晚，已落地并自测）

- `settings.ts` 扩展：`RangeValue` / `metricOf` / `metricRange` / `isFilterable` / `applyFilters` / `countActiveFilters` / `defaultFilterSettings`（`FilterSettings` 新增 `ranges`，`types` 语义不变）。
- 新组件：`RangeSlider.svelte`（双柄，原生 range 叠加实现，未引入 shadcn Slider）、`TriStateToggle.svelte`（三态图标开关）、`MarkdownEditor.svelte`（工具栏 + 分屏预览 + `:::vote` 插入）、`MarkdownView.svelte`、`VoteBlock.svelte`。
- `SettingsPanel.svelte`：接「范围」子组五项双柄滑块（动态范围、min=max 禁用、无照片/全 min=max 显示占位文字）、归属改 `TriStateToggle`、类型改三枚按钮；`photoCount` prop 改为 `photos`（**签名变更，A 方若改此处注意**）。
- `Admin.svelte`：公告 CRUD 全屏编辑器（`MarkdownEditor` + 标题校验）、拖动排序（`ann_reorder`）、建议页展开态 Markdown 渲染 + 搜索图标。**注意：A 方此前已改过本文件的建议页部分，我在其基础上增量修改，未回退其改动。**
- `Lightbox.svelte`：**完整手势层**（四向滑动、单击左右半区翻页、双击/捏合缩放、Ctrl+滚轮、方向键、Ctrl 复原）、`shareUrl` 用 `proxyUrl(origin, id)`（站外代理地址）、菜单补齐下载项、`type !== 0` 走 video。
- `MultiSelectBar.svelte`：新增「取消标记」按钮（批量 unlike/undislike/unreport）。
- `WaterfallLayout.svelte`：仅**增量**加了 `onUnmarkSelected` prop 转发，**未动渲染结构与条目构造**（A 方认领中，我让位）。
- `tests/unit/frontend.test.ts`：26 项纯函数单测（ops / 筛选 / vote 解析 / 反应聚合）。
- 验证：web `svelte-check` 0 错 0 警、web vitest 55 pass、根 `npm test` 61 pass、根 tsc 三 project 0 错、`vite build` 成功。本地 `wrangler dev` 实测 `ann_create` / `react` / `vote` / `ann_reorder` 全通（selfId=0）。

## B 方认领中

- **无**（本轮改动已全部落地）。下一步只做「全链路联调 + 提交部署 + 线上验证」，不再新增大改。若 A 方还要改 `WaterfallLayout` 渲染结构，我这边不再动它。

## 冲突规避约定

- 动 `App.svelte` / `WaterfallLayout.svelte` / `SettingsPanel.svelte` / `Admin.svelte` 前先在本文件登记；改动保持小步、可合并（增量 props 优先，不整体重写）。
- 共享基底 `src/shared`、`src/ui`、`settings.ts` 的类型只增不删。
- 每次改动后必须跑：`web/` 内 `npx svelte-check --fail-on-warnings`（0 错 0 警）与仓库根 `npm test`；契约红线要求零错误才能提交。

## 本地栈现状（A 方常驻，勿重复占用端口）

- `wrangler dev` 8787（后台常驻，D1 本地库已 `db:local` 初始化）；`vite` 5173（后台常驻）。
- 本机没有 Playwright 自带 chromium 构建，E2E 需用系统 Edge：`npx playwright test --config=playwright.edge.config.ts`（该配置是临时的，用完删，不进仓库）。
- 图床两个接入点均可达（直连 200 / 未签名 401），本地 `/upload` 代理实测可返回 `data` URL。
- E2E 现状：`identity.spec.ts` 3/3 通过；`pipeline.spec.ts` 6 通过 1 跳过，唯一失败项（图片 E2E 到 done）经手工探针复现为**通过**，之前失败是本地 Worker 进程中途退出所致，非代码缺陷。
