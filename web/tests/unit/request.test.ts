import { test } from 'vitest';
import assert from 'node:assert/strict';
import { requestJson } from '../../src/core/api/request';

const origin = 'https://infoto.test';

/** Return headers immediately, leaving the response body pending until aborted. */
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

test('validates JSON responses and bounds transport failures', async () => {
  // JSON deadlines include response body consumption.
  {
    const io = { origin, fetchFn: stalledBody, timeoutMs: 5 };
    await assert.rejects(requestJson('/any', {}, 'sync_timeout', io), /sync_timeout/);
    await assert.rejects(
      requestJson('/any', {}, 'announcement_timeout', io),
      /announcement_timeout/,
    );
    await assert.rejects(requestJson('/any', {}, 'feedback_timeout', io), /feedback_timeout/);
  }

  // JSON transport preserves caller cancellation and network failures.
  {
    const controller = new AbortController();
    const cancelled = new DOMException('cancelled', 'AbortError');
    const request = requestJson('/sync', { signal: controller.signal }, 'timeout', {
      origin,
      timeoutMs: 1000,
      fetchFn: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });
    controller.abort(cancelled);
    await assert.rejects(request, (error) => error === cancelled);
  }

  // JSON transport preserves network failures and tolerates non-JSON HTTP errors.
  {
    const offline = new Error('offline');
    await assert.rejects(
      requestJson('/sync', {}, 'timeout', {
        origin,
        fetchFn: async () => {
          throw offline;
        },
      }),
      (error) => error === offline,
    );
    const { response, data } = await requestJson('/sync', {}, 'timeout', {
      origin,
      fetchFn: async () => new Response('unavailable', { status: 503 }),
    });
    assert.equal(response.status, 503);
    assert.equal(data, null);
  }
});
