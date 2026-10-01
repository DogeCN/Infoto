// Web fonts. A single official stylesheet; `display=swap` keeps text readable with the
// system fallback while it loads.

/** Official Google Fonts CSS host. */
export const FONT_CSS_HOST = 'https://fonts.googleapis.com';
/** Font files referenced by the official stylesheet. */
export const FONT_FILE_HOST = 'https://fonts.gstatic.com';

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
