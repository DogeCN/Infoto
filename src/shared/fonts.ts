// Load the application fonts by racing two Google endpoints, cancelling the loser.

/**
 * A stylesheet host paired with the file host its stylesheets hardcode. The pair is the unit of
 * the race: every stylesheet rewrites its own `src:` URLs onto its own file host, so a source
 * is only usable whole, and the CSP has to allow both halves of every pair.
 *
 * Order is preference, not priority — nothing waits for the first entry. The China endpoint is
 * first because it serves the most from here and the global host is the one that has timed out
 * and returned failed subsets.
 */
export const FONT_SOURCES = [
  { css: 'https://fonts.googleapis.cn', files: 'https://fonts.gstatic.cn' },
  { css: 'https://fonts.googleapis.com', files: 'https://fonts.gstatic.com' },
] as const;

export type FontSource = (typeof FONT_SOURCES)[number];

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

export function fontStylesheetUrl(source: FontSource, query: string): string {
  return `${source.css}/css2?${query}`;
}

/**
 * Cancels the losers of the stylesheet race.
 *
 * The first stylesheet to load wins, and every other link is removed in the same task, so a
 * loser never applies the families and never triggers its own `woff2` downloads. A source that
 * errors removes only itself and leaves the rest racing. When every source fails nothing is left
 * declared and `display=swap` keeps the system fallback.
 *
 * **This script has to come before the stylesheet links.** A pending stylesheet blocks execution
 * of the scripts that follow it, so a script placed after them cannot start until the slowest one
 * has already downloaded — the race would then only ever choose between two sheets the browser had
 * already paid for. Nothing but a preconnect precedes it, so it runs as the parser reaches it.
 *
 * **The links arrive after it, so it watches for them.** A `MutationObserver` callback runs at the
 * end of the parser's current microtask checkpoint, which is before any stylesheet response can
 * land, so each link is claimed on insertion rather than on a later scan that might be too late.
 */
export const FONT_RACE_SCRIPT = `(function () {
  var links = [];
  var settled = false;
  function drop(link) {
    if (link.isConnected) link.remove();
  }
  function settle(winner) {
    if (settled) return;
    settled = true;
    for (var i = 0; i < links.length; i++) {
      if (links[i] !== winner) drop(links[i]);
    }
  }
  function register(link) {
    if (link.nodeType !== 1 || link.tagName !== 'LINK') return;
    if (!link.hasAttribute('data-font-race')) return;
    links.push(link);
    link.addEventListener('load', function () {
      settle(link);
    });
    link.addEventListener('error', function () {
      drop(link);
    });
  }
  function settleApplied() {
    // A sheet that applied before this script ran never reports a load again, so read the
    // sheet property rather than waiting for an event that has already gone by. Every link is
    // registered before this runs, so an early winner can cancel the whole field.
    for (var i = 0; i < links.length; i++) {
      if (links[i].sheet) settle(links[i]);
    }
  }
  var present = document.querySelectorAll('link[data-font-race]');
  for (var i = 0; i < present.length; i++) register(present[i]);
  settleApplied();
  new MutationObserver(function (records) {
    for (var r = 0; r < records.length; r++) {
      var added = records[r].addedNodes;
      for (var n = 0; n < added.length; n++) register(added[n]);
      settleApplied();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})()`;

/**
 * SHA-256 of {@link FONT_RACE_SCRIPT}, base64, for the error page's `script-src`.
 *
 * A hash keeps the race script runnable without re-opening `script-src 'unsafe-inline'` on a
 * page that has no other JavaScript. `fonts.test.ts` recomputes it from the script text, so the
 * two cannot drift.
 */
export const FONT_RACE_SHA256 = '/iQnSfxlrJ+6LjYjLGyrHerRA8/VdzLiqdVzW5ChTk0=';

function preconnectTags(): string {
  return FONT_SOURCES.flatMap((source) => [source.css, source.files])
    .map((href) => `<link rel="preconnect" href="${href}" crossorigin>`)
    .join('');
}

function stylesheetTags(query: string): string {
  return FONT_SOURCES.map(
    (source) => `<link rel="stylesheet" data-font-race href="${fontStylesheetUrl(source, query)}">`,
  ).join('');
}

/**
 * Preconnects, then the race script, then one stylesheet per source.
 *
 * The script sits between the preconnects and the links on purpose: a pending stylesheet blocks
 * the scripts after it, so a script placed after the links could only settle the race once the
 * slowest source had already downloaded. See {@link FONT_RACE_SCRIPT}.
 */
export function fontHeadBlock(query: string): string {
  return `${preconnectTags()}<script>${FONT_RACE_SCRIPT}</script>${stylesheetTags(query)}`;
}

export function injectFonts(html: string): string {
  const block = fontHeadBlock(APP_FONT_QUERY);
  if (html.includes('<!-- fonts -->')) return html.replace('<!-- fonts -->', block);
  return html.replace('</head>', `${block}</head>`);
}

/** CSP for an error page that loads only the configured font assets and the race script. */
export function fontPageCsp(): string {
  const cssHosts = FONT_SOURCES.map((source) => source.css).join(' ');
  const fileHosts = FONT_SOURCES.map((source) => source.files).join(' ');
  return `default-src 'none'; style-src 'unsafe-inline' ${cssHosts}; font-src ${fileHosts}; connect-src ${cssHosts} ${fileHosts}; script-src 'sha256-${FONT_RACE_SHA256}'`;
}
