import { test } from 'vitest';
import assert from 'node:assert/strict';
import { requestJson } from '../../src/core/api/request';
import { postSync } from '../../src/core/api/syncClient';
import { createAnnouncement, deleteFeedback } from '../../src/core/api/adminClient';

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
    await assert.rejects(postSync({ ops: [] }, io), /sync_timeout/);
    await assert.rejects(createAnnouncement('title', 'body', 'en-US', io), /announcement_timeout/);
    await assert.rejects(deleteFeedback(1, io), /feedback_timeout/);
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

  // A malformed successful sync response is rejected before the oplog is acknowledged.
  {
    for (const payload of [null, [], {}, { ok: false }, { ok: true, selfId: 1 }]) {
      await assert.rejects(
        postSync(
          { ops: [] },
          {
            origin,
            fetchFn: async () => Response.json(payload),
          },
        ),
        /invalid_sync_response/,
      );
    }
  }

  // Admin create validates its success payload.
  {
    await assert.rejects(
      createAnnouncement('title', 'body', 'en-US', {
        origin,
        fetchFn: async () => Response.json({ ok: true }),
      }),
      /invalid_response/,
    );
  }
});
