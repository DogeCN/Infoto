#!/usr/bin/env node
// Seed an empty local D1 using the running Worker. Use the all-zero root UUID and refuse populated content tables.
// --local-media inserts local fixture URLs instead of uploading to the image host.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openLocalDb } from './lib/local-db.mjs';
import { MEDIA } from './seed-media-manifest.mjs';

const TRANSCODED_DIR = path.join(import.meta.dirname, 'seed-media', 'transcoded');
const baseOf = (n) => n.replace(/\.[^.]+$/, '');

const BASE = process.env.SEED_BASE || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname))
  throw new Error('SEED_BASE must point to a loopback Worker; remote seeding is disabled');
// Any non-empty value: the local deployment answers with the always-pass test secret.
const TURNSTILE_TOKEN = 'seed';
const ROOT_UUID = '00000000-0000-0000-0000-000000000000';

const localMedia = process.argv.includes('--local-media');
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

function log(...a) {
  console.log('[seed]', ...a);
}

async function httpPost(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) };
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const setCookie = res.headers.get('set-cookie');
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON / empty */
  }
  return { status: res.status, setCookie, data };
}

async function createUser() {
  const { status, setCookie, data } = await httpPost('/sync', {
    turnstileToken: TURNSTILE_TOKEN,
    ops: [],
  });
  if (status !== 200 || !data?.ok) throw new Error(`identity creation failed (status ${status})`);
  return { cookie: setCookie.split(';')[0], id: data.selfId };
}

async function uploadMedia(bytes, mime, name, cookie) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), name);
  const res = await fetch(BASE + '/upload', {
    method: 'POST',
    body: fd,
    headers: { cookie },
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json().catch(() => null);
  const url = j?.data ?? j?.url;
  if (res.status < 200 || res.status >= 300 || !url) {
    throw new Error(`/upload failed (status ${res.status}): ${j ? JSON.stringify(j) : 'no body'}`);
  }
  return url;
}

async function syncOps(cookie, ops) {
  const { status, data } = await httpPost('/sync', { ops }, cookie);
  if (!data?.ok)
    throw new Error(`/sync failed (status ${status}): ${data ? JSON.stringify(data) : ''}`);
  return data;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Final dimensions come from the transcoded artifact (WebP/WebM) via ffprobe.
function ffprobeDims(file) {
  try {
    const out = execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        file,
      ],
      { encoding: 'utf8' },
    );
    const [w, h] = out
      .trim()
      .split(',')
      .map((n) => Number(n));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  } catch {
    /* Report unavailable dimensions to the caller. */
  }
  return null;
}

async function main() {
  if (!existsSync(TRANSCODED_DIR))
    throw new Error(
      `missing ${TRANSCODED_DIR} — run "npm run seed:media" then "npm run seed:transcode" first`,
    );
  const db = openLocalDb();
  try {
    for (const table of ['photos', 'announcements', 'feedback']) {
      if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0)
        throw new Error(`${table} is not empty; existing data was left unchanged`);
    }
    for (const spec of MEDIA) {
      const file = path.join(
        TRANSCODED_DIR,
        `${baseOf(spec.name)}.${spec.type === 0 ? 'webp' : 'webm'}`,
      );
      if (!existsSync(file))
        throw new Error(`Missing ${file}; prepare all seed media before seeding`);
      if (!ffprobeDims(file))
        throw new Error(`Cannot inspect ${file}; install ffprobe or set FFPROBE_BIN`);
    }
    if (
      !localMedia &&
      !process.env.TC_SECRET &&
      !/^[ \t]*TC_SECRET\s*=\s*\S+/m.test(
        existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '',
      )
    )
      throw new Error(
        'TC_SECRET is not configured. Configure the image host or use --local-media for offline fixtures.',
      );
    if (!db.prepare('SELECT id FROM users WHERE id = 0').get()) await createUser();
    db.prepare('UPDATE users SET uuid = ? WHERE id = 0').run(ROOT_UUID);
    const root = { id: 0, cookie: `uuid=${ROOT_UUID}` };
    const snap = await syncOps(root.cookie, []);
    if (snap.photos.length > 0) {
      throw new Error(
        `photos table not empty (${snap.photos.length} rows) — run "npm run db:reset" first`,
      );
    }
    const existing = (id) => {
      const user = db.prepare('SELECT id, uuid FROM users WHERE id = ?').get(id);
      return user ? { id: user.id, cookie: `uuid=${user.uuid}` } : createUser();
    };
    const A = await existing(1);
    const B = await existing(2);
    const C = await existing(3);
    const users = { root, A, B, C };
    log(`identities: root=${root.id} A=${A.id} B=${B.id} C=${C.id}`);

    // Upload transcoded WebP and WebM artifacts and insert their metadata.
    const shas = [];
    // name → image-host URL, so other seeded content can reference real uploads
    // instead of inventing external links (everything visible must be on our host).
    const uploadedUrls = {};
    for (const spec of MEDIA) {
      const ext = spec.type === 0 ? 'webp' : 'webm';
      const fname = `${baseOf(spec.name)}.${ext}`;
      const fp = path.join(TRANSCODED_DIR, fname);
      const buf = readFileSync(fp);
      const dims = ffprobeDims(fp);
      if (!dims) throw new Error(`Cannot inspect ${fp}`);
      const mime = spec.type === 0 ? 'image/webp' : 'video/webm';
      const cookie = users[spec.uploader].cookie;
      try {
        const url = localMedia
          ? `/__seed-media/${fname}`
          : await uploadMedia(buf, mime, fname, cookie);
        const payload = {
          sha256: sha256Hex(buf),
          url,
          width: dims.w,
          height: dims.h,
          size: buf.length,
          type: spec.type,
        };
        if (localMedia) {
          db.prepare(
            `INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            payload.sha256,
            url,
            users[spec.uploader].id,
            payload.width,
            payload.height,
            payload.size,
            Date.now() - (MEDIA.length - shas.length) * 3_600_000,
            payload.type,
          );
        } else {
          await syncOps(cookie, [{ type: 'upload', target: null, payload }]);
        }
        shas.push(payload.sha256);
        uploadedUrls[spec.name] = url;
        log(
          `photo ${fname} (${dims.w}x${dims.h}, type=${spec.type}, ${buf.length} bytes) → ${url}`,
        );
      } catch (e) {
        throw new Error(
          `Seeding stopped at ${fname}: ${e.message}. Check local data before retrying.`,
          { cause: e },
        );
      }
    }
    log(`inserted ${shas.length} photos`);

    // ---- likes / dislikes / reports: vary coverage across photos -------------
    // index → marks; user ids reference the four identities above.
    const marks = {
      0: { likes: ['A', 'B', 'C', 'root'] },
      1: { dislikes: ['A', 'B'] },
      2: { likes: ['A', 'C'], dislikes: ['B'] },
      3: { reports: ['B', 'C'] },
      4: { likes: ['C'] },
      5: { likes: ['A', 'B'], dislikes: ['C'] },
      6: { reports: ['A'] },
      7: { likes: ['root'] },
      8: { dislikes: ['A', 'B', 'C'] },
      9: { likes: ['A', 'B', 'C', 'root'] },
      10: { likes: ['B', 'C'] },
      11: { reports: ['A', 'B', 'C'] },
      12: { likes: ['A'] },
      13: { dislikes: ['C'] },
      14: { likes: ['B', 'root'] },
      15: { reports: ['B'] },
      16: { likes: ['A', 'B', 'C'] },
      17: { dislikes: ['A'] },
      18: { likes: ['root', 'C'] },
      19: { reports: ['C'] },
      20: { likes: ['A', 'B'] },
      21: { dislikes: ['B', 'C'] },
    };
    for (const [idxStr, m] of Object.entries(marks)) {
      const idx = Number(idxStr);
      if (idx >= shas.length) continue;
      const sha = shas[idx];
      for (const u of m.likes ?? [])
        await syncOps(users[u].cookie, [{ type: 'like', targetSha: sha }]);
      for (const u of m.dislikes ?? [])
        await syncOps(users[u].cookie, [{ type: 'dislike', targetSha: sha }]);
      for (const u of m.reports ?? [])
        await syncOps(users[u].cookie, [{ type: 'report', targetSha: sha }]);
    }
    log('applied like/dislike/report marks');

    // ---- announcements (root) + votes + reactions ---------------------------
    const mkAnn = async (title, contentMd) => {
      const { status, data } = await httpPost(
        '/admin/announcements',
        { title, contentMd },
        root.cookie,
      );
      if (!data?.ok)
        throw new Error(`announcement create failed (status ${status}): ${JSON.stringify(data)}`);
      return data.announcement.id;
    };

    // The example image reuses the uploaded img-9 artifact, so the announcement never
    // links off-host: every rendered asset comes from the image host like user uploads.
    const ann1Image = uploadedUrls['img-9.jpg'];
    const ann1 = await mkAnn(
      '投票：下一期拍摄主题',
      '## 下一期活动主题\n请选择你最感兴趣的方向，我们会根据结果安排。\n\n:::vote 城市夜景 | 自然风光\n\n投票后可在下方发表意见。' +
        (ann1Image ? `\n\n![示例](${ann1Image})` : ''),
    );
    await syncOps(A.cookie, [{ type: 'vote', target: ann1, payload: { option: 0 } }]);
    await syncOps(B.cookie, [{ type: 'vote', target: ann1, payload: { option: 1 } }]);
    await syncOps(C.cookie, [{ type: 'vote', target: ann1, payload: { option: 0 } }]);
    await syncOps(root.cookie, [{ type: 'vote', target: ann1, payload: { option: 0 } }]);
    await syncOps(A.cookie, [{ type: 'react', target: ann1, payload: { emoji: '👍' } }]);
    await syncOps(B.cookie, [{ type: 'react', target: ann1, payload: { emoji: '🔥' } }]);
    log(`announcement ${ann1} with 4 votes + 2 reactions`);

    const ann2 = await mkAnn(
      '站务公告',
      '系统将于本周末凌晨进行例行维护，期间上传与同步功能可能短暂不可用。\n\n维护完成后将恢复，感谢大家的支持！',
    );
    await syncOps(A.cookie, [{ type: 'react', target: ann2, payload: { emoji: '❤️' } }]);
    await syncOps(B.cookie, [{ type: 'react', target: ann2, payload: { emoji: '👍' } }]);
    await syncOps(C.cookie, [{ type: 'react', target: ann2, payload: { emoji: '😮' } }]);
    log(`announcement ${ann2} with 3 reactions`);

    const ann3 = await mkAnn(
      '欢迎来到 Infoto',
      '欢迎！这里是大家的共享相册，上传你的照片、为喜欢的照片点赞、在公告里投票或留言吧。',
    );
    log(`announcement ${ann3} (plain)`);

    // ---- feedback (several users) -------------------------------------------
    const fb = [
      { u: 'A', md: '希望可以支持批量上传，一次选多张照片。' },
      { u: 'B', md: '移动端上传按钮有点小，建议放大一点。' },
      { u: 'C', md: '能不能加一个按时间排序的视图？' },
      { u: 'root', md: '已知问题：超大视频上传较慢，正在优化中。' },
    ];
    for (const f of fb) {
      await syncOps(users[f.u].cookie, [{ type: 'fb_create', payload: { contentMd: f.md } }]);
    }
    log(`inserted ${fb.length} feedback items`);

    const finalSnap = await syncOps(root.cookie, []);
    log(
      `DONE — photos=${finalSnap.photos.length} announcements=${finalSnap.announcements.length} feedback=${finalSnap.feedback.length}`,
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('[seed] FATAL', error.message);
  process.exitCode = 1;
});
