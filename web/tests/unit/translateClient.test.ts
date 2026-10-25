import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { AnnouncementTranslationRequest, PollTranslationRequest } from '$shared/types';
import { translateDraft } from '../../src/core/api/adminClient';

const origin = 'https://infoto.test';

const announcementRequest: AnnouncementTranslationRequest = {
  kind: 'announcement',
  sourceLocale: 'en-US',
  targetLocale: 'zh-CN',
  title: 'Hello',
  contentMd: 'Body',
};

const pollRequest: PollTranslationRequest = {
  kind: 'poll',
  sourceLocale: 'zh-CN',
  targetLocale: 'en-US',
  options: ['A', 'B'],
  allowMultiple: true,
};

/** Headers arrive immediately; the body stays pending until the deadline aborts it. */
const stalledBody: typeof fetch = async (_url, init) =>
  new Response(
    new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('Aborted', 'AbortError')),
        );
      },
    }),
  );

test('admin translate client: sends the draft, parses both kinds, and rejects bad responses', async () => {
  {
    let seen: { url: string; body: unknown } | null = null;
    const draft = await translateDraft(announcementRequest, {
      origin,
      fetchFn: async (url, init) => {
        seen = { url: String(url), body: JSON.parse(String(init?.body)) };
        return Response.json({ ok: true, kind: 'announcement', title: 'T', contentMd: 'M' });
      },
    });
    assert.deepEqual(draft, { kind: 'announcement', title: 'T', contentMd: 'M' });
    assert.equal(seen!.url, `${origin}/admin/translate`);
    assert.deepEqual(seen!.body, announcementRequest);
  }

  {
    const draft = await translateDraft(pollRequest, {
      origin,
      fetchFn: async () => Response.json({ ok: true, kind: 'poll', options: ['X', 'Y'] }),
    });
    assert.deepEqual(draft, { kind: 'poll', options: ['X', 'Y'] });
  }

  await assert.rejects(
    translateDraft(announcementRequest, {
      origin,
      fetchFn: async () => Response.json({ ok: false }, { status: 502 }),
    }),
    /HTTP 502/,
  );

  const malformed = [
    null,
    [],
    {},
    { ok: true },
    { ok: true, kind: 'announcement', title: 'T' },
    { ok: true, kind: 'announcement', title: 'T', contentMd: '' },
    { ok: true, kind: 'poll', options: ['X'] },
    { ok: true, kind: 'poll', options: ['X', ''] },
    { ok: true, kind: 'poll', options: ['X', 2] },
  ];
  for (const payload of malformed) {
    await assert.rejects(
      translateDraft(pollRequest, {
        origin,
        fetchFn: async () => Response.json(payload),
      }),
      /invalid_response/,
    );
  }

  await assert.rejects(
    translateDraft(announcementRequest, {
      origin,
      fetchFn: stalledBody,
      timeoutMs: 5,
    }),
    /admin_translate_timeout/,
  );
});
