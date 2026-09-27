#!/usr/bin/env node
// Seed the local D1 with fake data for manual testing.
//
// What it does
//   - reads the *transcoded* sample media from scripts/seed-media/transcoded/
//     (produced by `npm run seed:transcode`, which is the Node-side reproduction of
//     the browser pipeline: still → WebP, animated/video → WebM) — no runtime
//     network needed for the media bytes themselves,
//   - pushes each file through the real POST /upload proxy (the URL-producing stage
//     of the upload pipeline) so photos.url is a genuine image-host direct URL,
//   - inserts photo rows via POST /sync `upload` ops,
//   - then layers on likes / dislikes / reports, announcements (with a vote block +
//     reactions) and feedback to maximise feature coverage,
//   - finally pins the seeded root user's uuid to all-zeros so it is deterministic
//     across reseeds and easy to target in manual tests (relationships in the DB
//     reference users by id, not uuid, so this is safe).
//
// Requires a local Worker on SEED_BASE (default http://127.0.0.1:8787). If none is
// listening the script spawns its own `wrangler dev --port 8787`, waits for it, and
// tears it down afterwards. The DB must be empty (run `npm run db:reset` first);
// a non-empty photos table aborts.

import { execFileSync, execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MEDIA } from './seed-media-manifest.mjs';

const TRANSCODED_DIR = path.join(import.meta.dirname, 'seed-media', 'transcoded');
const baseOf = (n) => n.replace(/\.[^.]+$/, '');

const BASE = process.env.SEED_BASE || 'http://127.0.0.1:8787';
// Any non-empty value: the local deployment answers with the always-pass test secret.
const TURNSTILE_TOKEN = 'seed';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log('[seed]', ...a);
}

async function httpPost(path, body, cookie) {
  const headers = cookie ? { cookie } : { 'Content-Type': 'application/json' };
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
  return { cookie: setCookie, id: data.selfId };
}

async function uploadMedia(bytes, mime, name, cookie) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), name);
  const res = await fetch(BASE + '/upload', { method: 'POST', body: fd, headers: { cookie } });
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
      'ffprobe',
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
      { shell: true, encoding: 'utf8' },
    );
    const [w, h] = out
      .trim()
      .split(',')
      .map((n) => Number(n));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  } catch {
    /* fall back to manifest dims */
  }
  return null;
}

// Free the port so the seed always owns its Worker and writes to the same local D1
// file we inspect afterwards.
function killPort(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if($c){Stop-Process -Id $c.OwningProcess -Force}"`,
      { stdio: 'ignore' },
    );
  } catch {
    /* nothing listening */
  }
}

async function ensureWorker() {
  killPort(8787);
  await delay(1000);
  try {
    const r = await fetch(BASE + '/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"ops":[]}',
    });
    if (r.status > 0) {
      log('using existing Worker on', BASE);
      return null;
    }
  } catch {
    /* not up — spawn our own */
  }
  log('no Worker on', BASE, '— spawning a temporary one...');
  const child = spawn(
    process.execPath,
    ['--use-system-ca', 'node_modules/wrangler/bin/wrangler.js', 'dev', '--port', '8787'],
    { cwd: process.cwd(), stdio: 'ignore' },
  );
  const deadline = Date.now() + 120_000;
  for (;;) {
    await delay(1500);
    try {
      const r = await fetch(BASE + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ops":[]}',
      });
      if (r.status > 0) {
        log('temporary Worker ready');
        return child;
      }
    } catch {
      /* keep waiting */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('timed out waiting for temporary Worker');
    }
  }
}

async function main() {
  if (!existsSync(TRANSCODED_DIR))
    throw new Error(
      `missing ${TRANSCODED_DIR} — run "npm run seed:media" then "npm run seed:transcode" first`,
    );
  const child = await ensureWorker();
  try {
    const root = await createUser();
    const snap = await syncOps(root.cookie, []);
    if (snap.photos.length > 0) {
      throw new Error(
        `photos table not empty (${snap.photos.length} rows) — run "npm run db:reset" first`,
      );
    }
    const A = await createUser();
    const B = await createUser();
    const C = await createUser();
    const users = { root, A, B, C };
    log(`identities: root=${root.id} A=${A.id} B=${B.id} C=${C.id}`);

    // ---- media: read transcoded artifact → upload → insert photo row ---------
    // Each raw file was already converted to the pipeline's output format: WebP for
    // stills, WebM for animated/video. We upload those artifacts, so photos.url ends up
    // pointing at a WebP/WebM file the renderer decodes natively (no 200 fallback).
    const shas = [];
    // name → image-host URL, so other seeded content can reference real uploads
    // instead of inventing external links (everything visible must be on our host).
    const uploadedUrls = {};
    for (const spec of MEDIA) {
      const ext = spec.type === 0 ? 'webp' : 'webm';
      const fname = `${baseOf(spec.name)}.${ext}`;
      const fp = path.join(TRANSCODED_DIR, fname);
      if (!existsSync(fp)) {
        log(`SKIP missing transcoded ${fname} — run npm run seed:transcode`);
        continue;
      }
      const buf = readFileSync(fp);
      const dims = ffprobeDims(fp) ?? (spec.type === 1 ? { w: 1, h: 1 } : { w: spec.w, h: spec.h });
      const mime = spec.type === 0 ? 'image/webp' : 'video/webm';
      const cookie = users[spec.uploader].cookie;
      try {
        const url = await uploadMedia(buf, mime, fname, cookie);
        const payload = {
          sha256: sha256Hex(buf),
          url,
          width: dims.w,
          height: dims.h,
          size: buf.length,
          type: spec.type,
        };
        await syncOps(cookie, [{ type: 'upload', target: null, payload }]);
        shas.push(payload.sha256);
        uploadedUrls[spec.name] = url;
        log(
          `photo ${fname} (${dims.w}x${dims.h}, type=${spec.type}, ${buf.length} bytes) → ${url}`,
        );
      } catch (e) {
        log(`photo ${fname} FAILED: ${e.message}`);
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
    await syncOps(B.cookie, [{ type: 'react', target: ann1, payload: { emoji: '🎉' } }]);
    log(`announcement ${ann1} with 4 votes + 2 reactions`);

    const ann2 = await mkAnn(
      '站务公告',
      '系统将于本周末凌晨进行例行维护，期间上传与同步功能可能短暂不可用。\n\n维护完成后将恢复，感谢大家的支持！',
    );
    await syncOps(A.cookie, [{ type: 'react', target: ann2, payload: { emoji: '❤️' } }]);
    await syncOps(B.cookie, [{ type: 'react', target: ann2, payload: { emoji: '👍' } }]);
    await syncOps(C.cookie, [{ type: 'react', target: ann2, payload: { emoji: '🚀' } }]);
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
    if (child) {
      child.kill('SIGKILL');
      log('temporary Worker stopped');
    }
  }
}

/** Rewrite the seeded root user's uuid to all-zeros so reseeds are reproducible. */
async function pinRootUuid() {
  const { DatabaseSync } = await import('node:sqlite');
  const ALL_ZERO = '00000000-0000-0000-0000-000000000000';
  const root = path.resolve(import.meta.dirname, '..');
  const dir = path.join(root, '.wrangler', 'state', 'v3', 'd1');
  if (!existsSync(dir)) return;
  const files = readdirSync(dir, { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.sqlite') && !f.includes('metadata.'))
    .map((f) => path.join(dir, f));
  for (const file of files) {
    try {
      const db = new DatabaseSync(file);
      const before = db.prepare('SELECT uuid FROM users WHERE id = 0').get()?.uuid;
      if (!before) {
        db.close();
        continue;
      }
      db.prepare('UPDATE users SET uuid = ? WHERE id = 0').run(ALL_ZERO);
      db.close();
      log(`pinned root uuid: ${before} → ${ALL_ZERO}`);
      return;
    } catch {
      /* no users table in this file */
    }
  }
  log('could not locate DB to pin root uuid — skipping');
}

main()
  .then(() => pinRootUuid())
  .catch((e) => {
    console.error('[seed] FATAL', e.message);
    process.exit(1);
  });
