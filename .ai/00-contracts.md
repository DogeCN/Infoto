# Infoto
部署于 Cloudflare Workers 的全栈共享相册网站。测试部署域名 `dev.infoto.cc.cd`（域名可能变更，前端一律从 `window.location.origin` 取当前域名构建链接，不写死任何域名）。
## 开发提示
- 代码提交用 `git`，推送触发 GitHub Actions 自动部署；部署所需 Secrets 与 Variables 见「构建与部署」
- 技术不确定时优先联网求证（官方文档与实测为准），不过度设计
- 完成一个可验证的改动即提交推送；每阶段提交信息注明已验证路径
### 验证要求
**完成**的定义是：改动在测试部署 `dev.infoto.cc.cd` 的线上环境走通。流程：改动完成 → `npm run ts-check` 零错误（后端包（仓库根目录）与前端包 `web/` 各跑一次）→ 在 `web/` 执行 `npm run build` 并确认 `dist/` 产物完整 → 提交推送 → 等待 GitHub Actions 部署 → 线上验证该阶段 happy path。静态类型检查是提交前置条件，**最终判定一律以线上为准**。

**本地验证只运行前端**（必做）：
- 本地只启动 Vite 开发服务器（`web/`）；`/sync`、`/upload`、`/l/*`、`/admin/migrate` 等所有 API 请求经 Vite dev proxy 转发到测试部署 `dev.infoto.cc.cd`，数据面与鉴权均为线上真实行为
- 本地不运行 Worker、不使用本地数据库实现（wrangler dev、node:sqlite shim 均禁止）
- 代理目标读环境变量 `INFOTO_API_ORIGIN`（默认 `https://dev.infoto.cc.cd`），配置在 `web/vite.config.ts` 的 `server.proxy`，禁止硬编码
- 本地走通只代表满足提交条件；推送后必须在线上重复同一套验证，结论冲突时以线上为准

**线上验证（最终判定依据）**：
- **后端改动**：用 curl / 浏览器在线上环境实际走通该阶段 happy path（/sync 阶段要实际跑「Turnstile 通过 → 建身份 → 提交 op → 全量下发」；/upload 阶段实际代理一次真实媒体并核对响应）
- **前端改动**：每个完成的组件在线上环境真实浏览器里亲手操作一遍交互，不只看渲染；核对「op-log → /sync → UI 刷新」数据流闭合
- **转码/上传管线（最高风险区）**：必须在线上环境 E2E 实测一张图片 + 一个视频完整走通「选文件 → 转码 → 写 OPFS → 经 /upload 代理上传 → 瀑布流出现」；DevTools 确认请求经 `{origin}/upload` 中转、响应 `data` URL 可写回 op-log。提交通道类代码前自查四类高频错误——函数是否真的被引用、worker `postMessage` 的 transfer 列表是否混入非 Transferable 对象（Blob 不可以）、文件类型判定是否与入口 `accept` 列表一致、**令牌生命周期自查：所有令牌获取路径（acquire 成功）是否都有对应释放路径（完成 / 失败 / worker onerror / pagehide），pagehide 处理器是否在 `visibilitychange→hidden` 之外单独注册**
- **静态检查**：每次提交前 `npm run ts-check` 零错误；转码模块不得被排除出类型检查
- 按「实现顺序」逐阶段推进，阶段 N 线上走通前不得开始阶段 N+1
- 建议用 Playwright 操控浏览器截图验证

**环境自检**：生产（tag `v*` → `infoto`）与测试（分支 → `infoto-dev`）各绑独立 D1（`database_name` 不同），用 `wrangler d1 list` 核对；工作流不执行构建，`dist/` 提交进仓库，push 前在 `web/` 执行 `npm run build` 确认产物完整；生产 `TURNSTILE_SECRET_KEY` 由工作流注入。后端实现「Turnstile secret 未配置则放行」分支并 `console.warn`，供全新 Worker 在 Secrets 注入完成前跑通链路；生产 secret 由工作流注入，线上不会走到该分支。
## 共享基底
以下纯函数资产位于后端包 `src/`，是实现前提，不得重写：
- `src/ui/lib`：layout / marquee / id36 / format（DOM-free，含测试）
- `src/ui/upload/pipeline.ts`：上传管线纯函数（含测试）
- 上述模块对应的测试文件（layout / pipeline / media 三个）

前后端共享代码的单一真源在 `src/`，前端经路径别名引用，不在 `web/` 内存副本：
- `$shared` → `src/shared`：契约类型
- `$base` → `src/ui`：基底纯函数库与上传管线

别名在 `web/vite.config.ts` 与 `web/tsconfig.json` 中各配置一份。
## 工程红线
1. **测试不得删除**：语义与当前实现不符的用例应改名保留其有效断言（如 `unupload` 用例实际验证「未知 op 静默丢弃」），不得以功能变更为由删除
2. **`npm run ts-check` 零错误是提交前置条件**（仓库根目录与 `web/` 各跑一次）；转码模块不得被排除出类型检查
3. 共享代码只经 `$shared` / `$base` 别名引用，不得在 `web/` 内另存副本
4. 上述任一项未满足，改动不得提交
## 视觉风格
### 组件基座
UI 一律基于 **shadcn-svelte**（Tailwind CSS v4 + Svelte 5 runes），组件通过 `npx shadcn-svelte add <component>` 引入并落地到 `web/src/lib/components/ui/`（在 `web/` 目录下执行 CLI），组件源码纳入仓库可直接定制。站点为常暗主题：根元素固定挂 `dark` class，不做主题切换。
本项目为纯 Vite SPA（非 SvelteKit）：需在 `web/vite.config.ts` + `tsconfig.json` 中配置路径别名 `$lib` → `src/lib`（shadcn-svelte 初始化时选择 Vite 选项即可），下文所有 `$lib/...` 均指 `web/src/lib/...`。
所有风格调整通过主题令牌（CSS 变量）与组件级 `class` 叠加实现，**不覆盖 shadcn 组件内部结构 class，不重造组件结构**。所有删除类操作直接执行，不引入 AlertDialog 确认。
**发光纪律**：全站无任何发光、光晕、外晕效果，一律扁平呈现。**唯一例外：错误页状态码文字的故障（glitch）特效，特效仅由错位双层文字（红/青错位描摹）构成，不得使用 box-shadow / drop-shadow / filter glow 类属性。**
### 主题令牌
Tailwind v4 在 `@theme` 中定义，shadcn-svelte 会自动将 HSL 转为 OKLCH，此处按语义色值标注：
| Token | 色值 | 用途 |
|---|---|---|
| `--background` | `#0a0e1a` | 页面背景 |
| `--foreground` | `#e2e8f0` | 主文字 |
| `--muted-foreground` | `#7b85a0` | 次级文字 |
| `--card` | `#131822` | 基础面板（卡片、侧边栏） |
| `--popover` | `#1a212e` | 抬升面板（悬浮菜单、上传进度） |
| `--surface-top`（扩展） | `#242d47` | 最高层（Toast、最前景下拉） |
| `--primary` | `#22d3ee` | 主题青（纯色；渐变使用受「组件基座」的渐变白名单约束） |
| `--primary-foreground` | `#0a0e1a` | 主题色上的文字 |
| `--ring` | `#22d3ee` | 焦点环 |
| `--border` | `#1e2640` | 常态边框（hover 调至 `#2a3550`） |
| `--destructive` | `#f43f5e` | 错误色 |
| `--success`（扩展） | `#10b981` | 成功 |
| `--warning`（扩展） | `#f59e0b` | 警告 / 三态排除态 |
| `--radius` | `10px` | 圆角（派生 rounded-lg/md/sm） |
胶囊形控件显式 `rounded-full`。常规控件一律纯色。

**渐变白名单（全站仅此三处，别处一律禁止）**：
1. 照片卡片信息底栏的自下而上黑色遮罩（保证图片上文字可读，功能性必需）
2. 空态插图
3. 品牌标识

本文档其它章节提到渐变时一律指向本清单，不得各自另立范围。
### 阴影（仅弹层）
- 轻弹层（Toast、DropdownMenu）：`0 4px 12px rgba(0,0,0,0.4)`
- 重弹层（Lightbox 菜单、上传进度面板）：`0 20px 50px rgba(0,0,0,0.6)`
- **卡片、按钮不设阴影、无光晕**
### 组件选型映射
| 功能 | shadcn-svelte 组件 |
|---|---|
| 侧边栏（设置、公告） | 自定义 `PushSidebar.svelte`（见下文），移动端降级 `Sheet` 全屏 |
| Toast | `sonner`（svelte-sonner，dark 主题） |
| 排序三项分段选择器 | `Tabs`（宽度不足时收起为 `DropdownMenu`） |
| 双柄滑块、单柄滑块 | `Slider`（range 模式 / 单值模式） |
| 归属、类型、布局图标开关 | `Toggle` / `ToggleGroup`（single / multiple） |
| 筛选、布局可折叠板块 | `Collapsible` |
| Lightbox 更多菜单、公告卡片操作菜单 | `DropdownMenu` |
| 卡片预览中的弹层编辑器 | `Dialog`（全屏） |
| 复制 / 分享按钮、提示 | `Tooltip` |
| 公告侧边栏反馈文本框 | `Textarea` + `Button`（浮动右下） |
| 上传进度、转码进度 | `Progress` |
| 未同步计数、筛选计数角标 | `Badge` |
| 管理面板搜索框、列表 | `Input`、`ScrollArea` |
| 公告标题展开 / 收起 | `Collapsible` |
| 空态 | `Empty` |
| 加载中 | `Spinner` |
| 拖动排序 | FLIP 自实现（shadcn 无对应组件） |
| 图标 | `@lucide/svelte` 线性描边 |
### 字体
```js
fontFamily: {
  sans: ['"Space Grotesk"', '"Inter"', '"Noto Sans SC"', 'system-ui', '-apple-system', 'sans-serif']
}
```
经 Google Fonts 国内镜像（`fonts.googleapis.cn`）加载 400–700 字重，在 `web/index.html` `<head>` 中引入 `<link>`。英文数字走 Space Grotesk → Inter，中文走 Noto Sans SC。排版一律 Tailwind `text-*` + `leading-*` + `tracking-*`。
### 全局自定义
**滚动条**（`web/src/app.css` 全局层）：
```css
@layer base {
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2a3342; border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a465a; }
  * { scrollbar-width: thin; scrollbar-color: #2a3342 transparent; }
  ::selection {
    background: color-mix(in srgb, var(--primary) 30%, transparent);
    color: var(--foreground);
  }
}
```
**图片加载失败兜底**：封装 `<PhotoFallback>` 组件（见自定义组件清单）。
**错误页**：404 与 5xx 返回风格一致的自定义错误页（暗色背景、青色大号状态码带故障 glitch 特效、返回首页链接）。故障特效实现：状态码文字双层伪元素错位描摹——`::before` 用 `--destructive` 色、`::after` 用 `--primary` 色，各自以 `clip-path` 随机阶梯裁切并做小幅水平错位（`transform: translateX(±2px ~ ±6px)`），配合 CSS `animation` steps() 抖动循环，营造信号干扰感；主文字本体保持实色 `--primary`，禁用发光/阴影属性。特效需尊重 `prefers-reduced-motion: reduce`（降级为静态错位双影、无动画）。Worker 侧为 Hono 注册全局异常处理（`app.onError`）：未捕获异常统一返回该自定义 5xx 错误页与 500 状态码，确保 Cloudflare 平台默认错误页不会外露。
## 文案规范
- 不用「XXX · XXX」式组合标签，分组靠结构与留白
- 不用「XXX（XXX…）」式括号补充，细节由交互自解释或 tooltip / 占位符
- 控件标签只用名词或两字动词（「筛选」「布局」「重置」「发送」「下载」）
- 空态提示一句话，不解释操作方法
- Toast 标题 ≤8 字，描述 ≤20 字
## 架构
- 前端：Svelte 5 + Vite + Tailwind CSS v4 + shadcn-svelte，SPA，构建产物由 Worker ASSETS 托管
- 后端：Hono + D1
- 本地持久化：IndexedDB（元数据缓存、op-log、任务状态）+ OPFS（转码产物）
- 图片转码：SharedWorker 内执行，`createImageBitmap` → `OffscreenCanvas.convertToBlob`，WebP quality 0.95，产出 `blob.type` 非 `image/webp` 视为环境不支持、拒绝上传
- 视频/GIF：由**各标签页主线程创建的顶层 DedicatedWorker** 执行——WebCodecs 仅暴露于 Window 与 DedicatedWorker，SharedWorker 中不可用；同时 SharedWorker 全局没有 `Worker` 构造器，嵌套 DedicatedWorker 方案不成立。SharedWorker 通过**并发令牌池**控制全局视频并发。池大小由纯函数 `videoPoolSize(nav)` 计算，判定顺序如下：
1. `navigator.deviceMemory` 存在 → 取该值：`≥ 8` → **2 个令牌**；`< 8` → **1 个令牌**
2. `deviceMemory` 不存在（Firefox / Safari 均未实现）→ 回退 `navigator.hardwareConcurrency`：`≥ 8` → 2 个；`< 8` → 1 个
3. 两者都不可用 → 1 个（保守默认）

上限硬顶为 2：视频编码是内存与 CPU 双密集，并发超过 2 会让低端设备整页卡死，收益也不成比例。`deviceMemory` 的取值**向上取到 2 的幂并钳制在浏览器自定义上下界内**（Edge 在 32GB 机器上返回 `32`，命中集合是 `{8, 16, 32}`）。标签页主线程获得令牌后创建/复用本页视频 worker，任务完成 / 失败 / pagehide 时归还令牌。Mediabunny（WebCodecs 后端）输出 WebM；视频轨 VP9 → VP8（`isConfigSupported` 探测），音频轨 Opus；GIF 经 `ImageDecoder` 逐帧入 VideoEncoder；codec 均不可用拒绝上传。**视频 worker 创建失败或 `onerror` → 标记该文件失败并提示，释放令牌，不降级主线程**（主线程跑视频编码会阻塞整页，非可接受降级）
- 令牌租约：令牌持有方周期性（5s）向 SharedWorker 发心跳；超过 15s 无心跳，SharedWorker 强制回收令牌，该页在途视频任务重新入队（转码幂等，OPFS 产物 sha256 查重兜底，重做安全）。页面崩溃、移动端后台被杀时 pagehide 不可靠，令牌泄漏仅靠租约兜底
- 哈希：hash-wasm 流式 SHA-256，产物写 OPFS 同时喂入哈希器，产物生成即哈希完成
- 跨标签页：SharedWorker 管理转码队列与任务状态，BroadcastChannel 广播进度，IndexedDB 持久化
- zip：fflate；Markdown：markdown-it + DOMPurify
- 编码参数：VP9 quantizer 30（恒定质量），VP8 兜底 `Quality('high')`；Opus 128kbps；分辨率、帧率、声道原样保留
## 设计理念
只在用户间同步媒体元信息，最小化请求次数。**上传数据面经 Worker 的 `/upload` 流式代理中转**（图床不可跨域），Worker 只做鉴权、现签 token 与请求体流式透传，不缓冲、不解析文件内容；站内加载直接使用元信息中的图床 URL（浏览器直连图床，享受图床 CDN）。`/l/:id36` 流式代理仅服务于**站外场景**（复制链接、谷歌搜图传参），防止站外直连图床。图床为外部服务，单文件单次直传（无分片、无断点续传）、不清理文件。**所有写操作（含根用户管理操作）统一走 op-log → /sync 管线**，服务端唯一写入口是 /sync；SQL 导入导出为全库整体替换，与增量 op 语义不兼容，使用独立端点。所有 API 端点不做代码层限速。所有删除操作均直接执行，不弹确认。
## 数据模型
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  uploader INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  type INTEGER NOT NULL,
  likes TEXT NOT NULL DEFAULT '[]',
  dislikes TEXT NOT NULL DEFAULT '[]',
  reports TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  sort INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE reactions (
  ann_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (ann_id, user_id)
);
CREATE TABLE votes (
  ann_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option INTEGER NOT NULL,
  PRIMARY KEY (ann_id, user_id)
);
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```
- 照片标记以 JSON 数组内嵌于 photos 行：唯一读取路径是随 /sync 全量下发，写入为单行单列读-改-写（add/remove 前 contains 检查）。**同一用户重复标记幂等安全**；不同用户并发标记同一照片时，读-改-写之间存在窗口，后写可能覆盖先写。该窗口极小（D1 单库写入串行、同批 op 顺序 await 应用），接受此风险，不做原子化改造
- 转码产物只有 WebP 与 WebM，type 已隐含扩展名（type=0 → `.webp`，type=1/2 → `.webm`），不存 ext 字段
- 投票选项文本不落库：`votes.option` 为选项序号，选项列表由前端从公告 contentMd 解析
- `TC_SECRET`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` 为 Worker 环境变量（wrangler secrets），不落库
- 存储层列名为 snake_case；**API 边界（/sync 请求与响应、所有 JSON 字段）一律 camelCase**，转换在序列化层完成
- **匿名站**：管理面板（仅根用户可见）可直接展示用户 ID（建议页用户徽标、反馈元信息）。普通用户不可见任何用户列表，数字 id 仅供前端判断「我上传的」「我喜欢的」等归属（与 `selfId` 比较）。uuid 只存在于 Cookie 与 `users` 表，**永不进入 /sync 响应**。非根用户只能在照片元数据里看到他人数字 id，不可接触 uuid
## 身份与 Cookie
- 首次访问（无 Cookie）时，页面不显示照片，显示 Turnstile 验证码（显式渲染，theme dark，风格与网站一致）
- 验证通过后调用 /sync：服务端创建用户（分配自增 ID、生成 UUID），Set-Cookie（**Cookie 字段名固定为 `uuid`**，HttpOnly、SameSite=Lax、Max-Age 10 年；Secure 仅在 https 或非 localhost 场景附加），返回全量元信息
- **每次 /sync 响应都重新 Set-Cookie 刷新 Max-Age**，滑动过期
- 第一位访问者（ID=0）为根用户，拥有全部权限，不设密码。ID=0 依赖显式分配（`COALESCE(MAX(id),-1)+1`），不依赖 SQLite 自增起始值
- Cookie 丢失即产生新身份，无找回机制
- 携带有效 Cookie 访问无需验证
- **身份仅凭名为 `uuid` 的 HttpOnly Cookie**；/sync 请求体不含 uuid 字段，服务端不接受任何请求体传 uuid（防冒充）
## 图床上传代理（/upload）
- 图床不可跨域，客户端无法直传；**客户端不持有任何图床签名**，`TC_SECRET` 仅存在于 Worker 服务端，/sync 响应不下发签名字段
- `POST /upload`（Cookie 鉴权）：客户端按图床协议构造 `multipart/form-data`（字段名 `file`，文件名按产物类型 `.webp` / `.webm`），发送到 `{origin}/upload`
- **校验顺序固定：Cookie → Content-Type**。先校验 Cookie（失败 401 `unauthorized`），再校验 `Content-Type` 须为 `multipart/form-data`（否则 400 `bad_content_type`）
- **图床为多节点池**：`HOST_UPLOAD_URLS = ['https://tc.0147258.xyz/upload', 'https://tc.qdqqd.com/upload']`，每次请求随机选取一个接入点；两个地址是同一图床服务的不同接入点，返回的 `data` URL 语义等价。随机选择不做健康探测，某一接入点整体不可用时约一半请求失败；接受此行为，失败由手动重试兜底，不实现健康检查与故障转移
- 校验通过后基于 `TC_SECRET` 以 HMAC-SHA256（HS256 JWT）现签 token 置于 `X-Auth-Token` 头（claims 仅 `{ timestamp }`），**请求体流式透传**至随机选中的图床地址（`body: request.body` + `duplex: 'half'`，透传 `Content-Type` 保留 boundary），不缓冲、不解析 multipart
- **响应体同样流式透传**；图床响应 JSON 原样转发，URL 位于 `data` 字段；失败时读取 `msg` / `error` 字段提示
- `TC_SECRET` 未配置 → 500 `tc_secret_missing`
- 客户端请求超时 45s（AbortController），超时按失败处理
- **上传失败（含超时）直接标记该文件失败，不做自动重试**；产物留 OPFS，上传卡片提供手动重试按钮，每次点击为一次独立上传尝试
- **大小限制**：Cloudflare 请求体上限 100MB；客户端在发起 /upload 前判断产物大小，超过 100MB 直接标记该文件上传失败，产物留 OPFS
- Worker 侧透传每文件一次调用、内部一个出站 fetch，子请求预算按调用独立计算
### 统一错误码表
| 端点 | HTTP | error | 触发条件 |
|---|---|---|---|
| /sync | 401 | `turnstile_required` | 无 Cookie 且未携带 Turnstile token；响应体附 `turnstileSiteKey`（公开 site key，前端据此渲染验证码；站点不设独立 config 下发端点） |
| /sync | 401 | `turnstile_failed` | Turnstile token 校验失败 |
| /upload | 401 | `unauthorized` | Cookie 无效或缺失 |
| /upload | 400 | `bad_content_type` | Content-Type 非 multipart/form-data（校验顺序在 Cookie 之后） |
| /upload | 500 | `tc_secret_missing` | TC_SECRET 未配置 |
| /upload | 502 | `image_host_unreachable` | 上游图床请求异常 |
| /admin | 404 | 自定义错误页 | 非 root（含未登录），不暴露端点存在性；root 返回 SPA 入口 |
| /admin/migrate | 404 | 自定义错误页 | 非 root（含未登录），不暴露端点存在性 |
**返回自定义错误页的路径不适用 JSON 约定**：`/admin`、`/admin/*`、`/admin/migrate` 的非 root 访问，以及所有未匹配路由，一律返回自定义 404 页。**其余 Worker 自身错误响应**统一为 `{ ok:false, error: '...' }`。
### 服务端签名示例（Worker，WebCrypto）
```js
async function makeTcToken(secret) {
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));
  const input = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ timestamp: Date.now() })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return `${input}.${b64u(sig)}`;
}
async function proxyUpload(request, env) {
  const pool = [
    'https://tc.0147258.xyz/upload',
    'https://tc.qdqqd.com/upload',
  ];
  const host = pool[Math.floor(Math.random() * pool.length)];
  return fetch(host, {
    method: 'POST',
    headers: {
      'X-Auth-Token': await makeTcToken(env.TC_SECRET),
      'Content-Type': request.headers.get('Content-Type'), // 透传 boundary
    },
    body: request.body,
    duplex: 'half',
  });
}
```
### 客户端上传示例
```js
async function uploadMedia(blob) {
  const fd = new FormData();
  fd.append('file', blob, `m.${blob.type === 'image/webp' ? 'webp' : 'webm'}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const r = await fetch(`${window.location.origin}/upload`, { method: 'POST', body: fd, signal: ctrl.signal });
    const json = await r.json();
    if (!r.ok) throw new Error(json.msg || json.error || `HTTP ${r.status}`);
    return json.data;
  } finally {
    clearTimeout(t);
  }
}
```
## /sync 协议
```
POST /sync
请求: { turnstileToken?, ops: [ { type, target, payload } ] }
响应: { ok, serverTime, selfId, photos, announcements, feedback }
```
- **首次入站 = 一次 Turnstile 验证 + 两次 /sync**：首次 /sync（无 Cookie、无 token）返回 401 `turnstile_required`，响应体携带公开 `turnstileSiteKey`；前端据此渲染验证码，用户通过后携带 token 再发一次 /sync，服务端校验通过即创建身份并全量下发。site key 只在该 401 响应中出现；携带有效 Cookie 的请求一律不要求 Turnstile
- **op 类型清单（16 种）**：
  - 照片区：`upload` / `like` / `unlike` / `dislike` / `undislike` / `report` / `unreport` / `delete`（仅根用户）
  - 公告区（仅根用户）：`ann_create` / `ann_update` / `ann_delete` / `ann_reorder`
  - 投票区（所有用户，作用于公告）：`vote`
  - 反馈区：`fb_create`（所有用户）/ `fb_delete`（仅根用户）
  - 反应区：`react`（公告表情）
- 未知 op 类型：静默丢弃。普通用户上传不可撤回，仅根用户可 `delete`
- 服务端按数组顺序应用；标记类是 photos 对应 JSON 数组的 add/remove（写入前 contains 检查，幂等）；上传 op 先于其上的标记 op（客户端保证）
- **静默语义**：
  - 非根用户提交管理类 op → 该 op 静默丢弃，不报错、不影响同批其他 op
  - SHA 撞车（多用户上传同一图片）→ 保留先到者的上传者 ID 与时间戳，后到的 upload op 静默丢弃
  - ann_update / ann_delete / react / vote / 标记类对不存在 target → 静默跳过（react 与 vote 侧服务端先校验公告存在，防孤儿行）
  - ann_delete 级联删除该公告的 reactions 与 votes 行（`DELETE FROM reactions/votes WHERE ann_id = ?`）；photos 无外键、不级联
  - ann_reorder payload 数组先做数值清洗（剔除非数字元素）后应用
- **applyOp 逐 op 异常隔离**：单个 op 抛异常被捕获后继续处理同批后续 op
- **服务端权威字段**：upload op 的 `photos.created_at` 一律取服务端接收时刻（serverTime），payload 中不包含 `created_at`；服务端亦不依赖 payload 中的 `uploader` 字段，一律以当前身份 id 为准
- **幂等性**：ann_reorder 提交全量 id 序列，服务端按序列重排 sort 为 0…n-1，重放安全；ann_delete 后其余公告 sort 保留空洞，下次 reorder 归一化；vote 为每用户每公告单行覆盖写，重复投票安全
- **全量下发**：photos 为全部照片元数据（含图床 URL 与三个标记数组）、announcements 为全部公告，服务端无聚合查询；不做版本控制与增量。**不下发用户列表**；当前身份只通过 `selfId` 告知前端。feedback 仅对根用户下发，非根用户响应中该字段为空数组
### 响应字段规范（camelCase）
```ts
selfId: 当前用户数字 id（根用户为 0）
photos[i]: { id, sha256, url, uploader, width, height, size, type, createdAt, likes[], dislikes[], reports[] }
announcements[i]: { id, title, contentMd, sort, updatedAt, reactions: [{ userId, emoji }], votes: [{ userId, option }] }
feedback[i]: { id, userId, contentMd, createdAt } // 仅 root 非空
```
**同步触发点**：Turnstile 通过后、打开网站时、离开标签页时（pagehide / visibilitychange→hidden）、op-log 达 256 条时、手动点击同步按钮（主页面与管理面板均可）。达 256 条触发自动同步但不禁止操作，期间继续累积，同步成功后清空。**经 pagehide 触发的 /sync fetch 必须携带 `keepalive: true`**；浏览器对 keepalive 请求体有 64KB 硬限制，序列化前必须用 `TextEncoder` 计量字节数：
- **≤ 65536 字节**：整批携带 `keepalive: true` 发出
- **> 65536 字节**：按 op 顺序截取能装进 64KB 的最长前缀（逐条累加，为 `ops` 数组包装与 JSON 转义留余量）单独发出，其余 op 继续留在队列等待下次同步；收到响应后只把已发出的前缀从队列移除。op 全部幂等且服务端按序应用，**部分提交不破坏语义**
- **主动降级**：`visibilitychange → hidden` 时页面尚未卸载、可以 await，先做一次**普通 awaited /sync**；pagehide 的 keepalive 只作最后兜底。op-log 达 256 条触发的自动同步同样走普通 fetch，不进 keepalive 路径
- 前缀截取至少保留 1 条 op。单条 op 自身即超 64KB 属异常（仅可能来自超大 `ann_create` 正文），此时放弃本次提交并 `console.warn`，op 留存不丢失
## 媒体 ID 与地址策略
- 每张照片有自增数字 ID；**站内 API（/sync 响应、op target）一律数字表示**
- **id36 是对外表示的编码，不进入 API 层**：仅用于 `/l/:id36` 路由与下载文件名。站外场景使用 `{origin}/l/{id36}`，origin 取自当前访问域名；图床地址不离开元信息与 Worker
- **站内加载**（瀑布流、卡片预览、`<img>`/`<video>` src、站内下载 fetch）：直接使用元信息中的图床 URL，浏览器直连图床，Worker 不参与数据面
- 单张下载文件名沿用 `{id36}.webp` / `{id36}.webm`
## 媒体代理（/l/:id36）
- 服务端将 id36 解码为数字 ID（正则 `[0-9a-z]+` → `parseInt(id36, 36)` → 安全整数校验）后命中元数据，fetch 图床 URL，**响应体流式转发**（不缓冲完整文件），设置 `Content-Type` 与 `Content-Length`
- 站外场景引用媒体只经本代理：图床地址不出现在任何响应中、不离开元信息与 Worker，防止图床源地址被扒取与外站直连。响应设置长缓存头（媒体内容不可变，immutable），站外直链共享同一缓存副本
- 非法 id36 / 照片不存在 → 自定义 404 页
## 上传管线
两阶段，SharedWorker 调度，进度跨标签页同步，刷新不丢失。并发分池：
- 图片：SharedWorker 内转码，`clamp(2, 6, floor(navigator.hardwareConcurrency × 0.75))`；取不到时默认 4。可选用 `navigator.connection.downlink` 修正：downlink < 2 Mbps 时上限降为 2
- 视频/GIF：本页顶层 DedicatedWorker 转码，全局并发由 SharedWorker 令牌池控制（池大小判定见架构一节），标签页 acquire 令牌后创建/复用本页 worker，release 后可销毁；空闲 worker 可保留复用，令牌归还即本页无转码权
**阶段一**（转码 + 元信息读取）：
- 图片 → WebP，type=0
- 视频与 GIF → WebM。**type 由转码阶段探测原始媒体是否含音频轨决定**：无音频轨（含 GIF）→ type=1，有音频轨 → type=2
- 读取宽高、大小 + 流式计算 SHA-256，本地元数据缓存查重，命中则跳过阶段二并通知「重复」
**阶段二**（上传）：从 OPFS 取产物，按 /upload 节的 100MB 大小限制前置判断（超限直接标记失败、产物留 OPFS）；否则按 `uploadMedia` 经 `{origin}/upload` 上传，获得 URL 后元信息写入 op-log，等待同步提交。上传失败（含超时）标记失败，产物留 OPFS，卡片提供手动重试按钮。
上传期间，**信息卡片与进行中的媒体卡片均作为瀑布流内的真实布局单元呈现**，不使用浮层：
- **信息卡片**：固定宽高比 16:10 的虚拟媒体条目，钉在瀑布流条目序列最前（任何排序模式下都在最前），**与普通媒体同规则参与 Justified / Masonry 布局与缩放**，布局尺寸不随内容增减变化。卡片内容自适应渲染尺寸：上方为成功/失败/重复/剩余计数，下方为阶段一媒体列表（每行一个并发槽，显示文件名和进度条）；列表超出卡片高度时内部滚动
- **阶段二媒体**：以真实条目形式**插入布局序列（紧随信息卡片、先于其他媒体）**，宽高使用真实元信息。条目上覆盖半透明蒙版，**蒙版本身即进度条——随上传进度自下而上消失**。上传成功后蒙版消失、条目转为普通媒体；因 SHA 撞车被静默丢弃的条目直接移除
- 全部上传结束后，信息卡片从瀑布流移除，全部条目回归正常排序，布局一次性重算收尾
## 主页面
顶栏 + 瀑布流 + 左右两个可开合侧边栏（设置侧边栏、公告侧边栏）。
顶栏左上顺序：**排序胶囊、设置图标、同步图标**（同步图标右下角 `Badge` 小圆点显示未同步操作数，同步时图标旋转；有生效筛选时设置图标同款样式显示筛选计数）。顶栏右上顺序：**公告图标、多选图标、上传图标**。顶栏结构：**推挤布局的 flex 成员，非 fixed 全宽**——侧边栏开合时顶栏宽度随主内容区一起变化。类串：`sticky top-0 z-40 backdrop-blur-xl backdrop-saturate-150 bg-background/70 border-b border-border`。图标按钮统一 `Button variant="ghost" size="icon"`，无底色圆框。图标高亮态：`text-primary`。
排序胶囊是 **`Tabs` 三项并列分段选择器**：**最新、最热、随机**，当前项高亮（`TabsTrigger` 激活态取主题青色）。各项随状态切换图标与文字同步差分：
- 「最新」arrow-down-wide-narrow；再次单击切为「最旧」arrow-up-wide-narrow
- 「最热」flame；再次单击切为「最冷」snowflake（热度 = 喜欢数 − 不喜欢数）
- 「随机」shuffle，每次单击重新打乱（Fisher-Yates，本地执行）
宽度不足时胶囊收起为单个排序图标（当前态对应图标），点击展开 `DropdownMenu` 选项浮层。
## 侧边栏（推挤式布局）
**侧边栏不是 Sheet 浮层，而是推挤式布局**——顶栏与瀑布流整体让位，主内容区宽度变化，瀑布流基于新宽度重算布局。
实现方式：自定义 `PushSidebar.svelte`，使用 flexbox 将侧边栏插入主内容流（桌面端固定宽度 360px，移动端占满屏宽）；**参考 shadcn-svelte `Sidebar` 组件在桌面端 `collapsible="offcanvas"` 的推挤行为**（注意 `offcanvas` 是 `collapsible` 的取值，`variant` 只接受 `sidebar` / `floating` / `inset`），但因其为单实例设计，左右两个同时展开的场景需自行组合。移动端（< 768px）降级为 `Sheet` 全屏浮层。
- 设置侧边栏固定**屏幕左侧**，公告侧边栏固定**屏幕右侧**
- 两个侧边栏**可同时开启，互不排斥**；分别贴靠左右两条边，不叠层
- 侧边栏内部独立纵向滚动（用 `ScrollArea`）；再次点击对应顶栏图标或按 Esc 关闭
- 侧边栏打开时对应顶栏图标保持高亮（primary 纯色），关闭后恢复；两图标高亮状态独立。移动端降级为 Sheet 全屏时不适用（顶栏图标不可见）
- 侧边栏头部：图标 + 单词标题 + 关闭按钮（`SheetClose` 样式的 `Button variant="ghost" size="icon"`）；分区标题前配线性小图标；头部与分区之间不用分隔线，靠留白区分
## 瀑布流
四个布局模式由滚动方向 × 填充策略组合驱动：
| 模式 | 滚动 | 策略 |
|---|---|---|
| Justified ↓ | 纵向 | Sequential：行等高、宽按比例、严格左→右上→下 |
| Masonry ↓ | 纵向 | Shortest：固定列宽、最短列优先 |
| Justified → | 横向 | Sequential：列等宽、高按比例 |
| Masonry → | 横向 | Shortest：固定行高、最短行优先 |
**默认**：移动端 Masonry ↓，桌面端 Justified ↓。
渲染分两层：布局层在元数据到达后分帧计算全部条目坐标（每帧 200–500 条切片，避免长任务），滚动条与总高度一次到位；DOM 层为滑动窗口，仅渲染当前视口 ± 缓冲区（前后各约 1–2 屏）内的节点，窗口外节点移除并卸载 `<img>`/`<video>` 释放解码内存。排序切换与筛选直接基于全量元数据重算布局。侧边栏开合导致主内容区宽度变化时，布局基于新宽度重算。设置中可调滚动方向、填充策略、目标带宽度、间距等算法参数；缩放通过桌面 Ctrl+滚轮 / 移动端捏合调节（50%–200%）。
移动端上滑浏览时隐藏顶栏，下滑显示；已在顶端时下拉触发同步（`overscroll-behavior-y: contain`）；桌面端用 Ctrl+R 替代。
### 照片卡片
```
<Card class="relative overflow-hidden rounded-[var(--radius)] bg-card">
```
- 图片/视频原生 `<img>` / `<video>`（`muted loop autoplay playsinline`），`loading="lazy"`，失败时渲染 `<PhotoFallback>`
- 卡片信息底栏：绝对定位 `absolute bottom-0 inset-x-0 p-2 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent`（渐变白名单第 1 项，见「组件基座」）
- 左下角显示喜欢、不喜欢、请求删除的线条图标和数量，数量为零时隐藏该项，用户标记过则对应图标高亮（主题青色）
- type=2 则右下角显示 volume-x 图标，默认静音，单击切换
- **视频类媒体（type=1、2）在卡片中直接循环播放**（静音自动播放、loop），不使用海报帧
## 多选模式
点击多选图标进入/退出，长按 ≥500ms 进入多选模式并选中该图。单击单选，拖动框选并动态判定被框中的项。
- 选中卡片：`border-2 border-primary` 边框高亮 + 右上角 `Checkbox`（绝对定位）
- 底栏：`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 backdrop-blur-xl bg-popover/90 border border-border rounded-full px-6 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex items-center gap-4`（毛玻璃胶囊）
- 左下角全选图标（桌面端 Ctrl+A）；中部显示已选数目和总大小（如 `20, 1.7 GB`）；右下角下载、取消标记图标，根用户额外显示删除图标
- 根用户点击删除图标直接对全部已选提交 `delete` op，本地立即移除对应项，无确认
## 卡片预览（Lightbox）
非多选模式单击照片进入，卡片可滑动。`Dialog` 全屏弹层：
```
<Dialog.Content class="fixed inset-0 w-screen h-screen max-w-none m-0 rounded-none border-none bg-background/95 backdrop-blur-sm p-0 flex items-center justify-center">
```
顶底栏毛玻璃（`backdrop-blur-xl bg-popover/80 border-border`）：
- 顶栏：左 `Button variant="ghost" size="icon"`（关闭 `X`）+ 中 Meta 信息（`Badge variant="secondary"` 组：尺寸、文件大小、上传时间）+ 右 `Button variant="ghost" size="icon"`（更多 `MoreHorizontal` → 展开 `DropdownMenu`：复制原图、复制链接、分享、谷歌搜图、取消标记、请求删除——已请求则显示取消删除）；桌面端菜单弹出后再按下键退出菜单
- 底栏：左右切换 `Button variant="ghost" size="icon"` + 进度指示
**手势**：
- 左滑过阈值标记喜欢（thumbs-up 高亮提示），右滑过阈值标记不喜欢（thumbs-down），完成后自动切下一张；下滑过阈值下载；上滑过阈值弹出 `DropdownMenu` 更多菜单
- 单击屏幕左/右半区切上一/下一张；桌面端用 PgUp/PgDn 和方向键对应四个滑动方向
- 缩放：双击放大；桌面端 Ctrl+鼠标拖动、滚轮缩放；移动端双指捏合；进入变换态后四向滑动不触发方向手势，双击（桌面端可双击 Ctrl 键）复原并恢复手势
## 下载
站内下载 fetch 图床 URL，优先使用浏览器缓存。单张文件名为 `{id36}.webp` 或 `{id36}.webm`；多张本地打包 download.zip（fflate 流式），内部文件按已选项当前排序序号命名，高位补零，位数取总数位数。
## 公告侧边栏
点击公告图标从**右侧** `PushSidebar` 展开。内容区 `space-y-4` 纵向滚动：
- 每条公告 `Card`，`CardHeader` = 标题 + `ChevronDown`，点击用 `Collapsible` 展开/收起内容
- 内容为 Markdown 渲染容器（`prose prose-invert max-w-none` + 自定义暗色 override）
- **表情反应条**（内容底部，GitHub 风格按钮组）：每个已出现过的表情渲染为一枚计数按钮（`Button variant="outline" size="sm" class="rounded-full"` 形态，如 `👍 3`），显示表情与计数；当前用户已回应的按钮高亮（主题青色边框与文字），点击切换（回应 / 取消，每用户每公告仅一条回应）；无任何回应时仅显示一枚「添加反应」按钮（`SmilePlus` 图标），点击弹出表情选择浮层（`DropdownMenu`，表情集合固定为 `👍 👎 ❤️ 😂 😮 😢 🔥 🤔`，选择即提交 `react` op）
**反馈输入区**：底部 `Card` 固定于侧边栏底部（`sticky bottom-0 bg-popover pt-4`）：
- `Textarea`（`rows={5}`，`resize: vertical`，背景 `--muted`，placeholder「写下你的建议」）
- 发送按钮：`Button variant="default" class="absolute right-6 bottom-8 rounded-full"`，**输入框有文本时才显示**，为空时 `opacity-0 pointer-events-none transition-opacity`
- Markdown 预览：检测到 `#`、`**`、`- `、`[link](` 特征后，在 `Textarea` 上方叠加同高度预览面板
- 发送提交为 `fb_create` op，进入 op-log 等待同步
## Markdown 编辑器
- 编辑器工具栏：粗体、斜体、下划线、删除线、引用、代码块、列表、链接、图片、投票，`ToggleGroup` 实现，分屏实时预览
- **文件上传（含图片）走同一条上传管线**：经 100MB 前置判断后由 `{origin}/upload` 代理上传 → 成功后将返回 URL 以 Markdown 图片/链接语法直接嵌入编辑器光标处
- **投票**为自定义 Markdown 扩展语法：独立一行 `:::vote 选项A | 选项B`（`|` 分隔，至少 2 项），仅公告支持（反馈区不解析该语法）。渲染为 `ToggleGroup type="single"` 选项按钮组，已投选项高亮；点击提交 `vote` op（target: 公告 id，payload: `{ option: number | null }`，null 表示撤回）；每用户每公告仅一票，重复点击为整行覆盖。选项计数在投票组下方以 `Badge variant="secondary"` 展示
- 分屏布局：Tailwind `grid grid-cols-1 md:grid-cols-2` 左右两栏（shadcn-svelte 无 `Grid` 组件），左为编辑 `Textarea`，右为预览 `Card variant="ghost"`（`prose prose-invert`）
## 设置侧边栏
单击设置图标从**左侧** `PushSidebar` 展开。含筛选、布局两个 `Collapsible` 板块，筛选默认展开、布局默认折叠，折叠状态持久化。底部为「重置」`Button variant="outline" class="w-full"`。**不设逐条筛选摘要**：筛选是否生效通过各控件自身状态表达（图标高亮色与高亮圆点），有生效筛选时顶栏设置图标显示 `Badge` 计数角标。
### 筛选板块
全部筛选条件之间为 **AND** 关系，全部在前端本地元数据上即时执行，改动立即反映到瀑布流（防抖 150ms 重算布局）。分三个子组，子组之间靠留白区分，不加分隔线与组合式文字标签。
**范围**——热度、喜欢数、不喜欢数、请求删除数、文件大小五项双柄 `Slider`（range 模式），默认整组折叠。**无任何可筛项（元数据为空，或全部照片各指标均 min = max）时整个「范围」子组不渲染**，连标题一起隐藏。展开后：
- 仅渲染当前可筛（min ≠ max 且元数据非空）的滑块
- 滑块总可调范围**由本地元信息动态计算**：每次元数据变更（/sync 完成、标记 op 本地应用）后重算；文件大小滑块采用对数刻度，计数类为线性整数刻度
- 两柄分别设定下限与上限，拖动时滑块上方实时显示当前区间值（文件大小以人类可读单位显示）
- 每项滑块右侧有重置图标（`RotateCcw`），单击恢复完整动态范围；未处于完整区间的项，其标签前显示高亮圆点
- 双柄不可交叉；两柄重合时区间为闭区间单值
**归属**——四项**`Toggle` 图标开关**，2×2 网格：
- 我上传的 → `Upload`；我喜欢的 → `ThumbsUp`；我不喜欢的 → `ThumbsDown`；我请求删除的 → `Flag`
- 单击循环三态：**未启用→ 仅含（variant default，主题青色）→ 仅不含（自定义橙色态 `#f59e0b`）→ 未启用**
- 当前态仅靠 pressed 状态与颜色区分，默认态无任何高亮；判断依据为元数据中 uploader 或对应 JSON 数组是否含自己 ID
- 自定义 `TriStateToggle.svelte` 封装
**类型**——三颗**`Toggle` 图标开关**，横排一行：
- 图片（type=0）→ `Image`；动图（type=1）→ `ImagePlay`；视频（type=2）→ `Video`
- 单击在选中（主题青色高亮）/ 未选中（muted）间切换，至少一个选中——尝试取消唯一选中项时忽略该次点击
### 布局板块
`Collapsible`（默认 closed），四项：
- 滚动方向：`Toggle` 二态，纵向 `ArrowDownToLine`、横向 `ArrowRightToLine`，Tooltip 显示名称
- 填充策略：`ToggleGroup type="single"`，`ListOrdered`（Sequential）/ `AlignHorizontalDistributeCenter`（Shortest）
- 目标带宽度（Justified 行高基准）：单柄 `Slider`，200–800px，默认 320px
- 间距：单柄 `Slider`，0–32px，默认 8px
布局板块全部项改动即时生效并持久化到 localStorage。滑块、图标高亮态均使用主题色纯色，不用渐变。
## 管理面板
`/admin` 为前端路由（SPA）。**安全边界在服务端**：`/admin` 与 `/admin/migrate` 由 Worker 强制鉴权，非 root（含未登录）一律返回自定义 404 页、不暴露端点存在性，root 访问 `/admin` 才返回 SPA 入口。页面另基于 /sync 返回的 `selfId` 控制管理界面显隐，该判定仅服务于界面态，不构成访问控制。
**全部写操作走统一 op-log 管线**：本地立即应用（乐观更新）→ 写入 op-log → 触发 /sync 提交。与主页面共享同一个同步触发器与 SharedWorker，跨标签页广播。同步失败时操作保留在 op-log 中等待下次同步；同步成功后本地状态以服务端全量下发为准校正。
**乐观更新的临时 id**：ann_create 在本地使用负数临时 id（-1、-2 递减），/sync 响应后按提交顺序映射回服务端分配的真实 id；同批 op 中引用临时 id 的 ann_update / ann_delete，客户端在构造 op 序列时已知映射关系，直接写入序列中的对应位置。
### 顶栏
- 左端：`Tabs` 胶囊切换「公告」「建议」两个页面
- 中部：**同步图标**（`SyncButton.svelte`，与主页面同款）
- 右端：新增公告图标（`Plus`）、导入图标、导出图标；**SQL 导入导出以 SQL 格式下载或上传**：
  - **导出**：`Button variant="ghost" size="icon"`（`Download`）→ 服务端遍历全部表生成 SQL 文本（CREATE TABLE + INSERT 语句），作为附件下载；DDL 与 schema.sql 单一真源对齐；字符串转义按 SQLite 语义（仅单引号双写，不做反斜杠转义）；导出响应设置 `Cache-Control: no-store`
  - **导入**：`Button variant="ghost" size="icon"`（`Upload`）→ `Popover` + `Input type="file"` 选 `.sql` + 上传 `Progress`
### SQL 导入（改名交换法）
1. **单次 `db.batch()` 提交全部 `ALTER TABLE x RENAME TO x_old`**（batch 为事务语义，全部表要么全部改名要么全部未改；若实测 D1 对 DDL batch 有限制，回退逐条执行并以第 5 步的条件化恢复兜底）
2. 重放 `schema.sql` 建新表（schema 覆盖全部六张表，含 `votes`）
3. 解析上传的 `.sql` 文本为语句列表（引号感知：字符串字面量内的 `;`、`--`、`/* */` 不拆分不剥离，`''` 转义原样保留；注释剥离仅限字面量外；仅保留 INSERT 语句），按块（每块约 100 条）通过 D1 `batch()` 分块导入
4. 全部成功后 DROP 全部 `x_old`，导入完成
5. 任一块失败立即中止：**块内逐句重放定位精确失败语句** → 执行**条件化恢复**——仅对已存在 `x_old` 副本的表执行「DROP 半成品新表 → RENAME 回原名」，**从未改名的原表绝不动** → 向前端返回精确的失败语句与错误原因
6. 即使恢复路径自身再次崩溃，`x_old` 表仍持久化在库中，可人工恢复，不存在全量数据丢失窗口
导入入口提示「导入前请先执行导出」。
导入成功后**清空本地 op-log**并强制触发一次全量 /sync，以服务端新状态为准重建本地缓存，所有在线客户端同步刷新。
两个页面均有空态提示（`Empty` 组件，居中图标 + 一句话：「暂无公告」「暂无建议」）。
### 公告页面
- 列表：按 sort 升序渲染公告 `Card` 卡片
- 左侧拖动把手图标（`GripVertical`），拖动排序；拖动中卡片半透明跟随，其余卡片实时让位（FLIP 动画）；松手后**本地立即应用新顺序**，同时写入 `ann_reorder` op；同步失败回滚到拖动前位置并提示
- 标题（单行截断）与内容纯文本预览（两行截断）
- 元信息行：更新时间（相对时间 + `Tooltip` 悬浮绝对时间；乐观更新时显示 `Badge variant="outline" class="animate-pulse"`「同步中」，/sync 确认后以 serverTime 校正）、回应统计（只读展示：相邻 `Badge variant="secondary"` 组，各表情与计数间以空格分隔，如 `👍 3` `❤️ 1`）
- 右上角操作图标：编辑、删除（`Button variant="ghost" size="icon"`）
- **新增/编辑**：点击顶栏右端 `Plus` 图标（或卡片编辑图标）打开全屏 `Dialog` 编辑器：
  - 顶部 `Input` 单行标题输入框（placeholder「公告标题」，必填；校验失败时 `border-destructive focus-visible:ring-destructive`）
  - 中部：Markdown 编辑器完整内核
  - 底部「保存」「取消」`Button`，编辑态额外显示「上次更新于 …」，标题或内容为空则按钮禁用
- 保存即**本地立即生效**（新增以临时 id 追加到列表末尾，编辑就地更新），同时写入 `ann_create` op（payload: `{ title, contentMd }`）或 `ann_update` op（target: id，payload: `{ title, contentMd }`，服务端刷新 updated_at）触发 /sync；/sync 成功后临时 id 替换为服务端真实 id，失败则卡片右上角显示重试图标
- **删除**：点击删除图标直接执行——本地立即移除，同时写入 `ann_delete` op（target: id）；失败则恢复卡片并提示。删除后其余公告 sort 不重排（保留空洞，下次 reorder 时归一化为 0…n-1）
### 建议页面
- 顶部：`Badge variant="secondary" class="text-base px-4 py-1"`（总数统计，随删除实时更新）+ `Input class="max-w-xs"`（搜索框，带 `Search` 图标前缀，按内容关键词与用户 ID 过滤，本地执行，不区分大小写，无结果空态「没有匹配的建议」）
- 列表：按 createdAt 倒序渲染反馈 `Card` 卡片：
  - 收起态（`Card variant="outline"` 样式）：两行纯文本预览（剥离 Markdown 标记）、右侧用户 ID `Badge variant="outline"` 与相对时间、右上角删除图标
  - 展开态（单击切换）：全文 Markdown 渲染（DOMPurify 消毒），元信息完整——用户 ID、提交时间（绝对时间）、反馈 ID；含经图床上传的附件图片则直接渲染
  - 同一时间仅一条展开
- **删除**：点击删除图标直接执行——本地立即移除，同时写入 `fb_delete` op（target: id）触发 /sync；失败则恢复卡片并提示
## 构建与部署
- **本地构建并提交产物**：在 `web/` 执行 `npm run build`，产物输出到 `dist/` 并提交进仓库，工作流不执行构建；工作流仅做 checkout → 确保同名 D1 → patch wrangler.toml → 应用 schema → `wrangler deploy` → 透传 Secrets
- 工作流（`.github/workflows/deploy.yml`）：push `main` 或 `v*` 标签自动触发，支持 `workflow_dispatch`。Worker 与 D1 同名，已有同名 D1 时直接使用、不覆盖不重建。标签 → `infoto`（生产），分支 → `infoto-dev`（测试），各自独立 D1
- 所需仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`TC_SECRET`、`TURNSTILE_SECRET_KEY`；Variables：`TURNSTILE_SITE_KEY`
## 端点清单
| 方法 | 端点 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/sync` | Cookie；无 Cookie 时凭 Turnstile token 创建身份 | 唯一写入口：op 提交（含管理 op）+ 全量下发 + 刷新 Cookie |
| POST | `/upload` | Cookie | 图床上传流式代理：Cookie → multipart 校验 + 现签 token + 双向流式透传 |
| GET | `/l/:id36` | 无 | 流式代理图床媒体，供站外分享与外站传参，长缓存 |
| GET | `/admin` | 仅根用户 | 管理面板入口：非 root 返回自定义 404 页，root 返回 SPA 入口 |
| GET | `/admin/migrate` | 仅根用户 | SQL 导出 |
| POST | `/admin/migrate` | 仅根用户 | SQL 导入（改名交换法，失败不损坏原数据并返回精确失败语句；成功后清空 op-log） |
| GET | `/*` | — | ASSETS 静态资源服务：命中静态文件按原样返回；无扩展名的前端深链回退 `index.html`（SPA fallback）；其余未匹配返回自定义 404 页。`/admin` 在 fallback 之前已被服务端鉴权拦截 |
## 路由顺序
`/sync` → `/upload` → `/l/:id36` → `/admin` → `/admin/migrate`（GET 导出 / POST 导入）→ `/admin/*`（非 root 自定义 404）→ `/*`（ASSETS → SPA fallback → 自定义 404）
## 实现顺序
分三阶段推进，每阶段在线上走通后才进入下一阶段。本契约是唯一实现标准。

1. **阶段一 · 后端**：schema + migrations、Hono 路由、Turnstile、身份、/sync（含全部 op 类型）、/upload 上传代理、/l/:id36 代理、错误页
2. **阶段二 · 前端逻辑层**：Svelte 骨架、Tailwind v4 + shadcn-svelte 初始化（主题令牌、常暗 class）、IndexedDB 缓存、op-log 同步引擎、转码上传管线（SharedWorker 调度 / 视频令牌池 / 本页顶层 DedicatedWorker / Mediabunny / hash-wasm / OPFS / 音轨探测 / /upload 代理与 100MB 前置判断）。**本阶段不做产品 UI**
3. **阶段三 · 产品 UI**：瀑布流与排序筛选、标记、多选、卡片预览手势、公告与反馈、Markdown 编辑器与投票、管理面板、SQL 导入导出（含改名交换法导入）

阶段一完成后即可用 Turnstile 流程在线上端到端验证身份与 D1，风险最早暴露。
## 组件安装清单（在 `web/` 下一次性执行）
```bash
# 初始化
npx shadcn-svelte@latest init
# 按需添加
npx shadcn-svelte@latest add button card tabs sheet sidebar dropdown-menu \
  popover dialog collapsible slider toggle toggle-group tooltip \
  textarea input checkbox badge progress sonner spinner empty \
  scroll-area label separator skeleton
# 依赖
npm i @lucide/svelte svelte-sonner fflate markdown-it dompurify hash-wasm mediabunny
npm i -D @types/markdown-it @types/dompurify
```
## 项目内自定义组件清单（`web/src/lib/components/custom/`）
所有自定义组件**必须使用 shadcn 的 UI 基元组合**（不得绕开 shadcn 直接手写样式体系）：
- `PushSidebar.svelte`：推挤式侧边栏布局容器（桌面 flex，移动端降级 `Sheet`），side 左/右，受控开合
- `TriStateToggle.svelte`：三态图标开关（未启用 / 仅含 / 仅不含），基于 `Toggle`
- `RangeSlider.svelte`：带 Tooltip 实时值 + `RotateCcw` 重置按钮的双柄 `Slider`
- `SortTabs.svelte`：响应式排序胶囊（`Tabs` → `DropdownMenu`）
- `SyncButton.svelte`：带旋转动画与 `Badge` 计数角标的同步按钮
- `MultiSelectBar.svelte`：多选毛玻璃胶囊底栏
- `PhotoFallback.svelte`：图片加载失败兜底（emoji + 文件名缩略 ≤8 字符，底色 `--card`，文字 `--muted-foreground`）
- `MarkdownEditor.svelte`：工具栏（`ToggleGroup`）+ 分屏预览内核
- `MarkdownView.svelte`：`prose prose-invert` 改造 + DOMPurify 消毒
- `ReactionBar.svelte`：公告表情反应条（GitHub 风格计数按钮组 + 添加反应按钮）
- `ReactionPicker.svelte`：表情选择浮层（`DropdownMenu`，八枚固定表情）
- `UploadProgressPanel.svelte`：上传进度卡片（`Progress` + 并发槽列表）
- `ErrorPage.svelte`：404 / 5xx 自定义错误页，状态码大号文字带故障 glitch 特效（红青错位双影 + steps() 抖动，尊重 `prefers-reduced-motion`）
## Button 可用尺寸速查
shadcn-svelte 当前 `Button` 支持的 `size`：`sm` / `default` / `lg` / `icon` / `icon-sm` / `icon-lg`。**不存在 `xs` 与 `icon-xs`**，勿使用。照片卡片等需要更小图标按钮时用 `icon-sm`（`size-8`）；`icon` 为 `size-9`，`icon-lg` 为 `size-10`。施工前以 `npx shadcn-svelte add button` 后 `button.svelte` 源码为准。
