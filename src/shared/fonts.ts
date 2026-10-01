// Web fonts. A single stylesheet; `display=swap` keeps text readable with the system fallback
// while it loads.
//
// Google publishes a `.cn` endpoint for the same API, and it is the one worth using here. The
// stylesheet is a small part of the cost; the family resolves to 108 woff2 files of which 101
// are Noto Sans SC unicode-range subsets, and those are what a page actually waits on. Measured
// over 14 of those subsets, the `.cn` file host returned them in 45s with no failures against
// 102s and two failures for the global host. This is Google's own China domain rather than a
// third-party mirror, so it stays a single source and the CSP gains no extra host.

/** Google Fonts CSS host, China endpoint. */
export const FONT_CSS_HOST = 'https://fonts.googleapis.cn';
/** Font files referenced by that stylesheet. */
export const FONT_FILE_HOST = 'https://fonts.gstatic.cn';

/** SPA families: Inter and Noto Sans SC, weights 400–700. */
export const APP_FONT_QUERY =
  'family=Inter:wght@400..700&family=Noto+Sans+SC:wght@400..700&display=swap';
/** Error-page families, including the display face used only there. */
export const ERROR_FONT_QUERY =
  'family=Space+Grotesk:wght@400;700&family=Inter:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap';

export function fontStylesheetUrl(query: string): string {
  return `${FONT_CSS_HOST}/css2?${query}`;
}

function preconnectTags(): string {
  return [FONT_CSS_HOST, FONT_FILE_HOST]
    .map((href) => `<link rel="preconnect" href="${href}" crossorigin>`)
    .join('');
}

/** Preconnects plus the stylesheet link, substituted for the `fonts` marker. */
export function fontHeadBlock(query: string): string {
  return `${preconnectTags()}<link rel="stylesheet" href="${fontStylesheetUrl(query)}">`;
}

export function injectFonts(html: string): string {
  const block = fontHeadBlock(APP_FONT_QUERY);
  if (html.includes('<!-- fonts -->')) return html.replace('<!-- fonts -->', block);
  return html.replace('</head>', `${block}</head>`);
}

/** CSP for a page whose only external assets are these font sources. There is no script,
 *  so `script-src` is left off entirely rather than opened with 'unsafe-inline'. */
export function fontPageCsp(): string {
  return `default-src 'none'; style-src 'unsafe-inline' ${FONT_CSS_HOST}; font-src ${FONT_FILE_HOST}; connect-src ${FONT_CSS_HOST} ${FONT_FILE_HOST}`;
}
