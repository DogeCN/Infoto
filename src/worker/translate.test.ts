import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TranslationRequest } from '../shared/types.ts';
import { restTranslationRunner, m2m100Translator, splitAnnouncement } from './translate.ts';

const labelled = (text: string, source: string, target: string): string =>
  `[${source}>${target}]${text}`;

test('translate: segmenter marks fences, blank lines, and poll references literal', () => {
  assert.deepEqual(splitAnnouncement('A\n\n```\nB\n```\n::poll:en-US:1'), [
    { literal: false, text: 'A' },
    { literal: true, text: '' },
    { literal: true, text: '```' },
    { literal: true, text: 'B' },
    { literal: true, text: '```' },
    { literal: true, text: '::poll:en-US:1' },
  ]);
});

test('translate: announcement drafts translate text blocks and preserve literal blocks', async () => {
  const calls: string[] = [];
  const translator = m2m100Translator(async (text, source, target) => {
    calls.push(text);
    return labelled(text, source, target);
  });
  const contentMd = 'Intro\n\n```\ncode\n```\n\n::poll:en-US:7\nOutro';
  const draft = await translator({
    kind: 'announcement',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    title: 'Title',
    contentMd,
  });
  assert.equal(draft.kind, 'announcement');
  if (draft.kind !== 'announcement') return;
  assert.equal(draft.title, '[en>zh]Title');
  assert.equal(draft.contentMd, '[en>zh]Intro\n\n```\ncode\n```\n\n::poll:en-US:7\n[en>zh]Outro');
  assert.deepEqual(calls, ['Title', 'Intro', 'Outro']);
});

test('translate: long text is chunked and poll options keep their order', async () => {
  const lengths: number[] = [];
  const translator = m2m100Translator(async (text, source, target) => {
    lengths.push(text.length);
    return labelled(text, source, target);
  });
  const draft = await translator({
    kind: 'announcement',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    title: 'T',
    contentMd: 'a'.repeat(2_000),
  });
  assert.equal(draft.kind, 'announcement');
  assert.ok(lengths.length >= 4, `title plus at least three body chunks: ${lengths.join(',')}`);
  assert.ok(
    lengths.every((length) => length <= 800),
    'every model call stays within the chunk ceiling',
  );

  const poll = await translator({
    kind: 'poll',
    sourceLocale: 'zh-CN',
    targetLocale: 'en-US',
    options: ['A', 'B', 'C'],
    allowMultiple: true,
  });
  assert.deepEqual(poll, {
    kind: 'poll',
    options: ['[zh>en]A', '[zh>en]B', '[zh>en]C'],
  });
});

test('translate: empty output, invalid polls, and unsupported locales are rejected', async () => {
  const empty = m2m100Translator(async () => '');
  await assert.rejects(
    empty({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 'T',
      contentMd: 'B',
    }),
    /empty_translation/,
  );
  await assert.rejects(
    empty({
      kind: 'poll',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      options: ['A', 'B'],
      allowMultiple: false,
    }),
    /empty_translation/,
  );

  const echo = m2m100Translator(async (text) => text);
  await assert.rejects(
    echo({
      kind: 'poll',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      options: ['A'],
      allowMultiple: false,
    }),
    /invalid_request/,
  );
  await assert.rejects(
    echo({
      kind: 'announcement',
      sourceLocale: 'fr-FR' as never,
      targetLocale: 'zh-CN',
      title: 'T',
      contentMd: 'B',
    } satisfies TranslationRequest),
    /unsupported_locale/,
  );
  await assert.rejects(
    echo({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'en-US',
      title: 'T',
      contentMd: 'B',
    }),
    /unsupported_locale/,
  );
});

test('translate: the dev REST transport posts one string and rejects what it cannot read', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = restTranslationRunner('acct', 'token', async (url, init) => {
    seen = { url: String(url), init: init ?? {} };
    return Response.json({ success: true, result: { translated_text: 'Bonjour' } });
  });
  assert.equal(await ok('Hello', 'en', 'zh'), 'Bonjour');
  assert.match(seen!.url, /accounts\/acct\/ai\/run\/@cf\/meta\/m2m100-1\.2b$/);
  assert.equal((seen!.init.headers as Record<string, string>)['Authorization'], 'Bearer token');
  assert.deepEqual(JSON.parse(String(seen!.init.body)), {
    text: 'Hello',
    source_lang: 'en',
    target_lang: 'zh',
  });

  const fail = restTranslationRunner('acct', 'token', async () =>
    Response.json({}, { status: 502 }),
  );
  await assert.rejects(fail('Hello', 'en', 'zh'), /rest_translate_failed_502/);

  const unreadable = restTranslationRunner('acct', 'token', async () =>
    Response.json({ success: true, result: {} }),
  );
  await assert.rejects(unreadable('Hello', 'en', 'zh'), /empty_translation/);
});
