import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_FONT_QUERY,
  FONT_CSS_HOST,
  FONT_FILE_HOST,
  fontHeadBlock,
  fontPageCsp,
  fontStylesheetUrl,
  injectFonts,
} from './fonts.ts';

describe('web fonts', () => {
  it('links one stylesheet and injects no script', () => {
    expect(fontStylesheetUrl(APP_FONT_QUERY)).toBe(
      `https://fonts.googleapis.cn/css2?${APP_FONT_QUERY}`,
    );

    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
    expect(html).toContain('<!-- fonts -->');
    const injected = injectFonts(html);
    expect(injected).not.toContain('<!-- fonts -->');
    expect(injected).toContain(fontHeadBlock(APP_FONT_QUERY));
    // Font injection adds links without adding scripts.
    expect(fontHeadBlock(APP_FONT_QUERY)).not.toMatch(/<script/i);
  });

  // Keep stylesheet hosts, file hosts, and CSP sources aligned.
  it('keeps the stylesheet host and the file host a matching pair', () => {
    expect(FONT_CSS_HOST).toBe('https://fonts.googleapis.cn');
    expect(FONT_FILE_HOST).toBe('https://fonts.gstatic.cn');

    const csp = fontPageCsp();
    expect(csp).toContain(`style-src 'unsafe-inline' ${FONT_CSS_HOST}`);
    expect(csp).toContain(`font-src ${FONT_FILE_HOST}`);
    expect(csp).toContain(`connect-src ${FONT_CSS_HOST} ${FONT_FILE_HOST}`);

    // Preconnect to both the stylesheet and font file hosts.
    const block = fontHeadBlock(APP_FONT_QUERY);
    expect(block).toContain(`<link rel="preconnect" href="${FONT_CSS_HOST}" crossorigin>`);
    expect(block).toContain(`<link rel="preconnect" href="${FONT_FILE_HOST}" crossorigin>`);
  });

  it('keeps the global hosts and the broken mirror out of the page', () => {
    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
    const injected = injectFonts(html);
    // Keep unconfigured font hosts out of page markup and the CSP.
    for (const retired of ['ustclug.org', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
      expect(injected).not.toContain(retired);
      expect(fontPageCsp()).not.toContain(retired);
    }
  });

  it('leaves script-src out of the error page CSP, since it has no script', () => {
    expect(fontPageCsp()).not.toContain('script-src');
  });
});
