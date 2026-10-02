import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  APP_FONT_QUERY,
  FONT_CSS_HOST,
  FONT_FILE_HOST,
  fontHeadBlock,
  fontPageCsp,
  fontStylesheetUrl,
  injectFonts,
} from './fonts.ts';

test('web fonts: links one stylesheet and injects no script', () => {
  assert.equal(
    fontStylesheetUrl(APP_FONT_QUERY),
    `https://fonts.googleapis.cn/css2?${APP_FONT_QUERY}`,
  );

  const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
  assert.ok(html.includes('<!-- fonts -->'));
  const injected = injectFonts(html);
  assert.ok(!injected.includes('<!-- fonts -->'));
  assert.ok(injected.includes(fontHeadBlock(APP_FONT_QUERY)));
  // Font injection adds links without adding scripts.
  assert.doesNotMatch(fontHeadBlock(APP_FONT_QUERY), /<script/i);
});

// Keep stylesheet hosts, file hosts, and CSP sources aligned.
test('web fonts: keeps the stylesheet host and the file host a matching pair', () => {
  assert.equal(FONT_CSS_HOST, 'https://fonts.googleapis.cn');
  assert.equal(FONT_FILE_HOST, 'https://fonts.gstatic.cn');

  const csp = fontPageCsp();
  assert.ok(csp.includes(`style-src 'unsafe-inline' ${FONT_CSS_HOST}`));
  assert.ok(csp.includes(`font-src ${FONT_FILE_HOST}`));
  assert.ok(csp.includes(`connect-src ${FONT_CSS_HOST} ${FONT_FILE_HOST}`));

  // Preconnect to both the stylesheet and font file hosts.
  const block = fontHeadBlock(APP_FONT_QUERY);
  assert.ok(block.includes(`<link rel="preconnect" href="${FONT_CSS_HOST}" crossorigin>`));
  assert.ok(block.includes(`<link rel="preconnect" href="${FONT_FILE_HOST}" crossorigin>`));
});

test('web fonts: keeps the global hosts and the broken mirror out of the page', () => {
  const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'web/index.html'), 'utf8');
  const injected = injectFonts(html);
  // Keep unconfigured font hosts out of page markup and the CSP.
  for (const retired of ['ustclug.org', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
    assert.ok(!injected.includes(retired));
    assert.ok(!fontPageCsp().includes(retired));
  }
});

test('web fonts: leaves script-src out of the error page CSP, since it has no script', () => {
  assert.ok(!fontPageCsp().includes('script-src'));
});
