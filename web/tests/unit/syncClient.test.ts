import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { postSync } from '../../src/core/api/syncClient';

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SNAPSHOT = {
  ok: true,
  serverTime: 1,
  selfId: 0,
  mediaHostUrl: 'https://facade.test',
  photos: [],
  locale: 'en-US',
  announcements: [],
  polls: [],
  feedback: [],
};

test('sync client: classifies Turnstile failures and reports a validated snapshot', async () => {
  const required = vi
    .fn()
    .mockResolvedValue(
      okResponse({ ok: false, error: 'turnstile_required', turnstileSiteKey: 'key-1' }, 401),
    );
  await assert.rejects(
    postSync({ ops: [] }, { fetchFn: required, origin: 'http://x' }),
    (error: Error & { turnstileSiteKey: string | null }) => {
      assert.equal(error.name, 'TurnstileRequiredError');
      assert.equal(error.turnstileSiteKey, 'key-1');
      return true;
    },
  );
  // The identity cookie stays on the Worker; only the facade request drops it.
  assert.ok(!Object.keys(JSON.parse(required.mock.calls[0]![1].body)).includes('uuid'));

  const failed = vi
    .fn()
    .mockResolvedValue(okResponse({ ok: false, error: 'turnstile_failed' }, 401));
  await assert.rejects(
    postSync({ ops: [] }, { fetchFn: failed, origin: 'http://x' }),
    (error: Error) => {
      assert.equal(error.name, 'TurnstileFailedError');
      return true;
    },
  );

  const ok = vi.fn().mockResolvedValue(okResponse(SNAPSHOT));
  assert.deepEqual(
    (await postSync({ ops: [] }, { fetchFn: ok, origin: 'http://x' })).response,
    SNAPSHOT,
  );
});

test('sync client: never retries a rate-limited sync', async () => {
  vi.useFakeTimers();
  try {
    const limited = vi.fn().mockResolvedValue(okResponse({ error: 'rate_limited' }, 429));
    await assert.rejects(
      postSync({ ops: [] }, { fetchFn: limited, origin: 'http://x' }),
      /rate_limited/,
    );
    await vi.advanceTimersByTimeAsync(120_000);
    assert.equal(limited.mock.calls.length, 1);
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    vi.useRealTimers();
  }
});
