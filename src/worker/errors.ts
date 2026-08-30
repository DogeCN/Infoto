// Custom error pages (spec: "错误页") — dark background #0a0e1a,
// large cyan #22d3ee status code, link back home.

function page(code: number, title: string, message: string): Response {
	const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${code} · Infoto</title>
<link rel="preconnect" href="https://fonts.googleapis.cn" crossorigin>
<link href="https://fonts.googleapis.cn/css2?family=Space+Grotesk:wght@400;700&family=Inter:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet">
<style>
	:root { color-scheme: dark; }
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body { height: 100%; }
	body {
		background: #0a0e1a;
		color: #e2e8f0;
		font-family: "Space Grotesk", "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif;
		display: flex; align-items: center; justify-content: center;
		overflow: hidden; position: relative;
	}
	body::before {
		content: ""; position: absolute; inset: 0; pointer-events: none;
		background:
			radial-gradient(600px 320px at 50% 30%, rgba(34,211,238,0.07), transparent 70%),
			repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.012) 2px 4px);
	}
	.box { text-align: center; padding: 32px; position: relative; }
	.code {
		font-size: clamp(96px, 24vw, 200px);
		font-weight: 700; line-height: 1; letter-spacing: 0.02em;
		color: #22d3ee;
		text-shadow: 0 0 40px rgba(34,211,238,0.2);
		animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.title {
		margin-top: 16px; font-size: 15px; font-weight: 600;
		letter-spacing: 0.35em; text-transform: uppercase; color: #e2e8f0;
		animation: rise 0.6s 0.08s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.msg {
		margin-top: 10px; font-size: 13px; color: #7b85a0;
		animation: rise 0.6s 0.14s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	a.home {
		display: inline-block; margin-top: 28px; padding: 10px 28px;
		border-radius: 999px; background: #22d3ee; color: #0a0e1a;
		font-size: 14px; font-weight: 600; text-decoration: none;
		transition: box-shadow 0.2s, transform 0.2s;
		animation: rise 0.6s 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	a.home:hover { box-shadow: 0 0 20px rgba(34,211,238,0.35); transform: translateY(-1px); }
	@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
	<div class="box">
		<div class="code">${code}</div>
		<div class="title">${title}</div>
		<div class="msg">${message}</div>
		<a class="home" href="/">返回首页</a>
	</div>
</body>
</html>`;
	return new Response(html, {
		status: code,
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}

export const notFoundPage = (): Response => page(404, 'Not Found', '页面不存在或已被移除');

export const serverErrorPage = (): Response => page(500, 'Server Error', '服务端开了个小差，稍后再试');
