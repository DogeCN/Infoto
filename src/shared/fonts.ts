// Web font hosts. The page races the official stylesheet against the USTC mirror and
// applies whichever returns first. Font files stay on the host named inside that CSS.

/** Official Google Fonts CSS host. */
export const OFFICIAL_FONT_CSS_HOST = 'https://fonts.googleapis.com';
/** USTCLUG reverse proxy for the official CSS host. */
export const USTC_FONT_CSS_HOST = 'https://fonts.proxy.ustclug.org';
/** Font files referenced by the official stylesheet. */
export const OFFICIAL_FONT_FILE_HOST = 'https://fonts.gstatic.com';
/** Font files referenced by the USTC stylesheet. */
export const USTC_FONT_FILE_HOST = 'https://fonts-gstatic.proxy.ustclug.org';

export const FONT_CSS_HOSTS = [OFFICIAL_FONT_CSS_HOST, USTC_FONT_CSS_HOST] as const;
export const FONT_FILE_HOSTS = [OFFICIAL_FONT_FILE_HOST, USTC_FONT_FILE_HOST] as const;

/** SPA families: Inter and Noto Sans SC, weights 400–700. */
export const APP_FONT_QUERY =
  'family=Inter:wght@400..700&family=Noto+Sans+SC:wght@400..700&display=swap';
/** Error-page families, including the display face used only there. */
export const ERROR_FONT_QUERY =
  'family=Space+Grotesk:wght@400;700&family=Inter:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap';

export function fontStylesheetUrls(query: string): string[] {
  return FONT_CSS_HOSTS.map((host) => `${host}/css2?${query}`);
}

function preconnectTags(): string {
  return [...FONT_CSS_HOSTS, ...FONT_FILE_HOSTS]
    .map((href) => `<link rel="preconnect" href="${href}" crossorigin>`)
    .join('');
}

/**
 * Both stylesheets download together. The first successful load is applied;
 * the other link is removed so its font files are not used.
 */
export function fontRaceScript(query: string): string {
  const urls = JSON.stringify(fontStylesheetUrls(query));
  return `(function(){var urls=${urls};var won=false;var links=[];function start(href){var link=document.createElement("link");link.rel="stylesheet";link.href=href;link.media="print";link.onload=function(){if(won){link.remove();return;}won=true;link.media="all";for(var i=0;i<links.length;i++)if(links[i]!==link)links[i].remove();};link.onerror=function(){link.remove();};document.head.appendChild(link);links.push(link);}for(var i=0;i<urls.length;i++)start(urls[i]);})();`;
}

/** Preconnects plus the race script, substituted for the `font-race` marker. */
export function fontHeadBlock(query: string): string {
  return `${preconnectTags()}<script>${fontRaceScript(query)}</script>`;
}

export function injectFontRace(html: string): string {
  const block = fontHeadBlock(APP_FONT_QUERY);
  if (html.includes('<!-- font-race -->')) return html.replace('<!-- font-race -->', block);
  return html.replace('</head>', `${block}</head>`);
}

/** CSP for a page whose only external assets are these two font sources. */
export function fontPageCsp(): string {
  const style = FONT_CSS_HOSTS.join(' ');
  const font = FONT_FILE_HOSTS.join(' ');
  const connect = [...FONT_CSS_HOSTS, ...FONT_FILE_HOSTS].join(' ');
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' ${style}; font-src ${font}; connect-src ${connect}`;
}
