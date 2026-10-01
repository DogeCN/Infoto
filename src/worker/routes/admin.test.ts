// Root-only admin write APIs. Reads are asserted through the /sync snapshot.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  type TestApp,
  cookieFrom,
  makeApp,
  postOps,
  snap,
  stubSiteverify,
  syncNew,
} from '../../testing/app.ts';

stubSiteverify();

async function twoIdentities(app: TestApp): Promise<{ root: string; guest: string }> {
  const root = cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  return { root, guest };
}

const jsonHeaders = { 'Content-Type': 'application/json' };
const annPath = 'http://localhost/admin/announcements';
const feedbackPath = 'http://localhost/admin/feedback';
const pollPath = 'http://localhost/admin/polls';

async function request(
  app: TestApp,
  path: string,
  cookie: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return await app.request(path, {
    method,
    headers: { ...jsonHeaders, Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const annCreate = (
  app: TestApp,
  cookie: string,
  title: string,
  contentMd: string,
  locale = 'en-US',
) => request(app, annPath, cookie, 'POST', { title, contentMd, locale });
const annPut = (
  app: TestApp,
  cookie: string,
  id: number | string,
  title: string,
  contentMd: string,
  locale = 'en-US',
) => request(app, `${annPath}/${id}`, cookie, 'PUT', { title, contentMd, locale });
const annDelete = (app: TestApp, cookie: string, id: number | string) =>
  request(app, `${annPath}/${id}`, cookie, 'DELETE');
const annReorder = (app: TestApp, cookie: string, ids: unknown, locale = 'en-US') =>
  request(app, `${annPath}/reorder`, cookie, 'POST', { ids, locale });
const feedbackDelete = (app: TestApp, cookie: string, id: number | string) =>
  request(app, `${feedbackPath}/${id}`, cookie, 'DELETE');
const feedbackReorder = (app: TestApp, cookie: string, ids: unknown, locale = 'en-US') =>
  request(app, `${feedbackPath}/reorder`, cookie, 'POST', { ids, locale });
const pollCreate = (
  app: TestApp,
  cookie: string,
  title: string,
  options: string[] = ['Yes', 'No'],
  allowMultiple = false,
  locale = 'en-US',
) => request(app, pollPath, cookie, 'POST', { title, options, allowMultiple, locale });
const pollPut = (
  app: TestApp,
  cookie: string,
  id: number | string,
  title: string,
  options: string[] = ['Yes', 'No'],
  allowMultiple = false,
  locale = 'en-US',
) => request(app, `${pollPath}/${id}`, cookie, 'PUT', { title, options, allowMultiple, locale });
const pollDelete = (app: TestApp, cookie: string, id: number | string) =>
  request(app, `${pollPath}/${id}`, cookie, 'DELETE');
const pollReorder = (app: TestApp, cookie: string, ids: unknown, locale = 'en-US') =>
  request(app, `${pollPath}/reorder`, cookie, 'POST', { ids, locale });

async function createFeedback(app: TestApp, cookie: string, contentMd: string, locale = 'en-US') {
  return postOps(app, cookie, [{ type: 'fb_create', payload: { contentMd, locale } }]);
}

test('root creates localized announcements with a real id and empty reactions', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  const res = await annCreate(app, root, 'announcement', 'body', 'zh-CN');
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    announcement: {
      id: number;
      locale: string;
      title: string;
      contentMd: string;
      sort: number;
      updatedAt: number;
      reactions: [];
    };
  };
  assert.deepEqual(data.announcement, {
    id: 1,
    locale: 'zh-CN',
    title: 'announcement',
    contentMd: 'body',
    sort: 0,
    updatedAt: data.announcement.updatedAt,
    reactions: [],
  });
  assert.equal(typeof data.announcement.updatedAt, 'number');
});

test('announcement create and update validate fields and locale', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  assert.equal((await annCreate(app, root, '', 'body')).status, 400);
  assert.equal((await annCreate(app, root, 'title', '')).status, 400);
  assert.equal((await annCreate(app, root, 'title', 'body', 'fr-FR')).status, 400);
  await annCreate(app, root, 'old', 'body');
  assert.equal((await annPut(app, root, 1, 'new', 'updated')).status, 200);
  assert.equal((await annPut(app, root, 999, 'missing', 'body')).status, 404);
  assert.equal((await annPut(app, root, 1, 'moved', 'body', 'zh-CN')).status, 409);
  const snapshot = await snap(app, root);
  assert.equal(snapshot.announcements[0]!.locale, 'en-US');
  assert.equal(snapshot.announcements[0]!.title, 'new');
});

test('poll IDs start at zero; votes support multiple selections and option edits lock after voting', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  const created = await pollCreate(app, root, 'Pick all that apply', ['A', 'B', 'C'], true);
  assert.equal(created.status, 200);
  const response = (await created.json()) as {
    poll: { id: number; sort: number; votes: unknown[] };
  };
  assert.equal(response.poll.id, 0);
  assert.equal(response.poll.sort, 0);
  assert.deepEqual(response.poll.votes, []);

  const next = await pollCreate(app, root, 'Second poll');
  const nextBody = (await next.json()) as { poll: { id: number; sort: number } };
  assert.equal(nextBody.poll.id, 1);
  assert.equal(nextBody.poll.sort, 1);

  let snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.polls.map((poll) => poll.id),
    [0, 1],
  );
  assert.equal((await pollPut(app, root, 0, 'Renamed', ['A', 'B', 'C'], true)).status, 200);

  await postOps(app, guest, [{ type: 'vote', target: 0, payload: { options: [0, 2] } }]);
  snapshot = await snap(app, root);
  assert.deepEqual(snapshot.polls[0]!.votes, [
    { userId: 1, option: 0 },
    { userId: 1, option: 2 },
  ]);
  assert.equal(
    (await pollPut(app, root, 0, 'Title may still change', ['A', 'B', 'C'], true)).status,
    200,
  );
  const locked = await pollPut(app, root, 0, 'Changed options', ['A', 'B'], true);
  assert.equal(locked.status, 409);
  assert.deepEqual(await locked.json(), { ok: false, error: 'poll_has_votes' });

  assert.equal((await pollDelete(app, root, 0)).status, 200);
  snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.polls.map((poll) => poll.id),
    [1],
  );
});

test('poll validation and zero-based path parsing are strict', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  assert.equal((await pollCreate(app, root, '', ['A', 'B'])).status, 400);
  assert.equal((await pollCreate(app, root, 'Only one', ['A'])).status, 400);
  assert.equal((await pollCreate(app, root, 'Bad locale', ['A', 'B'], false, 'fr')).status, 400);
  await pollCreate(app, root, 'Valid');
  assert.equal((await pollPut(app, root, 'abc', 'x')).status, 400);
  for (const id of ['-1', '00', '0x10', '1e3', '1.5']) {
    assert.equal((await pollPut(app, root, id, 'x')).status, 400, id);
    assert.equal((await pollDelete(app, root, id)).status, 400, id);
  }
  assert.equal((await pollPut(app, root, 0, 'valid')).status, 200);
  assert.equal((await pollDelete(app, root, 999)).status, 200);
});

test('announcement deletion removes its reactions but polls remain independent', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  await annCreate(app, root, 'announcement', '::vote:0');
  await pollCreate(app, root, 'Question');
  await postOps(app, guest, [
    { type: 'react', target: 1, payload: { emoji: '👍' } },
    { type: 'vote', target: 0, payload: { options: [1] } },
  ]);
  assert.equal((await annDelete(app, root, 1)).status, 200);
  const snapshot = await snap(app, root);
  assert.deepEqual(snapshot.announcements, []);
  assert.deepEqual(snapshot.polls[0]!.votes, [{ userId: 1, option: 1 }]);
});

test('reordering is locale-scoped and renumbers complete lists', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  await annCreate(app, root, 'en-A', 'a');
  await annCreate(app, root, 'zh-A', 'a', 'zh-CN');
  await annCreate(app, root, 'en-B', 'b');
  assert.equal((await annReorder(app, root, [3, 1])).status, 200);
  let snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.announcements.map((announcement) => [
      announcement.id,
      announcement.locale,
      announcement.sort,
    ]),
    [
      [3, 'en-US', 0],
      [1, 'en-US', 1],
      [2, 'zh-CN', 0],
    ],
  );
  assert.equal((await annReorder(app, root, [], 'en-US')).status, 400);
  assert.equal((await annReorder(app, root, [1])).status, 200);
  snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.announcements.filter((item) => item.locale === 'en-US').map((a) => a.id),
    [1, 3],
  );

  await pollCreate(app, root, 'English A');
  await pollCreate(app, root, '中文', ['甲', '乙'], false, 'zh-CN');
  await pollCreate(app, root, 'English B');
  assert.equal((await pollReorder(app, root, [2, 0])).status, 200);
  snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.polls.map((poll) => [poll.id, poll.locale, poll.sort]),
    [
      [2, 'en-US', 0],
      [0, 'en-US', 1],
      [1, 'zh-CN', 0],
    ],
  );
});

test('non-root admin writes are forbidden while localized feedback submission stays public', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  await annCreate(app, root, 'a', 'b');
  assert.equal((await annCreate(app, guest, 'a', 'b')).status, 403);
  assert.equal((await annPut(app, guest, 1, 'x', 'y')).status, 403);
  assert.equal((await annDelete(app, guest, 1)).status, 403);
  assert.equal((await annReorder(app, guest, [1])).status, 403);
  assert.equal((await pollCreate(app, guest, 'Question')).status, 403);
  assert.equal((await pollPut(app, guest, 0, 'Question')).status, 403);
  assert.equal((await pollDelete(app, guest, 0)).status, 403);
  assert.equal((await pollReorder(app, guest, [0])).status, 403);

  await createFeedback(app, guest, 'suggestion', 'zh-CN');
  const hidden = await snap(app, guest);
  assert.deepEqual(hidden.feedback, []);
  const rootSnapshot = await snap(app, root);
  assert.equal(rootSnapshot.feedback.length, 1);
  assert.equal(rootSnapshot.feedback[0]!.locale, 'zh-CN');
  assert.equal(rootSnapshot.feedback[0]!.userId, 1);
  assert.equal((await feedbackDelete(app, guest, rootSnapshot.feedback[0]!.id)).status, 403);
});

test('feedback order is isolated by locale; delete removes the row', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  await createFeedback(app, guest, 'en one');
  await createFeedback(app, guest, 'zh one', 'zh-CN');
  await createFeedback(app, guest, 'en two');
  let snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.feedback.map((item) => item.contentMd),
    ['en two', 'en one', 'zh one'],
  );
  const englishIds = snapshot.feedback
    .filter((item) => item.locale === 'en-US')
    .map((item) => item.id);
  assert.equal((await feedbackReorder(app, root, [...englishIds].reverse())).status, 200);
  snapshot = await snap(app, root);
  assert.deepEqual(
    snapshot.feedback.filter((item) => item.locale === 'en-US').map((item) => item.id),
    [...englishIds].reverse(),
  );
  assert.equal((await feedbackDelete(app, root, snapshot.feedback[0]!.id)).status, 200);
  assert.equal((await snap(app, root)).feedback.length, 2);
});

test('announcement ID validation and reorder requests reject malformed IDs', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  for (const id of ['abc', '0', '-1', '0x10', '1e3', '1.5']) {
    assert.equal((await annDelete(app, root, id)).status, 400, id);
  }
  assert.equal((await annDelete(app, root, 999)).status, 200);
  assert.equal((await annReorder(app, root, [Number.MAX_SAFE_INTEGER + 1])).status, 400);
});
