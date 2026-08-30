// /admin — phase-1 skeleton (spec: "管理面板").
// Non-root (or no identity) gets the custom 404 page.

import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { ROOT_ID, resolveUser } from '../identity.ts';
import { notFoundPage } from '../errors.ts';

const PLACEHOLDER = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>管理面板</title>
<link rel="preconnect" href="https://fonts.googleapis.cn" crossorigin>
<link href="https://fonts.googleapis.cn/css2?family=Space+Grotesk:wght@400;700&family=Inter:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet">
<style>
	:root { color-scheme: dark; }
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		min-height: 100vh; background: #0a0e1a; color: #e2e8f0;
		font-family: "Space Grotesk", "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif;
		display: flex; align-items: center; justify-content: center;
	}
	.panel {
		background: #131822; border: 1px solid #1e2640; border-radius: 10px;
		padding: 48px 56px; text-align: center; max-width: 420px;
	}
	h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.08em; }
	h1::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 999px; background: #22d3ee; margin-right: 10px; }
	p { margin-top: 14px; font-size: 13px; color: #7b85a0; line-height: 1.7; }
	a {
		display: inline-block; margin-top: 26px; padding: 9px 26px; border-radius: 999px;
		background: transparent; border: 1px solid #2a3550; color: #e2e8f0;
		font-size: 13px; text-decoration: none; transition: border-color 0.2s, color 0.2s;
	}
	a:hover { border-color: #22d3ee; color: #22d3ee; }
</style>
</head>
<body>
	<div class="panel">
		<h1>管理面板</h1>
		<p>公告管理、建议与数据导入导出将在下一阶段上线。</p>
		<a href="/">返回首页</a>
	</div>
</body>
</html>`;

export function adminHandler(env: AppEnv) {
	return async (c: Context): Promise<Response> => {
		const user = await resolveUser(env.db, c.req.header('cookie'));
		if (!user || user.id !== ROOT_ID) return notFoundPage();
		return new Response(PLACEHOLDER, {
			headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
		});
	};
}
