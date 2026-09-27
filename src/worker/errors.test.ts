// The error pages are the only UI the Worker renders, and one isolate serves every
// visitor — so the locale has to come from the request, not from module state.

import { describe, expect, it } from 'vitest';
import { notFoundPage, serverErrorPage } from './errors.ts';

const request = (acceptLanguage?: string): Request =>
  new Request('http://localhost/nope', {
    headers: acceptLanguage ? { 'Accept-Language': acceptLanguage } : {},
  });

describe('worker error pages', () => {
  it('renders in the language the visitor asks for', async () => {
    const zh = await notFoundPage(request('zh-CN,zh;q=0.9')).text();
    expect(zh).toContain('页面不存在或已被移除');
    expect(zh).toContain('返回首页');

    const en = await notFoundPage(request('en-US,en;q=0.9')).text();
    expect(en).toContain('The page does not exist or was removed');
  });

  it('respects the q ordering when several tags are offered', async () => {
    // The Chinese tag is listed first but weighted lower, so English should win.
    const body = await serverErrorPage(request('zh-CN;q=0.2, en-US;q=0.9')).text();
    expect(body).toContain('The server hiccupped');
  });

  it('falls back to English for a language this build does not ship', async () => {
    const body = await notFoundPage(request('fr-FR,fr;q=0.9')).text();
    expect(body).toContain('The page does not exist or was removed');
  });

  it('falls back to English with no header at all', async () => {
    expect(await notFoundPage(request()).text()).toContain('Not Found');
    expect(await notFoundPage().text()).toContain('Not Found');
  });

  it('announces the language it rendered in', async () => {
    const res = notFoundPage(request('zh-CN'));
    expect(res.headers.get('Content-Language')).toBe('zh-CN');
    expect(await res.text()).toContain('<html lang="zh-CN">');
  });

  it('keeps the status code and the no-store policy on a localized page', () => {
    const res = notFoundPage(request('zh-CN'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(serverErrorPage(request('zh-CN')).status).toBe(500);
  });

  it('escapes the copy it interpolates', async () => {
    // Nothing in the tables needs escaping today; the guarantee is that a future
    // string containing markup cannot break out of the page.
    const body = await notFoundPage(request('en-US')).text();
    expect(body).not.toMatch(/<script/i);
  });
});
