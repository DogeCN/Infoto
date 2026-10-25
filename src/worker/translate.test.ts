import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  restTranslationRunner,
  splitAnnouncement,
  structuredTranslator,
  type ModelRunner,
} from './translate.ts';

const jsonRunner = (draft: unknown, onCall?: () => void): ModelRunner => {
  return async () => {
    onCall?.();
    return JSON.stringify(draft);
  };
};

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

test('translate: one structured call translates an announcement and reassembles literals', async () => {
  let calls = 0;
  let messages: Array<{ role: string; content: string }> = [];
  let schema: Record<string, unknown> = {};
  const runner: ModelRunner = async (nextMessages, nextSchema) => {
    calls += 1;
    messages = nextMessages;
    schema = nextSchema;
    return JSON.stringify({ title: 'Title2', texts: ['Intro2', 'Closing2'] });
  };
  const draft = await structuredTranslator(runner)({
    kind: 'announcement',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    title: 'Title',
    contentMd: 'Intro\n\n```\ncode\n```\n\n::poll:en-US:1\nClosing',
  });
  assert.equal(calls, 1);
  assert.equal(draft.kind, 'announcement');
  if (draft.kind !== 'announcement') return;
  assert.equal(draft.title, 'Title2');
  assert.equal(draft.contentMd, 'Intro2\n\n```\ncode\n```\n\n::poll:en-US:1\nClosing2');
  assert.deepEqual(JSON.parse(messages[1]!.content), {
    title: 'Title',
    texts: ['Intro', 'Closing'],
  });
  assert.equal(schema.type, 'object');
});

test('translate: one structured call translates all poll options in order', async () => {
  let calls = 0;
  const draft = await structuredTranslator(
    jsonRunner({ options: ['Yes2', 'No2'] }, () => {
      calls += 1;
    }),
  )({
    kind: 'poll',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    options: ['Yes', 'No'],
    allowMultiple: true,
  });
  assert.equal(calls, 1);
  assert.deepEqual(draft, { kind: 'poll', options: ['Yes2', 'No2'] });
});

test('translate: malformed or incomplete structured output is rejected', async () => {
  await assert.rejects(
    structuredTranslator(jsonRunner({ title: 'T', texts: ['only one'] }))({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 'T',
      contentMd: 'A\n\nB',
    }),
    /invalid_response/,
  );
  await assert.rejects(
    structuredTranslator(jsonRunner({ title: 'T', texts: ['A', ''] }))({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 'T',
      contentMd: 'A\n\nB',
    }),
    /empty_translation/,
  );
  await assert.rejects(
    structuredTranslator(jsonRunner({ options: ['only one'] }))({
      kind: 'poll',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      options: ['A', 'B'],
      allowMultiple: false,
    }),
    /invalid_response/,
  );
  await assert.rejects(
    structuredTranslator(async () => 'not json')({
      kind: 'poll',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      options: ['A', 'B'],
      allowMultiple: false,
    }),
    /invalid_response/,
  );
});

test('translate: a draft the album would refuse is rejected, not returned', async () => {
  // A translated poll option over MAX_POLL_OPTION_CHARS could never be saved: the poll
  // endpoints apply the same ceiling, so an overlong draft is a dead end.
  await assert.rejects(
    structuredTranslator(jsonRunner({ options: ['y'.repeat(201), 'B'] }))({
      kind: 'poll',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      options: ['s'.repeat(200), 'B'],
      allowMultiple: false,
    }),
    /invalid_response/,
  );
  // Same for an announcement draft over MAX_TEXT_LENGTH.
  await assert.rejects(
    structuredTranslator(jsonRunner({ title: 'T', texts: ['x'.repeat(20_001)] }))({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 'T',
      contentMd: 'A',
    }),
    /invalid_response/,
  );
  // A non-string array entry is malformed output, not a translation.
  await assert.rejects(
    structuredTranslator(jsonRunner({ options: ['A2', 7] }))({
      kind: 'poll',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      options: ['A', 'B'],
      allowMultiple: false,
    }),
    /invalid_response/,
  );
});

test('translate: model-added blank lines are normalized per text entry', async () => {
  const draft = await structuredTranslator(
    jsonRunner({ title: 'T2', texts: ['\nIntro\n\n', '\n- A\n\n- B\n'] }),
  )({
    kind: 'announcement',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    title: 'T',
    contentMd: 'Intro\n\n- A\n- B',
  });
  assert.equal(draft.kind, 'announcement');
  if (draft.kind !== 'announcement') return;
  assert.equal(draft.contentMd, 'Intro\n\n- A\n- B');
});

test('translate: the dev REST transport sends a JSON-schema request', async () => {
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  const runner = restTranslationRunner('acct', 'token', async (url, init) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    return Response.json({
      success: true,
      result: { response: JSON.stringify({ options: ['A2'] }) },
    });
  });
  assert.equal(
    await runner(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      {
        type: 'object',
      },
    ),
    JSON.stringify({ options: ['A2'] }),
  );
  assert.match(seen!.url, /@cf\/qwen\/qwen3-30b-a3b-fp8$/);
  assert.equal((seen!.body.response_format as { type: string }).type, 'json_schema');
  assert.equal(seen!.body.temperature, 0);
  assert.equal(seen!.body.max_tokens, 8192);

  const fail = restTranslationRunner('acct', 'token', async () =>
    Response.json({}, { status: 502 }),
  );
  await assert.rejects(
    fail([{ role: 'user', content: 'u' }], { type: 'object' }),
    /rest_translate_failed_502/,
  );
});
