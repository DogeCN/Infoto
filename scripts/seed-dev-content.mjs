#!/usr/bin/env node
// Seed the local D1 with demo announcements, polls, votes, reactions, and
// feedback for manual testing of the admin pages. Wipes the content tables
// first so ids and sorts stay predictable; photos are left untouched.
// The rows themselves live in seed-content.md — one `<!-- seed: ... -->`
// block per row — so the localized text stays out of code files (the
// copy-guard test allows Han text only inside src/shared/copy.ts and .md).
// Usage: node scripts/seed-dev-content.mjs

import { readFileSync } from 'node:fs';
import { openLocalDb } from './lib/local-db.mjs';

const db = openLocalDb();
const now = Date.now();

db.exec(`
  DELETE FROM votes;
  DELETE FROM reactions;
  DELETE FROM polls;
  DELETE FROM announcements;
  DELETE FROM feedback;
  DELETE FROM sqlite_sequence WHERE name IN ('polls', 'announcements', 'feedback');
`);

// Demo identities so reactions, votes, and feedback reference distinct users
// (id 0 is the root user; the sync flow reuses whatever already exists).
const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (id, uuid, created_at) VALUES (?, ?, ?)',
);
insertUser.run(0, 'seed-root-user', now - 90 * 86_400_000);
insertUser.run(1, 'seed-guest-one', now - 30 * 86_400_000);
insertUser.run(2, 'seed-guest-two', now - 12 * 86_400_000);

const AGE_UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };
function parseAge(text) {
  const match = /^(\d+)([mhd])$/.exec(text);
  if (!match) throw new Error(`seed block has a bad age: "${text}"`);
  return Number(match[1]) * AGE_UNITS[match[2]];
}

// --- Parse seed-content.md ------------------------------------------------

const doc = readFileSync(new URL('./seed-content.md', import.meta.url), 'utf8');
const rows = [...doc.matchAll(/<!-- seed: (.+?) -->\n([\s\S]*?)(?=\n<!-- seed: |$)/g)].map(
  (match) => {
    const [type, locale, sort, age, extra] = match[1].split('|').map((part) => part.trim());
    return { type, locale, sort: Number(sort), age: parseAge(age), extra, body: match[2].trim() };
  },
);
if (rows.length === 0) throw new Error('no seed blocks found in seed-content.md');

// --- Polls ----------------------------------------------------------------

const insertPoll = db.prepare(
  'INSERT INTO polls (options, allow_multiple, locale, sort, updated_at) VALUES (?, ?, ?, ?, ?)',
);
for (const row of rows.filter((r) => r.type === 'poll')) {
  const options = row.body.split('\n').map((line) => line.replace(/^-\s*/, ''));
  insertPoll.run(
    JSON.stringify(options),
    row.extra === 'multiple' ? 1 : 0,
    row.locale,
    row.sort,
    now - row.age,
  );
}

// --- Announcements --------------------------------------------------------

const insertAnnouncement = db.prepare(
  'INSERT INTO announcements (title, content_md, locale, sort, updated_at) VALUES (?, ?, ?, ?, ?)',
);
for (const row of rows.filter((r) => r.type === 'announcement')) {
  insertAnnouncement.run(row.extra, row.body, row.locale, row.sort, now - row.age);
}

// --- Feedback -------------------------------------------------------------
// Sort grows upward per locale (a fresh insert takes MIN(sort) - 1), so the
// lowest seeded sort is the newest entry on screen.

const insertFeedback = db.prepare(
  'INSERT INTO feedback (user_id, content_md, created_at, locale, sort) VALUES (?, ?, ?, ?, ?)',
);
for (const row of rows.filter((r) => r.type === 'feedback')) {
  insertFeedback.run(Number(row.extra), row.body, now - row.age, row.locale, row.sort);
}

// --- Votes & reactions (ASCII-only, so they stay in this script) ----------

const insertVote = db.prepare(
  'INSERT OR IGNORE INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)',
);
const pollIds = db
  .prepare('SELECT id FROM polls ORDER BY locale, sort')
  .all()
  .map((row) => row.id);
const seedVotes = [
  [pollIds[0], 1, 0],
  [pollIds[0], 2, 1],
  [pollIds[1], 1, 1],
  [pollIds[1], 1, 3],
  [pollIds[1], 2, 0],
  [pollIds[1], 2, 4],
  [pollIds[2], 2, 0],
  [pollIds[3], 1, 0],
  [pollIds[3], 2, 2],
  [pollIds[4], 1, 0],
  [pollIds[4], 2, 2],
  [pollIds[5], 1, 2],
  [pollIds[5], 2, 1],
];
for (const vote of seedVotes) insertVote.run(...vote);

// A sprinkle of reactions so the admin list pills are not all empty.
const insertReaction = db.prepare(
  'INSERT OR IGNORE INTO reactions (ann_id, user_id, emoji) VALUES (?, ?, ?)',
);
const announcementIds = db
  .prepare('SELECT id, locale, sort FROM announcements ORDER BY locale, sort')
  .all();
// [locale, sort, userId, emoji] — emoji values come from core EMOJI_SET.
const reactionSeed = [
  ['en-US', 0, 1, '👍'],
  ['en-US', 0, 2, '❤️'],
  ['en-US', 0, 2, '🔥'],
  ['en-US', 1, 1, '👍'],
  ['en-US', 2, 2, '😂'],
  ['zh-CN', 0, 1, '👍'],
  ['zh-CN', 0, 2, '❤️'],
  ['zh-CN', 1, 1, '🤔'],
];
for (const [locale, sort, userId, emoji] of reactionSeed) {
  const row = announcementIds.find((r) => r.locale === locale && r.sort === sort);
  if (row) insertReaction.run(row.id, userId, emoji);
}

// --- Summary --------------------------------------------------------------

const counts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM announcements) AS announcements,
       (SELECT COUNT(*) FROM polls) AS polls,
       (SELECT COUNT(*) FROM votes) AS votes,
       (SELECT COUNT(*) FROM reactions) AS reactions,
       (SELECT COUNT(*) FROM feedback) AS feedback`,
  )
  .get();
console.log('seeded local D1:', counts);
