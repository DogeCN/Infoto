import { describe, expect, it } from 'vitest';
import { locales } from '../shared/copy.ts';
import { notFoundPage, serverErrorPage } from './errors.ts';

const request = (acceptLanguage?: string): Request =>
  new Request('http://localhost/nope', {
    headers: acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  });

describe('worker error pages', () => {
  it('renders the requested language, falls back to English, and stays cache-safe', async () => {
    const zh = notFoundPage(request('zh-CN,zh;q=0.9'));
    expect(zh.status).toBe(404);
    expect(zh.headers.get('Cache-Control')).toBe('no-store');
    expect(zh.headers.get('Content-Language')).toBe('zh-CN');
    const zhBody = await zh.text();
    expect(zhBody).toContain('<html lang="zh-CN">');
    expect(zhBody).toContain(locales['zh-CN'].errorPage.workerNotFoundMessage);
    expect(zhBody).toContain(locales['zh-CN'].errorPage.backHome);

    const weighted = await serverErrorPage(request('zh-CN;q=0.2, en-US;q=0.9')).text();
    expect(weighted).toContain('The server hiccupped');
    expect(serverErrorPage(request('zh-CN')).status).toBe(500);

    expect(await notFoundPage(request('fr-FR,fr;q=0.9')).text()).toContain(
      'The page does not exist or was removed',
    );
    expect(await notFoundPage(request()).text()).toContain('Not Found');
    expect(await notFoundPage().text()).toContain('Not Found');
    const en = await notFoundPage(request('en-US')).text();
    expect(en).not.toContain('ustclug.org');
    expect(en).not.toContain('fonts.googleapis.com');
    expect(en).not.toContain('fonts.gstatic.com');
    expect(en).toContain('https://fonts.googleapis.cn/css2?');
    // No race script, so the error page carries no JavaScript at all.
    expect(en).not.toMatch(/<script/i);
    const csp = notFoundPage(request('en-US')).headers.get('Content-Security-Policy');
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('ustclug.org');
    // The CSP has to allow the file host too, or every @font-face src is refused.
    expect(csp).toContain('font-src https://fonts.gstatic.cn');
    expect(csp).not.toContain('script-src');
  });
});
