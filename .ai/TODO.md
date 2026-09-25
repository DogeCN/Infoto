# Infoto TODO

Infoto：部署在 Cloudflare Workers 上的全栈共享相册（匿名站 + Turnstile 建号 + op-log 单向上传同步 + 图床代理 + 浏览器内转码）。

**这份文档只记「还没做完」和「做得糙」。** 已实现的行为以代码为准，不在这里复述；第五节列出的硬约束是改相关代码前必须先看的例外。

## 开工前

```bash
# 本地
npm run db:reset && npm run seed:local         # 清库重建 + 建身份（root）+ 24 张示例照片
npm run seed:ann -- --uuid <root-uuid>         # 测试公告（含投票）；root uuid 每次 reset 都会变，先查库
npm run dev:worker                             # Worker :8787（只认 127.0.0.1）
cd web && npm run dev                          # Vite :5173，API 经 dev proxy 转发

# 门禁（改完必须全绿才能提交）
npm test && npm run ts-check                   # 仓库根
cd web && npm run ts-check && npm test && npm run build
```

「完成」的定义：本地走通 → 门禁全绿 → 提交 → 等部署 → 线上走 happy path。**最终判定以线上为准。**

- 提交用英文信息（`Frontend: ...` / `Refactor: ...` / `Docs: ...`），正文用 `-` 列点。
- 浏览器实测用 Playwright + 系统 Edge（`channel: 'msedge'`），`waitUntil: 'load'` + 固定等待（`networkidle` 会超时）。
- **临时脚本必须放 `web/` 下且以 `.tmp-` 开头**——Vite 的 `server.watch.ignored` 已排除它，否则写一次文件就整页重载一次（能连锁把 Worker 拖崩）。跑完删脚本与截图。
- 本机坑：`wrangler dev` 报 Ready 但 curl 挂死 = 多个僵尸 workerd 抢同一端口，`taskkill /F /IM workerd.exe` 后重启；`localhost` 不通时用 `127.0.0.1`。

**红线**

1. 测试不得删除——语义与实现不符的用例改名保留其有效断言。
2. `npm run ts-check` 零错误是提交前置条件（根 + `web/` 各一次），转码模块不得被排除出类型检查。
3. 共享代码只经 `$shared` / `$base` 别名引用，不得在 `web/` 另存副本。
4. 已定稿的交互（手势、框选、sticky、z-index、滑块）改动后必须重跑浏览器实测，不能只看类型检查。

---

# 一、未实现

| # | 项 | 现状 | 要做成 |
|---|---|---|---|
| 1 | **Markdown 编辑器** | `custom/MarkdownEditor.svelte` 已写但**零引用** | 工具栏（粗体/斜体/引用/代码块/列表/链接/图片/投票）+ 分屏实时预览；图片经上传管线嵌入光标处 |
| 2 | **公告编辑交互** | 管理面板用**内联卡片**（点「新增」在列表顶部展开表单：`input` + `textarea rows=4`） | 全屏 `Dialog`：标题 `Input`（必填）+ Markdown 内核 + 保存/取消；编辑态显示「上次更新于 …」；标题或内容为空则按钮禁用 |
| 3 | **公告列表元信息** | 只显示 `排序: N` + `更新: 2026/9/25` | 相对时间 + hover 绝对时间；乐观更新期间显示「同步中」徽章，`/sync` 后用 `serverTime` 校正；回应统计只读徽章（`👍 3` `❤️ 1`） |
| 4 | **公告拖拽排序动画** | 原生 HTML5 DnD，拖动中整卡 `opacity-50` | FLIP：卡片半透明跟随、其余卡片实时让位；松手本地立即应用并写 `ann_reorder`，失败回滚 + 提示 |
| 5 | **建议页展开态** | 只有两行截断的纯文本卡片 | 单击展开全文 Markdown 渲染（DOMPurify），元信息完整（用户 ID / 绝对时间 / 反馈 ID），附件图片直接渲染；同一时间仅一条展开 |
| 6 | **SQL 导入的 UI** | 顶栏 `Upload` 图标直接拉起隐藏 `input[type=file]`，导入中无反馈 | `Popover` + `Input type="file"` 选 `.sql` + 上传 `Progress`；提示「导入前请先执行导出」 |
| 7 | **空态形态** | 各页自绘「图标 + 一句话」 | 统一成一处可复用的空态（居中图标 + 一句话） |
| 8 | 管理面板「非 root」态 | 纯文字「需要管理员权限」 | 服务端已 404，前端此处只需不泄露界面存在性 |

# 二、未细调

1. **文件大小筛选用线性刻度**（按字节）。千万级区间里低端不可用，需要对数刻度。其余四项筛选是线性整数刻度，正确。
2. **类型开关「至少保留一个」**：当前尝试取消唯一选中时**静默忽略**。应改为：忽略 + shake 抖动（水平 ±3px / 200ms）+ 短暂转 `--color-destructive` + hover 提示。
3. **提示气泡**：全站用原生 `title`，没有 Tooltip 组件。原生 `title` 在触摸端不可达，是可访问性缺口。
4. **范围筛选无逐项重置**：只能把柄拖回端点；只有子组级 `RotateCcw`（恢复整组默认）。
5. **空态插图**：纯文字，没有插图（渐变白名单里的「空态插图」目前无处使用）。
6. **错误页字体**：`ErrorPage.svelte` 仍写 `Space Grotesk`，而该字体已不在 `index.html` 加载（会静默回退）。删掉这个 `font-family`，或补回字体。
7. **失败状态表达**：`/sync` 失败是去重 toast + 顶栏未同步计数，没有专门的「离线/排队中」态。

# 三、清理

- `custom/App.svelte`（72 行）——零引用，可删。
- `custom/MarkdownEditor.svelte`（141 行）——零引用，是待接线件（见一表 #1），**保留**。
- `/harness` 路由（`src/harness/Harness.svelte`）——开发验证面板，仅 `/harness` 或 `/?e2e` 可达，懒加载不进产品 chunk。**保留**。

---

# 四、既有实现的硬约束

改到相关代码前先看这一节。每条都是已经踩过的坑或明确的决策，**不是建议**。

## 后端

1. **`/sync` 是唯一写入口**，请求体永不带 uuid，服务端不信任任何 body 身份（一律以 Cookie 为准）。
2. **无绕过 Turnstile 的建号路径**：无 Cookie 且无 token → 401 `turnstile_required`（响应体带 `turnstileSiteKey`，site key 只在这里出现）；带有效 Cookie 一律不要求 token；secret 未配置 → 401 `turnstile_failed` + `console.warn`。
3. Cookie 名固定 `uuid`，HttpOnly + SameSite=Lax + Max-Age 10 年（Secure 仅在 https/非 localhost），每次响应重新 Set-Cookie 滑动过期。
4. `users.id` 是普通 `INTEGER PRIMARY KEY`（**无 AUTOINCREMENT**），首条即 id 0 = root；分配用 `COALESCE(MAX(id),-1)+1`。**`ann_create` 等管理 op 仅 root 有效，非 root 提交会被静默忽略。**
5. **op 共 16 种**：照片 `upload` / `like` / `unlike` / `dislike` / `undislike` / `report` / `unreport` / `delete`（root）；公告（root）`ann_create` / `ann_update` / `ann_delete` / `ann_reorder`；`vote`；反馈 `fb_create` / `fb_delete`（root）；`react`。未知 op 静默丢弃；**逐 op 异常隔离**（单 op 抛异常不中断同批其余 op）。
6. SHA 撞车保留先到者的 uploader 与时间戳；`upload` op 的 `created_at` 取服务端接收时刻，payload 不带该字段。
7. `ann_delete` 级联删 reactions + votes；photos 无外键、不级联。`ann_reorder` payload 是**全量 id 序列**（先数值清洗再重排 sort 为 0…n-1，重放安全）。
8. 响应**全量下发**：无聚合、无版本、无增量；`feedback` 仅 root 非空；uuid 永不进响应。
9. 同步触发点 5 个：Turnstile 通过后 / 打开站点 / 离开标签页（`visibilitychange→hidden` 或 `pagehide`）/ op-log 满 256 / 手动。**满 256 自动同步但不禁止操作**。`visibilitychange` 走普通 awaited /sync，`pagehide` 才走 `keepalive`。
10. **keepalive 有 64KB 硬限**：先用 `TextEncoder` 计量，超限就按序截取能装下的最长前缀单独发出、其余留队列，收到响应只移除已发出的前缀（op 幂等 + 按序应用，部分提交安全）；单条 op 自身超 64KB 则放弃并 `console.warn`，不得丢 op。
11. **`postSync` 必须带 15s 超时**。后端挂掉时连接不会被拒绝（dev proxy 会一直持着），无超时的 fetch 永不 settle → `engine.syncing` 恒 true、所有写操作卡死。
12. `/upload` **校验顺序固定 Cookie → Content-Type**；上游语义写死：**fetch 本身异常 → 502 `image_host_unreachable`**，上游 4xx/5xx **原样透传**。请求体流式透传（`duplex: 'half'`，保留 boundary），不缓冲不解析。
13. **图床地址不离开 Worker**：`/l/:id36` 流式转发 + 长缓存（immutable），响应与元信息里都不得出现图床 URL。
14. **站内加载直连图床 URL**（不过 Worker），这依赖「图床只在 PUT/POST 路径限跨域、GET 不受限」——zip 打包与 fetch 下载都建立在这条上。仅 `/l/:id36` 供站外分享。
15. 存储层 snake_case / API 边界 camelCase，转换只在序列化层。
16. `/admin` 与 `/admin/migrate` **由 Worker 强制鉴权**，非 root（含未登录）一律自定义 404，不暴露端点存在性。前端 `isRoot` 判定只管界面态。
17. SQL 导入是**改名交换法**：`RENAME TO x_old` → 重放 schema → 分块导入 → 成功才 DROP `x_old`；失败逐句定位并**只对已存在 x_old 副本的表**回滚。崩溃时 `x_old` 仍在库中，不存在全量丢失窗口。
18. 端点只有六个：`POST /sync`、`POST /upload`、`GET /l/:id36`、`GET /admin`、`GET|POST /admin/migrate`、`GET /*`（ASSETS → SPA fallback）。`/sync`、`/upload` 的未捕获异常一律 JSON `{ ok:false, error:'internal' }`，HTML 错误页只用于页面类路由。
19. `dist/` 不提交，由工作流 `web/` 内 build 后部署；测试部署用官方 always-pass 站 key `1x00000000000000000000AA`。

## 前端

20. **全站零 shadcn / 零 bits-ui，组件全自研**（`web/src/lib/components/custom/`）。曾经生成过 shadcn 脚手架，已删除，不要重新引入。
21. 常暗主题（根挂 `dark`，不做切换）；令牌是 **v1 蓝黑阶梯** `#0a0e1a / #0f1524 / #151c2e / #1a2238 / #1e2640`，主色 `#22d3ee`，圆角 12px（卡片与预览媒体 14px）。「中性近黑」方案作废。
22. **无页面级漫开光晕**；**渐变只剩两处**（空态插图、品牌标识）；**只有弹层有阴影**（`--shadow-sm/md/lg` 三档），卡片与按钮不设阴影。错误页 glitch 是光效的唯一例外，且禁用 box-shadow / drop-shadow / filter glow。
23. 动效走令牌且**非对称**（进场 280ms 长、出场 160ms 短）；**拖动路径上零 transition**（填充条、滑块柄），否则视觉滞后。
24. 顶栏用 `fixed` 不用 `sticky`（iOS Safari 上 sticky + backdrop-filter 有已知 bug）。
25. 侧边栏（`OverlaySidebar`）：遮罩 `inset-0` **含顶栏**（打开时顶栏不可点）；**滚动容器不得有 `padding-bottom`**——否则 `sticky bottom-0` 会停在它上方 16px、内容从缝里露出；内缘可拖宽 280–720px 并持久化到 `localStorage`。
26. 公告侧栏：**默认全部收起**；折叠用 `grid-template-rows: 0fr↔1fr`（**内容保持挂载**，否则 MarkdownView 重挂、投票与反应状态丢失）；sticky 反馈区必须 `z-20` 且**其内部投票按钮要 `isolate`**（按钮内 `relative z-10` 会逃到外层堆叠上下文压过来，真出过穿模）。
27. 框选：需要 `<img draggable="false">` **且**容器 `ondragstart` 阻止默认，否则浏览器原生拖图抢走 pointer 手势。
28. 滑块（`RangeSlider` / `SingleSlider`）：真实 DOM 柄 + 指针事件（**不用 `input[type=range]`**）；内部状态是 [0,1] 归一化浮点，**只在映射业务值真变化时才 emit**（拖动一次让上层重算上百次 = 瀑布流重排 = 卡死）；气泡**尖端永远钉在柄中心**，位置按轨道实时宽度 + 气泡 `bind:clientWidth` 实测宽度算（拿 `ch` 估半宽会在端点错位）。
29. Lightbox **不用 Dialog**（焦点陷阱 + `inert` 干扰手势冒泡）；媒体定尺**必须留四周余量**（窄屏不得顶满）；键盘 `←/→` 是标记并自动下一张（与滑动手势同源），**菜单打开时方向键与 Esc 只收菜单、其余键一并吞掉**；喜欢/不喜欢**互斥**（`store.toggleMark` 层，发两条 op），请求删除不参与互斥。
30. 多选：**没有「取消选择」按钮**（退出只走顶栏图标），**取消全选不退出多选模式**；长按 500ms 进入。
31. 排序胶囊：方向**按项独立记忆**，切走再切回不丢；**未激活项也要显示自己记忆的方向**（否则切出瞬间回落默认文案）。
32. Toast 在**左下角**、`theme="dark"`、配色走 `toastOptions.style` 内联（能压过 sonner 的两级属性选择器；`theme` 默认是 `light`，常暗站点不改会弹白卡）。
33. **前端不得据 Cookie 判断是否已认证**（HttpOnly 读不到）——永远先探测 `/sync`。Turnstile widget 必须先 `turnstile.remove(id)` 再摘容器，token 回来后延时约 800ms 销毁。
34. 上传管线：**SharedWorker 是硬前提，不做降级**；视频并发池**硬顶 2**，持令牌方每 5s 心跳、超 15s 强制回收（`pagehide` 不可靠，只靠租约兜底）；**转码失败不降级主线程**（会阻塞整页）。转码进度是右下角浮层，上传阶段走瀑布流内乐观条目 + 卡片"窗帘"遮罩。
