# 契约修订方案（反馈轮 1–9 汇总）

> 用途：把本轮前端反馈期间**实际落地的实现**与 `.ai/00-contracts.md` 的差异一次列清，供逐条裁决后回写契约。
> 每条格式：**契约原文 → 现状 → 建议措辞（含原因）**。
> 分类：**A 需改契约**（实现是有意的，契约跟上）· **B 挂账**（契约有、实现无）· **C 结构性失效** · **D 新增约定**（本轮踩坑沉淀）。

---

## A. 需改契约

### A1 主题令牌（视觉风格 › 主题令牌）

| Token | 契约 | 实现 | 说明 |
|---|---|---|---|
| `--background` | `#0a0e1a` | 同 | — |
| `--foreground` | `#e2e8f0` | 同 | — |
| `--muted-foreground` | `#7b85a0` | 同 | — |
| `--card` | `#131822` | **`#0f1524`** | 回退 v1 蓝黑阶梯 |
| `--popover` | `#1a212e` | **`#151c2e`** | 同上 |
| `--surface-top` | `#242d47` | **`#1a2238`** | 同上 |
| `--primary-foreground` | `#0a0e1a` | **`#042f2e`** | 主题色上的文字用深青更稳 |
| `--radius` | `10px` | **`12px`** | 卡片与 Lightbox 媒体另用 14px |
| 缺失 | — | **`--muted` / `--secondary(+fg)` / `--input`** | 实现已在用（`#151c2e` / `#151c2e` / `#1e2640`） |

建议：整表按上表替换；补一句「卡片与 Lightbox 媒体统一 14px 圆角，其余按 `--radius` 派生」。「中性近黑」方案作废，一律以 v1 蓝黑阶梯为准（09-24 决策）。

### A2 字体
契约：`Space Grotesk → Inter → Noto Sans SC`，经 Google Fonts 国内镜像异步加载。
现状：仅 `"Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif`（`app.css` body）。
建议：删掉 Space Grotesk（字重与中文回退都更简单）。

### A3 光效纪律
契约：全站无任何发光、光晕、外晕效果。
现状 / 决策（09-24）：**禁页面级漫开光晕**；控件内部的动态光效（inset 高光、进度填充、滑块柄 `shadow-primary/40`）允许；错误页 glitch 例外不变。
建议：按此措辞改。

### A4 渐变白名单
契约三处：① 照片卡片信息底栏黑色遮罩 ② 空态插图 ③ 品牌标识。
现状：**① 已删除**（卡片改叠图 pill 徽章）；新增 ④ 滑块填充条 `bg-gradient-to-r from-primary/70 to-primary`（双柄与单柄共用）。
建议：白名单 = 空态插图、品牌标识、滑块填充条。

### A5 动效令牌（新增小节）
```css
--ease-enter: cubic-bezier(0.2, 0, 0, 1);      /* 进场 */
--ease-exit: cubic-bezier(0.3, 0, 0.8, 0.15);  /* 出场，比进场短 */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--duration-enter: 280ms; --duration-exit: 160ms; --duration-spring: 420ms;
```
规则：非对称时序（进场长、出场短）；**拖动路径上零 transition**（填充条、滑块柄），否则拖动视觉滞后。

### A6 阴影
契约：轻弹层 `0 4px 12px rgba(0,0,0,.4)`；重弹层 `0 20px 50px rgba(0,0,0,.6)`。
现状：令牌化了三档 —— `--shadow-sm 0 1px 2px /.25`、`--shadow-md 0 4px 12px /.4`、`--shadow-lg 0 20px 50px /.6`；Toast 与 ActionSheet 用 `--shadow-lg`。
建议：按三档令牌表述。

### A7 组件选型表 —— 整表重写（重要）
现状：`web/src/lib/components/ui/` 下 **25 个 shadcn 组件零引用**，全部界面由 `custom/` 自实现。

| 功能 | 契约写的 | 实际实现 |
|---|---|---|
| 侧边栏 | `OverlaySidebar` | 一致 |
| Toast | sonner（dark） | sonner + 自定义位置/配色（见 A8） |
| 排序分段选择器 | `Tabs` | **`SortTabs.svelte`**（滑动指示 pill，原生 `title` 代替 Tooltip） |
| 双柄 / 单柄滑块 | `Slider` | **`RangeSlider` / `SingleSlider`**（原生 `input[type=range]` 叠加） |
| 归属 / 类型 / 布局开关 | `Toggle` / `ToggleGroup` | **`TriStateToggle` + 普通 `<button>`** |
| 筛选 / 布局 / 公告标题折叠 | `Collapsible` | 设置区**不折叠**；公告区 `h3 > button` + `grid-template-rows` 动画 |
| 反馈输入 | `Textarea` + `Button` | 原生 `textarea` + `button` |
| 上传/转码进度 | `Progress` | 自绘进度条 |
| 角标 | `Badge` | 自绘 pill |
| 空态 / 加载中 | `Empty` / `Spinner` | 自绘 SVG + lucide `LoaderCircle` |
| 图标 | `@lucide/svelte` | 一致 |

建议：删掉「shadcn 组件名」这一列，组件选型以「项目内自定义组件清单」为唯一依据（该清单已是准确现状）。

### A8 Toast
契约：轻弹层阴影 + dark 主题。
现状：`position="bottom-left"`（**左下角，避免遮挡预览图片主体**）、`offset={{ bottom: '1rem', left: '1rem' }}`、`theme="dark"`、`richColors`；表面/描边/圆角/字体/阴影通过 `toastOptions.style` **内联**覆盖（内联才能压过 sonner 的 `[data-sonner-toaster][data-sonner-theme]` 两级属性选择器）；宽度 `min(20rem, calc(100vw - 2rem))`。
建议：写进契约，并注明「sonner 的 `theme` 默认 `light`，常暗站点必须显式 `dark`」。

### A9 顶栏图标按钮
契约：统一 `Button variant="ghost" size="icon"`。
现状：原生 `<button>` + Tailwind（`rounded-md p-2 text-muted-foreground hover:bg-card hover:text-foreground`，高亮态 `text-primary`）。
建议：措辞改为描述类名（与 A7 同源）。

### A10 排序胶囊行为
契约：仅「再次单击切反向」。
现状：① 方向**按项独立记忆**（`latestAsc` / `hottestAsc`），切走再切回不丢；② 未激活项也显示**自己记忆的方向文案**（最旧 / 最冷）——否则切出瞬间回落默认文案；③ 激活项有滑动指示 pill；宽度不足时只留图标（`hidden sm:inline`）。
建议：补这三条。

### A11 侧边栏
1. **遮罩全屏含顶栏**。契约原写「遮罩自顶栏下沿起，顶栏保持可见可点」；实现是 `fixed inset-0 z-[47] bg-black/50 backdrop-blur-sm`，侧栏 `z-50` —— 打开时整体压暗，顶栏不再可点（换取视觉统一）。
2. **滚动容器不得带底部 padding**。现状 `min-h-0 flex-1 overflow-y-auto px-4 pt-4`，底部留白由各面板自理（设置面板根 `pb-4`、公告 sticky 底栏自身 `pb-4`）。原因：滚动容器的 `padding-bottom` 会让 `sticky bottom-0` 停在它上方 16px，**滚动内容从那条缝里露出来**。

### A12 瀑布流参数
目标带宽默认 320 → **260**；间距默认 8 → **12**（范围 200–800 / 0–32 不变）。缩放 50%–200%（作用于目标带宽）实现与契约一致，不变。

### A13 照片卡片
契约：底部黑色渐变遮罩 + 左下线条图标计数。
现状：**无渐变**；标记改为叠图 pill（`rounded-full bg-black/55 backdrop-blur-sm px-2 py-0.5`，计数为 0 整项隐藏）；自标记项图标与文字实心高亮（喜欢 `#f43f5e` / 不喜欢 `#3b82f6` / 请求删除 `amber-400`）；卡片 `rounded-[14px] border border-white/0`，hover 才亮 hairline（`hover:border-white/10`）；选中态 `border-2 border-primary` + 右上圆形对勾徽章（非 `Checkbox`）；`<img draggable="false">`。
建议：按现状改。

### A14 多选
契约：左全选 / 中计数+总大小 / 右下下载、取消标记、root 删除。
现状：左 = 全选 + 计数；右 = 下载 + 总大小、取消标记（`Undo2`，选中项无标记时置灰）、（root）删除。**「取消选择」X 已删**——退出多选只走顶栏图标；**取消全选不退出多选模式**；框选可在卡片上起始，容器 `onclickcapture` 抑制框选后的误点选；长按 500ms 进多选保持。
建议：按现状改。

### A15 卡片预览（Lightbox）
1. **顶/底栏去毛玻璃**：裸文字 + `text-shadow: 0 1px 6px rgba(0,0,0,.8)`。左上 = `当前/总数` + 三枚**可点**标记 pill（与手势、键盘同源 `toggleLike/toggleDislike/toggleReport`）；右上 = `⋯` / `✕`（`size-11`，图标 `size-6`）；左下 = 两行「宽×高 大小 / 日期」（无 `·` 分隔）；右下 = `‹ ›`。
2. **媒体定尺**：`max-width: calc(100vw - 2.5rem)`（md `- 8rem`）、`max-height: calc(100dvh - 8rem)`（md `- 9rem`）、`rounded-[14px]`。原因：原 `max-w-full` 相对的是宽度不确定的 flex 容器，窄屏下退化成「按原始像素溢出」，直接顶满整屏。
3. **更多菜单**：**无拖拽条**（拖动关闭整条砍掉，与面板内按钮争指针且 inline transform 压过 `transition:fly`）；**无「取消标记」、无「取消」**；条目 = 复制原图 / 复制链接 / 分享 / 谷歌搜图（主色）/ 请求删除（琥珀，已请求则「取消删除」）/ 下载（`text-success`）/（root）删除。
4. **单击屏幕左右半区切页已砍**（用户确认），切页由底栏 `‹ ›` 与 PgUp/PgDn 承担。
5. **键盘**：`←/→` = 标记（与滑动手势同源，标记后自动下一张）；`↑` 开菜单；`↓` 下载；空格静音；Ctrl 复原；Esc 关菜单 / 关闭；**菜单打开时方向键与 Esc 只收菜单，其余键一并吞掉**。
6. **喜欢 / 不喜欢互斥**（`store.toggleMark` 层实现，标记其一自动撤销另一个，发两条 op）；请求删除不参与互斥。标记态：自标记 = 实心（pill 填色 + 图标 `fill-current`），未标记 = 空心描边。

### A16 公告侧边栏
契约：`Card` + `CardHeader` + `Collapsible` 展开收起。
现状：
1. **默认全部收起**；标题行 = `h3 > button[aria-expanded]` 整行可点，右侧 `ChevronDown` 旋转指示；内容用 `grid-template-rows: 0fr ↔ 1fr` 过渡（内容保持挂载，`MarkdownView` 不重挂、投票与反应状态不丢），内层 `min-h-0 overflow-hidden` 是 0fr 能压扁的前提。
2. 反馈区 sticky `bottom-0 z-20 bg-card pb-4 pt-4` —— **`z-20` 是必须的**：卡片内部可能出现带 `z-index` 的内层，sticky 底栏得稳压它们；背景用 `--card`（与侧栏同色，避免比内容区亮出一圈）。
3. `textarea` 去原生 `resize`，右上角自实现 `ChevronsUpDown` 把手（向上拖增高，120–480px）；右上 Eye/Pencil 二态预览按钮；发送按钮为右下角 pill，有文本才显示。
4. 投票按钮加 `isolate`：内部 `relative z-10` 在 `relative` + `z-index:auto` 的父级下会**逃到外层堆叠上下文**，压过 sticky 反馈框（真出过穿模）。

### A17 设置侧边栏
契约：筛选 / 布局两个 `Collapsible`（筛选默认展开、布局默认折叠、状态持久化）+ 底部「重置」。
现状：**两段平铺**（无折叠、无持久化），各自标题行右侧 `RotateCcw` 重置本区，无底部重置按钮；`settings.ts` 已删 `filtersOpen / layoutOpen`。
- **范围**：行式【图标 | 下限值 | 双柄 | 上限值】；**数值列按 `ch` 精确预留**（列宽 = 该行可能出现的最长格式化文本字符数；`font-mono text-xs` 必须挂在 grid 容器上，`ch` 取的是使用该属性的元素的字体）；**两端数值统一右对齐**；**无逐项重置图标**；尺寸项用 `compactSize()`（3 位有效数字，最长 7 字符，精度略低于 `humanSize`）。
- **归属**：4 项 `TriStateToggle` 2×2（三态 未启用 → 仅含（青）→ 仅不含（`#f59e0b`））。
- **类型**：3 个按钮横排，至少保留一个（尝试取消唯一选中时静默忽略）。
- **布局**：滚动方向 / 填充策略 = 2×2 图标文字按钮（纵向 `ArrowDownToLine` / 横向 `ArrowRightToLine` / 顺序 `ListOrdered` / 最短 `AlignHorizontalDistributeCenter`）；带宽 = `SingleSlider`（`UnfoldHorizontal`，200–800，默认 260）；间距 = `SingleSlider`（`MoveHorizontal`，0–32，默认 12）；非默认值时图标与数值转 `primary`。
- 间距节奏：根 `space-y-6 pb-4`，筛选区 `mt-4 space-y-5`、行间 `space-y-3.5`。

---

## B. 挂账（契约有、实现无）

1. **管理面板整章未实现**：`/admin` 前端路由、公告编辑页、建议页、SQL 导入（改名交换法）、导入/导出图标、`ann_reorder` 拖动排序（FLIP）。Worker 侧 `ann_*` op 已可用（本轮用脚本灌过公告验证）。
2. **Markdown 编辑器**：`MarkdownEditor.svelte` 已写但**零引用**；工具栏、分屏预览、图片上传嵌入均未落地。
3. **文件大小滑块的对数刻度**未实现（当前线性按字节）。
4. **类型 Toggle 的「取消唯一选中 → shake + `--destructive` + Tooltip」**未实现（当前静默忽略）。
5. **范围项逐项重置图标**未实现（改为拖动柄回端点）。
6. 排序胶囊宽度不足时的 **Tooltip** 未实现（用原生 `title`）。
7. **空态插图渐变**未实现（当前是纯线条 SVG）。

---

## C. 结构性失效（已核实：shadcn 层基本不存在）

复核实测（09-25）：

| 项 | 实测结果 |
|---|---|
| `web/src/lib/components/ui/` | 25 个目录，**22 个是空目录**；只有 `badge`(2 文件) / `button`(2) / `card`(7) 有内容 |
| 引用情况 | 这三个也**零引用**：全站 `$lib/components/ui` 导入数 = 0 |
| 依赖 | `bits-ui` **未安装**（shadcn-svelte 的交互类组件全部建在它之上） |
| `components.json` | 仍指向 shadcn `new-york` + `zinc`，与实际脱节 |
| `cn()` / `tailwind-variants` | `$lib/utils` 在用，`clsx` / `tailwind-merge` / `tailwind-variants` 均已安装 |

结论：契约「组件选型」表里除 Button / Badge / Card 之外的**每一项**（Tabs、Slider、Toggle、ToggleGroup、
Collapsible、Tooltip、Popover、DropdownMenu、Dialog、Sheet、Checkbox、Progress、ScrollArea、Empty、
Spinner、Textarea、Input、Separator、Skeleton、Label、Sidebar、Sonner 包装）**一行都没落地**。
这不是「用了 shadcn 再改样式」，而是从来没有这一层。

### C1 三个选项（需拍板）

1. **保留现状**：删掉 `ui/` 与 `components.json`，契约明确「全部自定义组件，不引入 shadcn / bits-ui」。
   —— 默认推荐：现状已全绿，零新依赖、零回归风险。
2. **定向引入 bits-ui**：只把 `Slider`（双柄 / 单柄）换成 bits-ui 版本，删掉原生 range 叠加的整套 hack；
   其余不动。唯一有实质收益的迁移。
3. **全量引入**：装 `bits-ui`、按 shadcn 重新生成组件并逐个覆盖样式。成本最高，且会把已回归过的
   交互层（手势、框选、sticky、z-index）打回重测。

### C2 迁移摩擦评估（若走 2 / 3）

| 档 | 组件 | 摩擦点 |
|---|---|---|
| 零（纯 class 包装） | Card / Badge / Input / Label / Separator / Skeleton | 收益 ≈ 0，只是把十几行 div 换成一层文件 |
| 低 | Tooltip / Progress / ToggleGroup / Collapsible / Sonner | 换一层即可；但三态「仅不含」的琥珀态、公告折叠的「内容保持挂载」要自己补回（Collapsible 默认卸载内容，MarkdownView 会重挂） |
| 高（唯一真收益） | **Slider** | 需重写样式层（轨道 / 填充 / 柄 / 数值列）并搬回「按 step 采样定 ch 列宽」「双柄钳制与互斥」；换来 bits-ui 的多 thumb 键盘 a11y 与 Firefox 免特判 —— 性质是**重写**而非迁移 |
| 不建议 | Tabs（滑动指示器与「方向按项记忆」仍要自写）、Sheet（模态语义与宽度拖拽冲突）、Dialog（Lightbox 明令禁用）、Checkbox / ScrollArea / Empty / Spinner（形态或语义不匹配） | — |

**跨档的通用摩擦**：① 设计语言不一致 —— 站点是扁平 + hairline + 无阴影 + 非对称动效令牌，shadcn 默认带
`shadow-*` / 自带圆角体系 / `dark:` 变体，每个组件都要写覆盖，**代码净增**；② 行为定制在组件内部
（排序方向记忆、标记互斥、三态开关、「至少留一个类型」、手势与键盘同源），迁移后要么包一层 wrapper
再加回来，要么改调用方；③ 回归成本 —— 这些交互都经过实测验证（含 Firefox），重写等于重测。

---

## D. 新增约定（本轮踩坑沉淀，建议进契约）

1. **sticky 底栏**：滚动容器不得有 `padding-bottom`，底部留白由面板自理；否则 sticky 悬空 16px、内容从缝里露出。
2. **内层 z-index 逃逸**：`relative` + `z-index: auto` 的父级不自建堆叠上下文，内部 `z-10` 会压过 sticky 底栏 —— 需要时给父级 `isolate`。
3. **拖动路径零 transition**：填充条与滑块柄上加 transition 会让拖动视觉滞后（曾以为「滑块跟不上手」）。
4. **滑块数值列**：列宽按「控件**真正能产生的**取值集合」采样（必须按 `step` 对齐，否则会采出 `0.3333…px` 这种永远显示不出来的文本），用 `ch` + 等宽字体精确预留；两端数值统一右对齐。
5. **原生图片拖动**：`<img draggable="false">` **且**容器 `ondragstart={e => e.preventDefault()}`，否则浏览器原生拖动抢走框选手势。
6. **双柄滑块**：两条原生 range 叠放时 input 必须 `pointer-events: none`、thumb `pointer-events: auto`（Chromium 有效），**必须另写 `::-moz-range-thumb`**（Firefox 下既拖不动也画不出来）；整条轨道是死区，需自己在容器上做 pointerdown / move（按距离选柄 + `setPointerCapture`）。
7. **身份判定**：`uuid` cookie 为 HttpOnly，前端**不得**据此判断是否已认证，一律先探测 `/sync`（服务端是唯一权威）。Turnstile widget 必须先 `turnstile.remove(id)` 再摘容器，且 token 回来后延时约 800ms 销毁。
8. **本地数据**：`npm run db:reset` / `seed:local` / `seed:ann`；公告 `ann_create` 是 root（库内 id=0）专属，非 root 会被**静默忽略**。

---

## E. 建议落地顺序

1. **A1–A6**（令牌 / 字体 / 光效 / 渐变 / 动效 / 阴影）——纯文档替换，零风险。
2. **A7 + C**（组件选型与 `ui/` 目录去留）——需要拍板：删不删 shadcn 目录。
3. **A8–A17** 按界面回写（顶栏 → 侧边栏 → 瀑布流/卡片 → 多选 → Lightbox → 公告 → 设置）。
4. **B 挂账项**单独排期，管理面板是最大一块（连带 Markdown 编辑器与 `ann_reorder`）。
