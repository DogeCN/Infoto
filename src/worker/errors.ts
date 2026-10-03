import {
  acceptLanguages,
  locales,
  pickLocale,
  type Copy,
  type LocaleCode,
} from '../shared/copy.ts';
import { ERROR_FONT_QUERY, fontHeadBlock, fontPageCsp } from '../shared/fonts.ts';
import { GLITCH_CSS, GLITCH_PALETTE } from '../shared/glitch.ts';

// Error pages: the shared glitch glyph on a dark ground. The glyph's colours, layer stack
// and keyframes come from `shared/glitch.ts` — the same definition the SPA's `GlitchText`
// injects — so the two surfaces cannot drift apart. Only the page chrome below is local.
//
// What stays SPA-only: the scramble-on-mount, the random idle burst and the hover trigger.
// All three need JavaScript, and this page must ship without a `<script>` at all.

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

/** Resolve each request's locale from Accept-Language, defaulting to English. */
function localeFor(request: Request | undefined): { code: LocaleCode; copy: Copy } {
  const code = pickLocale(acceptLanguages(request?.headers.get('Accept-Language')));
  return { code, copy: locales[code] };
}

function page(
  code: number,
  title: string,
  message: string,
  lang: LocaleCode,
  back: string,
): Response {
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${code} · Infoto</title>
${fontHeadBlock(ERROR_FONT_QUERY)}
<style>
	${GLITCH_CSS}
	:root { color-scheme: dark; --color-background: ${GLITCH_PALETTE.background}; --color-foreground: ${GLITCH_PALETTE.foreground}; --color-muted-foreground: ${GLITCH_PALETTE.muted}; --color-primary: ${GLITCH_PALETTE.primary}; }
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body { height: 100%; }
	body {
		background: var(--color-background);
		color: var(--color-foreground);
		font-family: "Space Grotesk", "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif;
		display: flex; align-items: center; justify-content: center;
		overflow: hidden;
	}
	.box { text-align: center; padding: 32px; }
	/* The entrance rides the glyph container, not one layer, so the stack rises as a unit.
	   GLITCH_CSS deliberately ships no entrance: the SPA's half draws this with a scramble
	   instead, and a shared "rise" would fight it. This is page chrome, so it stays local.
	   The animation only isolates the blend group for its 0.6s; the "both" fill leaves
	   transform: none, which is not a stacking context, so the echoes screen against the
	   page background again once it finishes. */
	.gf {
		font-size: clamp(96px, 24vw, 200px);
		animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.title {
		margin-top: 16px; font-size: 15px; font-weight: 600;
		letter-spacing: 0.35em; text-transform: uppercase; color: var(--color-foreground);
		animation: rise 0.6s 0.08s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.msg {
		margin-top: 10px; font-size: 13px; color: var(--color-muted-foreground);
		animation: rise 0.6s 0.14s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	a.home {
		display: inline-block; margin-top: 28px; padding: 10px 28px;
		border-radius: 999px; background: var(--color-primary); color: var(--color-background);
		font-size: 14px; font-weight: 600; text-decoration: none;
		transition: transform 0.2s;
		animation: rise 0.6s 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	a.home:hover { transform: translateY(-1px); }
	@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
	@media (prefers-reduced-motion: reduce) {
		.gf, .title, .msg, a.home { animation: none; }
	}
</style>
</head>
<body>
	<div class="box">
		<div class="gf" role="img" aria-label="${code}"><span class="gf-layer gf-main">${code}</span><span class="gf-layer gf-echo gf-echo-a">${code}</span><span class="gf-layer gf-echo gf-echo-b">${code}</span></div>
		<div class="title">${escapeHtml(title)}</div>
		<div class="msg">${escapeHtml(message)}</div>
		<a class="home" href="/">${escapeHtml(back)}</a>
	</div>
</body>
</html>`;
  return new Response(html, {
    status: code,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Language': lang,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': fontPageCsp(),
    },
  });
}

export const notFoundPage = (request?: Request): Response => {
  const { code, copy } = localeFor(request);
  return page(
    404,
    copy.errorPage.notFoundTitle,
    copy.errorPage.workerNotFoundMessage,
    code,
    copy.errorPage.backHome,
  );
};

export const serverErrorPage = (request?: Request): Response => {
  const { code, copy } = localeFor(request);
  return page(
    500,
    copy.errorPage.serverErrorTitle,
    copy.errorPage.workerServerError,
    code,
    copy.errorPage.backHome,
  );
};
