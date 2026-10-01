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
  it('links the official stylesheet only, and injects no script', () => {
    expect(fontStylesheetUrl(APP_FONT_QUERY)).toBe(
      `https://fonts.googleapis.com/css2?${APP_FONT_QUERY}`,
    );
    expect(FONT_CSS_HOST).toBe('https://fonts.googleapis.com');
    expect(FONT_FILE_HOST).toBe('https://fonts.gstatic.com');

    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
    expect(html).toContain('<!-- fonts -->');
    const injected = injectFonts(html);
    expect(injected).not.toContain('<!-- fonts -->');
    expect(injected).toContain(fontHeadBlock(APP_FONT_QUERY));
    // No race, so the head block adds no script. (The page's own module script is
    // unrelated and stays.)
    expect(fontHeadBlock(APP_FONT_QUERY)).not.toMatch(/<script/i);
  });

  it('keeps every mirror and the retired .cn host out of the page', () => {
    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
    const injected = injectFonts(html);
    expect(injected).not.toContain('fonts.googleapis.cn');
    expect(injected).not.toContain('ustclug.org');
    expect(fontPageCsp()).not.toContain('ustclug.org');
    expect(fontPageCsp()).not.toContain('fonts.googleapis.cn');
  });

  it('leaves script-src out of the error page CSP, since it has no script', () => {
    const csp = fontPageCsp();
    expect(csp).not.toContain('script-src');
    expect(csp).toContain(`style-src 'unsafe-inline' ${FONT_CSS_HOST}`);
    expect(csp).toContain(`font-src ${FONT_FILE_HOST}`);
  });
});
