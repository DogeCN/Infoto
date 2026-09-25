// 本地开发示例公告：向 wrangler dev 的 /sync 灌入一批覆盖各类 Markdown 控件
// 与投票（:::vote）的测试公告。
// 用法：node scripts/seed-announcements.mjs [--origin http://127.0.0.1:8787] [--uuid <uuid>] [--reset]
//
// 注意：ann_create / ann_delete 是 **root 专属**（id=0，即本库第一个身份）。
// 本地库刚 reset 后跑的 `npm run seed:local` 建的就是 root；若当前的 uuid 非 root，
// 这些 op 会被服务端静默忽略 —— 脚本会检查 selfId 并明确提示。

const args = process.argv.slice(2);
const argOf = (name, fallback = '') => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const ORIGIN = argOf('origin', 'http://127.0.0.1:8787');
const UUID = argOf('uuid', '');
const RESET = hasFlag('reset');
const DUMMY_TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX';

// ---------------------------------------------------------------- 公告内容

/** A. Markdown 控件全览（标题/列表/引用/表格/代码块/分隔线/行内元素/链接） */
const ANN_MARKDOWN = `# 一级标题 · Infoto v2 公告区

这一段用来验证正文排版：中文断行、段落间距、**粗体**、*斜体*、~~删除线~~、\`行内代码\`，
以及自动识别链接 https://www.cloudflare.com 。

## 二级标题 · 列表

- 无序列表项 A
- 无序列表项 B
  - 嵌套子项 B-1
  - 嵌套子项 B-2
- 无序列表项 C

1. 有序列表项一
2. 有序列表项二
3. 有序列表项三

> 引用块：用于提示、免责声明或引用他人内容。
> 第二行验证换行与左边框。

### 三级标题 · 表格

| 控件 | 语法 | 状态 |
| --- | --- | --- |
| 表格 | 竖线分隔 | 支持 |
| 代码块 | 三个反引号 | 支持 |
| 删除线 | 双波浪号 | 支持 |

---

\`\`\`ts
// 所有写操作都走 op-log → /sync 单入口
await fetch('/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ops }),
});
\`\`\`

最后一行：验证 \`inline code\` 与正文混排的基线对齐。`;

/** B. 快捷键与手势速查（表格为主） */
const ANN_KEYS = `以下操作在卡片预览（Lightbox）里生效。

| 操作 | 鼠标 / 触摸 | 键盘 |
| --- | --- | --- |
| 喜欢 | 左滑 | ← |
| 不喜欢 | 右滑 | → |
| 下载 | 下滑 | ↓ |
| 更多菜单 | 上滑 | ↑ |
| 上一张 / 下一张 | 底部箭头 | PageUp / PageDown |
| 关闭 | 点右上角 ✕ | Esc |
| 缩放 | 双击 / Ctrl+滚轮 / 双指捏合 | 双击 Ctrl 复原 |
| 音量 | 右下角喇叭 | 空格 |

> 标记后会自动跳到下一张，连续刷图时不用再动鼠标。

瀑布流里：

- **单击**卡片 → 打开预览
- **多选模式**下拖动 → 框选一批
- 顶栏多选图标 → 进入 / 退出多选`;

/** C. 单选投票（4 个选项）+ 说明正文 */
const ANN_VOTE_THEME = `界面配色你想往哪边走？选一个，投票结果会实时显示。

:::vote 深色青（当前） | 纯黑极简 | 浅色护眼 | 跟随系统`;

/** D. 单选投票（5 个选项）+ 富文本说明 */
const ANN_VOTE_NEXT = `下一版你更在意哪一块？

- **浏览体验**：瀑布流布局、手势、缩放
- **整理能力**：筛选、排序、批量操作
- **上传链路**：转码速度、进度反馈
- **社区**：标记、请求删除、公告

:::vote 浏览体验 | 整理能力 | 上传链路 | 社区公告 | 都想要`;

/** E. 只有投票、没有正文（验证空正文分支） */
const ANN_VOTE_MIN = `:::vote 现在就好用 | 还能更好 | 有明确的坑`;

/** F. 反馈与版本信息（链接/引用/代码/分隔线） */
const ANN_ABOUT = `## 关于反馈

公告区底部的输入框支持 **Markdown 实时预览**，写完点「发送」即可。
反馈只有管理员能看到，不会公开展示。

> 反馈内容请尽量带上：做了什么 → 期望什么 → 实际什么。

### 版本信息

\`\`\`text
前端：Svelte 5 + Vite + Tailwind v4
后端：Cloudflare Workers + D1
同步：单入口 POST /sync（op-log 顺序应用）
\`\`\`

- 项目地址：https://github.com/
- 字体：Inter / Noto Sans SC

---

祝使用愉快。`;

const ANNOUNCEMENTS = [
	{ title: 'Infoto v2 测试公告 · Markdown 全览', contentMd: ANN_MARKDOWN },
	{ title: '快捷键与手势速查', contentMd: ANN_KEYS },
	{ title: '投票 · 界面配色怎么走？', contentMd: ANN_VOTE_THEME },
	{ title: '投票 · 下一版优先做哪块？', contentMd: ANN_VOTE_NEXT },
	{ title: '投票 · 只剩选项的极简公告', contentMd: ANN_VOTE_MIN },
	{ title: '关于反馈与版本信息', contentMd: ANN_ABOUT },
];

// ---------------------------------------------------------------- 传输

let cookie = UUID ? `uuid=${UUID}` : '';

async function bootstrap() {
	if (cookie) return;
	const res = await fetch(`${ORIGIN}/sync`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ turnstileToken: DUMMY_TURNSTILE, ops: [] }),
	});
	const setCookies = res.headers.getSetCookie?.() ?? [];
	const uuidCookie = setCookies.find((c) => c.startsWith('uuid='));
	if (!res.ok || !uuidCookie) {
		throw new Error(`identity bootstrap failed: ${res.status} ${await res.text()}`);
	}
	cookie = uuidCookie.split(';')[0];
	console.log(`identity: ${cookie}`);
}

async function sync(ops) {
	await bootstrap();
	const res = await fetch(`${ORIGIN}/sync`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Cookie: cookie },
		body: JSON.stringify({ ops }),
	});
	if (!res.ok) throw new Error(`/sync ${res.status}: ${await res.text()}`);
	return res.json();
}

// ---------------------------------------------------------------- 主流程

const probe = await sync([]);
if (probe.selfId !== 0) {
	console.warn(
		`\n⚠️  当前身份 selfId=${probe.selfId}（非 root）。ann_create 只会被静默忽略。\n` +
			`   处理：改用 root 的 uuid（本库第一个身份）传 --uuid，或先 npm run db:reset && npm run seed:local。\n`,
	);
}

if (RESET) {
	const existing = probe.announcements ?? [];
	if (existing.length > 0) {
		await sync(existing.map((a) => ({ type: 'ann_delete', target: a.id })));
		console.log(`cleared ${existing.length} announcement(s)`);
	}
}

const ops = ANNOUNCEMENTS.map((a) => ({ type: 'ann_create', payload: a }));
const after = await sync(ops);
const list = after.announcements ?? [];

console.log(`created ${ops.length} announcement(s) → now ${list.length} total`);
for (const a of list) {
	const vote = (a.contentMd.split(/\r?\n/).find((l) => l.trim().startsWith(':::vote')) ?? '')
		.replace(':::vote', '')
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean);
	console.log(
		`  #${a.id} sort=${a.sort} ${a.title}${vote.length ? `  [投票 ${vote.length} 项: ${vote.join(' / ')}]` : ''}`,
	);
}
