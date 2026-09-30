import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_FONT_QUERY,
  FONT_CSS_HOSTS,
  FONT_FILE_HOSTS,
  fontHeadBlock,
  fontStylesheetUrls,
  injectFontRace,
} from './fonts.ts';

describe('font host race', () => {
  it('races the official stylesheet against the USTC mirror and drops fonts.googleapis.cn', () => {
    const urls = fontStylesheetUrls(APP_FONT_QUERY);
    expect(urls).toEqual([
      `https://fonts.googleapis.com/css2?${APP_FONT_QUERY}`,
      `https://fonts.proxy.ustclug.org/css2?${APP_FONT_QUERY}`,
    ]);
    expect(FONT_CSS_HOSTS).not.toContain('https://fonts.googleapis.cn');
    expect(FONT_FILE_HOSTS).toEqual([
      'https://fonts.gstatic.com',
      'https://fonts-gstatic.proxy.ustclug.org',
    ]);

    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
    expect(html).toContain('<!-- font-race -->');
    expect(html).not.toContain('fonts.googleapis.cn');
    const injected = injectFontRace(html);
    expect(injected).not.toContain('<!-- font-race -->');
    expect(injected).toContain(fontHeadBlock(APP_FONT_QUERY));
    expect(injected).not.toContain('fonts.googleapis.cn');
  });
});
