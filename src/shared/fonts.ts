// Load the application fonts from one stylesheet with a system-font fallback.

/** Google Fonts CSS host, China endpoint. */
export const FONT_CSS_HOST = 'https://fonts.googleapis.cn';
/** Font files referenced by that stylesheet. */
export const FONT_FILE_HOST = 'https://fonts.gstatic.cn';

/** SPA families: Inter and Noto Sans SC, weights 400–700. */
export const APP_FONT_QUERY =
  'family=Inter:wght@400..700&family=Noto+Sans+SC:wght@400..700&display=swap';
/**
 * Error-page families. Space Grotesk is the display face and carries every weight the
 * page chrome asks for (400 body, 600–700 headings). Inter is loaded for one reason only:
 * the glitch glyph's own `font-family`, at the 700 the glyph declares. Shipping a weight
 * the page never asks for is how the glyph ended up rendering in synthetic bold here while
 * the SPA, which loads Inter 400–700, rendered it for real.
 */
export const ERROR_FONT_QUERY =
  'family=Space+Grotesk:wght@400;700&family=Inter:wght@400;700&family=Noto+Sans+SC:wght@400;500&display=swap';

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

/** CSP for an error page that loads only the configured font assets. */
export function fontPageCsp(): string {
  return `default-src 'none'; style-src 'unsafe-inline' ${FONT_CSS_HOST}; font-src ${FONT_FILE_HOST}; connect-src ${FONT_CSS_HOST} ${FONT_FILE_HOST}`;
}
