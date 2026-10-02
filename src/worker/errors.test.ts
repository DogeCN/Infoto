import { test } from 'vitest';
import assert from 'node:assert/strict';
import { locales } from '../shared/copy.ts';
import { notFoundPage, serverErrorPage } from './errors.ts';

const request = (acceptLanguage?: string): Request =>
  new Request('http://localhost/nope', {
    headers: acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  });

test('worker error pages: renders the requested language, falls back to English, and stays cache-safe', async () => {
  const zh = notFoundPage(request('zh-CN,zh;q=0.9'));
  assert.equal(zh.status, 404);
  assert.equal(zh.headers.get('Cache-Control'), 'no-store');
  assert.equal(zh.headers.get('Content-Language'), 'zh-CN');
  const zhBody = await zh.text();
  assert.ok(zhBody.includes('<html lang="zh-CN">'));
  assert.ok(zhBody.includes(locales['zh-CN'].errorPage.workerNotFoundMessage));
  assert.ok(zhBody.includes(locales['zh-CN'].errorPage.backHome));

  const weighted = await serverErrorPage(request('zh-CN;q=0.2, en-US;q=0.9')).text();
  assert.ok(weighted.includes('The server hiccupped'));
  assert.equal(serverErrorPage(request('zh-CN')).status, 500);

  assert.ok(
    (await notFoundPage(request('fr-FR,fr;q=0.9')).text()).includes(
      'The page does not exist or was removed',
    ),
  );
  assert.ok((await notFoundPage(request()).text()).includes('Not Found'));
  assert.ok((await notFoundPage().text()).includes('Not Found'));

  const en = await notFoundPage(request('en-US')).text();
  assert.ok(!en.includes('ustclug.org'));
  assert.ok(!en.includes('fonts.googleapis.com'));
  assert.ok(!en.includes('fonts.gstatic.com'));
  assert.ok(en.includes('https://fonts.googleapis.cn/css2?'));
  // No race script, so the error page carries no JavaScript at all.
  assert.doesNotMatch(en, /<script/i);

  const csp = notFoundPage(request('en-US')).headers.get('Content-Security-Policy');
  assert.ok(csp, 'Content-Security-Policy header');
  assert.ok(!csp.includes('fonts.googleapis.com'));
  assert.ok(!csp.includes('ustclug.org'));
  // The CSP has to allow the file host too, or every @font-face src is refused.
  assert.ok(csp.includes('font-src https://fonts.gstatic.cn'));
  assert.ok(!csp.includes('script-src'));
});
