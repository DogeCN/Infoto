import { describe, expect, it } from 'vitest';
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
    expect(zhBody).toContain('页面不存在或已被移除');
    expect(zhBody).toContain('返回首页');

    const weighted = await serverErrorPage(request('zh-CN;q=0.2, en-US;q=0.9')).text();
    expect(weighted).toContain('The server hiccupped');
    expect(serverErrorPage(request('zh-CN')).status).toBe(500);

    expect(await notFoundPage(request('fr-FR,fr;q=0.9')).text()).toContain(
      'The page does not exist or was removed',
    );
    expect(await notFoundPage(request()).text()).toContain('Not Found');
    expect(await notFoundPage().text()).toContain('Not Found');
    const en = await notFoundPage(request('en-US')).text();
    expect(en).not.toContain('fonts.googleapis.cn');
    expect(en).toContain('https://fonts.googleapis.com/css2?');
    expect(en).toContain('https://fonts.proxy.ustclug.org/css2?');
    expect(en).toContain('https://fonts-gstatic.proxy.ustclug.org');
    const script = en.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(script).toContain('fonts.proxy.ustclug.org');
    expect(script).not.toContain('does not exist');
    expect(notFoundPage(request('en-US')).headers.get('Content-Security-Policy')).not.toContain(
      'fonts.googleapis.cn',
    );
  });
});
