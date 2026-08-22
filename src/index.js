/**
 * Infoto - Hono + Cloudflare Worker + D1
 * API 契约与原 KV 版本 100% 对齐，前端零改动
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cache } from 'hono/cache';
import {
    kvGet, kvPut, kvDelete,
    getPhoto, getAllPhotos, upsertPhoto, updatePhotoDims,
    getPhotoCount, deletePhoto,
    findBySha, setVote,
} from './db';

/* ---------- 速率限制（单 Worker 内存）---------- */
const rlBuckets = new Map();
function rlCheck(key, windowMs, max) {
    if (rlBuckets.size > 5000) rlBuckets.clear();
    const now = Date.now();
    let b = rlBuckets.get(key);
    if (!b) { b = { t: now, e: [] }; rlBuckets.set(key, b); }
    if (now - b.t > windowMs) { b.e = b.e.filter(t => now - t < windowMs); b.t = now; }
    if (b.e.length >= max) return false;
    b.e.push(now); return true;
}

const clientIp = (c) =>
    c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

/* ---------- 密码哈希 + Session ---------- */
const PBKDF2_ITER = 10000;
const SESS_TTL_MS = 7 * 24 * 3600 * 1000;
const SESS_TTL_SEC = 7 * 24 * 3600;

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
    const out = new Uint8Array(Math.max(0, Math.floor(hex.length / 2)));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    return out;
}
function randomTokenHex(n = 32) {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}
async function pbkdf2Hex(password, saltBytes, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password),
        { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
        keyMaterial, 256
    );
    return bytesToHex(new Uint8Array(derived));
}
async function hashPasswordForStorage(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2Hex(password, salt, PBKDF2_ITER);
    return 'PBKDF2$' + PBKDF2_ITER + '$' + bytesToHex(salt) + '$' + hash;
}
async function verifyPassword(input, stored) {
    const m = String(stored || '').match(/^PBKDF2\$(\d+)\$([0-9a-f]+)\$([0-9a-f]{64})$/i);
    if (!m) return { ok: false };
    try {
        const actual = await pbkdf2Hex(input, hexToBytes(m[2]), Number(m[1]));
        return { ok: actual === m[3] };
    } catch { return { ok: false }; }
}
async function createSession(db, adminHash) {
    const token = randomTokenHex(32);
    const sess = { adminHash, exp: Date.now() + SESS_TTL_MS };
    await kvPut(db, 'sess:' + token, JSON.stringify(sess), { expirationTtl: SESS_TTL_SEC });
    return token;
}
async function verifySessionToken(db, token) {
    if (!token) return false;
    const raw = await kvGet(db, 'sess:' + token);
    if (!raw) return false;
    try {
        const sess = JSON.parse(raw);
        if (sess.exp < Date.now()) return false;
        const curHash = await kvGet(db, 'admin_pw');
        return curHash && sess.adminHash === curHash;
    } catch { return false; }
}
async function destroySession(db, token) {
    if (token) await kvDelete(db, 'sess:' + token);
}
function parseCookies(req) {
    const c = req.header('Cookie');
    const out = {};
    if (!c) return out;
    for (const part of c.split(';')) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
    return out;
}
async function isAdmin(c) {
    const token = parseCookies(c.req)['admin_session'];
    return token && await verifySessionToken(c.env.DB, token);
}
function sessionCookieHeaders(token, req) {
    const h = new Headers();
    const isHttps = req.url.startsWith('https://');
    const isLocalhost = /^https?:\/\/localhost(:|\d|\/)/.test(req.url);
    const secureFlag = isHttps ? ' Secure;' : (isLocalhost ? '' : ' Secure;');
    h.set('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=${SESS_TTL_SEC}`);
    return h;
}

/* ---------- 工具：校验上传链接、分片合并流 ---------- */
async function isUploadedLink(db, parts) {
    for (const u of parts) {
        const rec = await kvGet(db, 'up:' + u);
        if (!rec) return false;
    }
    return true;
}
function sanitizePhoto(p) {
    const out = {};
    for (const k of ['id', 'parts', 'sha256', 'width', 'height', 'createdAt', 'ext', 'hasAudio']) {
        if (p[k] !== undefined) out[k] = p[k];
    }
    if (Array.isArray(out.parts)) {
        out.parts = out.parts.filter(u => typeof u === 'string' && /^https:\/\//i.test(u));
        if (out.parts.length === 0 || out.parts.length > 512) delete out.parts;
    } else {
        delete out.parts;
    }
    if (typeof out.createdAt === 'number' && isFinite(out.createdAt)) {
        out.createdAt = Math.max(0, Math.floor(out.createdAt));
    } else {
        delete out.createdAt;
    }
    for (const k of ['width', 'height']) {
        if (typeof out[k] === 'number' && isFinite(out[k]) && out[k] >= 0) {
            out[k] = Math.min(16384, Math.floor(out[k]));
        } else {
            delete out[k];
        }
    }
    if (typeof out.ext !== 'string' || !/^[a-z0-9]{1,12}$/i.test(out.ext)) delete out.ext;
    return out;
}

const SAFE_MIME = { webp: 'image/webp', webm: 'video/webm' };
function mimeFromExt(ext) {
    return SAFE_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}
function safeDisposition(filename, forceDownload = true) {
    const safe = String(filename || 'download').replace(/[\x00-\x1F\x7F]/g, '');
    const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(safe).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16));
    const type = forceDownload ? 'attachment' : 'inline';
    return `${type}; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
}
function limitBodySize(readable, maxBytes) {
    let read = 0;
    const ts = new TransformStream({
        transform(chunk, controller) {
            read += chunk.byteLength;
            if (read > maxBytes) {
                const err = new Error('payload too large');
                err.code = 'PAYLOAD_TOO_LARGE';
                controller.error(err);
                return;
            }
            controller.enqueue(chunk);
        }
    });
    return readable.pipeThrough(ts);
}
async function* _partsBytes(parts, tcHeaders, timeoutMs = 30000) {
    for (const part of parts) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        let r;
        try {
            r = await fetch(part, { headers: tcHeaders, redirect: 'follow', signal: ac.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!r.ok || !r.body) throw new Error('part fetch failed ' + r.status);
        const br = r.body.getReader();
        while (true) {
            const { done, value } = await br.read();
            if (done) break;
            yield value;
        }
    }
}
function mergePartsAsStream(parts, tcHeaders) {
    const gen = _partsBytes(parts, tcHeaders);
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await gen.next();
                if (done) controller.close();
                else controller.enqueue(value);
            } catch (e) { controller.error(e); }
        },
        cancel() { if (gen && gen.return) { try { gen.return(); } catch { } } }
    });
}
async function makeTcToken(secret, sha) {
    const enc = new TextEncoder();
    const b64u = (bytes) => {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const claims = { timestamp: Date.now() };
    if (sha) claims.sha256 = sha;
    const payload = b64u(enc.encode(JSON.stringify(claims)));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(header + '.' + payload)));
    return `${header}.${payload}.${b64u(sig)}`;
}
function isValidPhotoId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 200
        && !id.includes('/') && !/[\x00-\x1F\x7F]/.test(id);
}

/* ================================================================
   Hono App
   ================================================================ */

const app = new Hono();

app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-File-Sha256', 'X-Anon-Id'],
    maxAge: 86400,
}));

app.options('*', (c) => c.body(null, 204));

/* ---------------- /api/photos ---------------- */

app.get('/api/photos',
    cache({
        cacheName: 'infoto-list',
        cacheControl: 'public, s-maxage=30',
        wait: false,
    }),
    async (c) => {
        const limit = Math.max(0, Math.min(100000, Number(c.req.query('limit') || 'Infinity')));
        const offset = Math.max(0, Number(c.req.query('offset') || '0'));
        const arr = await getAllPhotos(c.env.DB, { limit, offset });
        return c.json(arr);
    }
);

app.post('/api/photos', async (c) => {
    const ip = clientIp(c);
    if (!rlCheck('photos:' + ip, 5 * 60 * 1000, 300)) return c.json({ error: 'too many requests' }, 429);

    const cl = Number(c.req.header('Content-Length') || 0);
    if (cl > 512 * 1024) return c.json({ error: 'payload too large' }, 413);

    let body;
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'bad json' }, 400); }

    if (!body || typeof body !== 'object' || Array.isArray(body))
        return c.json({ error: 'expected photo object' }, 400);
    if (!body.id) return c.json({ error: 'missing id' }, 400);

    const clean = sanitizePhoto(body);
    if (!clean.parts) return c.json({ error: 'missing valid parts' }, 400);
    if (!(await isUploadedLink(c.env.DB, clean.parts)))
        return c.json({ error: 'invalid parts: not uploaded via proxy' }, 400);

    const existing = await getPhoto(c.env.DB, clean.id);
    const merged = {
        ...clean,
        likes: existing && typeof existing.likes === 'number' ? existing.likes : 0,
        dislikes: existing && typeof existing.dislikes === 'number' ? existing.dislikes : 0,
    };
    await upsertPhoto(c.env.DB, merged, !existing);

    const count = await getPhotoCount(c.env.DB);

    try {
        const key = new Request(c.req.url, { method: 'GET' });
        await caches.default.delete(key);
    } catch { /* ignore */ }

    return c.json({ ok: true, count });
});

app.patch('/api/photos/dims', async (c) => {
    const ip = clientIp(c);
    if (!rlCheck('dims:' + ip, 60 * 1000, 60)) return c.json({ error: 'too many requests' }, 429);

    const cl = Number(c.req.header('Content-Length') || 0);
    if (cl > 256 * 1024) return c.json({ error: 'payload too large' }, 413);

    let body;
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'bad json' }, 400); }

    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) return c.json({ ok: true, updated: 0 });
    if (updates.length > 200) return c.json({ error: 'too many updates (>200)' }, 400);

    let updated = 0;
    for (const u of updates) {
        if (!u?.id) continue;
        const id = String(u.id);
        const w = Number(u.width) | 0;
        const h = Number(u.height) | 0;
        if (!w || !h || w <= 0 || w > 16384 || h <= 0 || h > 16384) continue;
        if (await updatePhotoDims(c.env.DB, id, w, h)) updated++;
    }

    if (updated > 0) {
        try {
            const key = new Request(new URL(c.req.url).origin + '/api/photos', { method: 'GET' });
            await caches.default.delete(key);
        } catch { /* ignore */ }
    }
    return c.json({ ok: true, updated });
});

app.delete('/api/photos/:id', async (c) => {
    if (!(await isAdmin(c))) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');
    if (!isValidPhotoId(id)) return c.json({ error: 'invalid id' }, 400);
    await deletePhoto(c.env.DB, id);
    try {
        const key = new Request(new URL(c.req.url).origin + '/api/photos', { method: 'GET' });
        await caches.default.delete(key);
    } catch { /* ignore */ }
    return c.json({ ok: true });
});

/* ---------------- 哈希查重 ---------------- */

app.get('/api/photos/hash/:sha', async (c) => {
    const sha = c.req.param('sha').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'bad hash' }, 400);
    const photo = await findBySha(c.env.DB, sha);
    return photo ? c.json({ exists: true, photo }) : c.json({ exists: false });
});

/* ---------------- 投票 ---------------- */

app.post('/api/vote', async (c) => {
    const ip = clientIp(c);
    if (!rlCheck('vote:' + ip, 10 * 1000, 10)) return c.json({ error: 'too many votes' }, 429);

    const anon = String(c.req.header('X-Anon-Id') || '').slice(0, 128);
    const voter = anon || ip;

    let body;
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'bad json' }, 400); }

    const id = body?.id;
    const delta = body?.delta;
    if (!id || (delta !== 1 && delta !== -1 && delta !== 0))
        return c.json({ error: 'bad vote payload' }, 400);

    const photo = await getPhoto(c.env.DB, id);
    if (!photo) return c.json({ error: 'photo not found' }, 404);

    const { likes, dislikes } = await setVote(c.env.DB, id, voter, delta);

    try {
        const key = new Request(new URL(c.req.url).origin + '/api/photos', { method: 'GET' });
        await caches.default.delete(key);
    } catch { /* ignore */ }

    return c.json({ ok: true, delta, likes, dislikes });
});

/* ---------------- 管理员 ---------------- */

app.get('/api/admin/check', async (c) => {
    const hash = await kvGet(c.env.DB, 'admin_pw');
    if (!hash) return c.json({ ok: false, setup: true });
    return c.json({ ok: await isAdmin(c) });
});

app.post('/api/admin/login', async (c) => {
    const ip = clientIp(c);
    if (!rlCheck('admin-login:' + ip, 60 * 1000, 5))
        return c.json({ error: 'too many attempts, try again later' }, 429);

    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const pw = body?.password;
    if (!pw) return c.json({ error: 'missing password' }, 400);

    let stored = await kvGet(c.env.DB, 'admin_pw');
    if (!stored) {
        const preset = c.env.ADMIN_PASSWORD;
        if (preset) {
            if (preset !== pw) return c.json({ error: 'wrong password' }, 401);
            stored = await hashPasswordForStorage(preset);
        } else {
            stored = await hashPasswordForStorage(pw);
        }
        await kvPut(c.env.DB, 'admin_pw', stored);
    } else {
        const vr = await verifyPassword(pw, stored);
        if (!vr.ok) return c.json({ error: 'wrong password' }, 401);
    }
    const token = await createSession(c.env.DB, stored);
    const headers = sessionCookieHeaders(token, c.req);
    return c.json({ ok: true }, 200, Object.fromEntries(headers));
});

app.post('/api/admin/change', async (c) => {
    if (!(await isAdmin(c))) return c.json({ error: 'unauthorized' }, 401);
    const oldToken = parseCookies(c.req)['admin_session'];
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const pw = body?.password;
    if (!pw || String(pw).length < 4) return c.json({ error: 'password too short' }, 400);
    const hash = await hashPasswordForStorage(pw);
    await kvPut(c.env.DB, 'admin_pw', hash);
    if (oldToken) destroySession(c.env.DB, oldToken).catch(() => { });
    const newToken = await createSession(c.env.DB, hash);
    const headers = sessionCookieHeaders(newToken, c.req);
    return c.json({ ok: true }, 200, Object.fromEntries(headers));
});

app.post('/api/admin/logout', async (c) => {
    const tok = parseCookies(c.req)['admin_session'];
    if (tok) destroySession(c.env.DB, tok).catch(() => { });
    const isHttps = c.req.url.startsWith('https://');
    const isLocalhost = /^https?:\/\/localhost(:|\d|\/)/.test(c.req.url);
    const secureFlag = isHttps ? ' Secure;' : (isLocalhost ? '' : ' Secure;');
    return c.json({ ok: true }, 200, {
        'Set-Cookie': `admin_session=; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=0`,
    });
});

/* ---------------- 上传代理 ---------------- */

app.post('/api/upload-proxy', async (c) => {
    const tcSecret = c.env.TC_SECRET || c.env.TC_SECRET_DEV || '9a31f2e82617e4b4b482110f8c928b9b2734d809f060c30f12e8b2574a84c122';
    const MAX_PAYLOAD = 25 * 1024 * 1024;

    const body = c.req.body ? limitBodySize(c.req.body, MAX_PAYLOAD) : null;
    const sha = c.req.header('X-File-Sha256') || '';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);

    try {
        const token = await makeTcToken(tcSecret, sha);
        const headers = new Headers();
        const ct = c.req.header('Content-Type') || 'application/octet-stream';
        headers.set('Content-Type', ct);
        headers.set('X-Auth-Token', token);

        const upstream = await fetch('https://tc.0147258.xyz/upload', {
            method: 'POST', headers, body, duplex: 'half', signal: ac.signal,
        });
        clearTimeout(timer);

        const bodyText = await upstream.text();
        try {
            const j = JSON.parse(bodyText);
            const data = j && typeof j.data === 'string' ? j.data : '';
            if (data && /^https:\/\//i.test(data)) {
                await kvPut(c.env.DB, 'up:' + data, '1', { expirationTtl: 7 * 24 * 3600 });
            }
        } catch { /* non-JSON ignore */ }

        return new Response(bodyText, {
            status: upstream.status,
            headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
        });
    } catch (e) {
        clearTimeout(timer);
        const timedOut = ac.signal.aborted;
        if (e?.code === 'PAYLOAD_TOO_LARGE') return c.json({ error: 'payload too large' }, 413);
        return c.json(
            { error: timedOut ? 'proxy upstream timeout' : 'proxy upstream error: ' + e.message },
            timedOut ? 504 : 502
        );
    }
});

/* ---------------- 取图 / 分片合并 ---------------- */

app.get('/api/file/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidPhotoId(id)) return c.json({ error: 'invalid id' }, 400);

    const p = await getPhoto(c.env.DB, id);
    if (!p) return c.json({ error: 'not found' }, 404);

    const parts = Array.isArray(p.parts) && p.parts.length ? p.parts : [];
    if (!parts.length) return c.json({ error: 'no parts' }, 404);

    const forceDownload = c.req.query('dl') !== undefined;
    if (!p.ext) return c.json({ error: 'photo missing ext' }, 500);

    const ext = String(p.ext).toLowerCase();
    const dlName = p.id + '.' + ext;
    const ct = mimeFromExt(ext);
    const isSafe = ct.startsWith('image/') || ct.startsWith('video/');

    const fhdrs = {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
    };
    if (forceDownload || !isSafe) {
        fhdrs['Content-Disposition'] = safeDisposition(dlName, forceDownload || !isSafe);
    }

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const tcHeaders = { 'User-Agent': ua, 'Referer': 'https://inf.prom.cc.cd/', 'Accept': '*/*' };

    if (parts.length === 1) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 30000);
        try {
            const r = await fetch(parts[0], { headers: tcHeaders, redirect: 'follow', signal: ac.signal });
            clearTimeout(timer);
            if (r.ok) {
                const cl = r.headers.get('Content-Length');
                if (cl) fhdrs['Content-Length'] = cl;
                return new Response(r.body, { status: 200, headers: fhdrs });
            }
            return c.json({ error: 'upstream rejected ' + r.status }, 502);
        } catch (e) {
            clearTimeout(timer);
            return c.json({ error: 'upstream fetch failed: ' + e.message }, 502);
        }
    }

    try {
        const readable = mergePartsAsStream(parts, tcHeaders);
        return new Response(readable, { status: 200, headers: fhdrs });
    } catch (e) {
        return c.json({ error: 'merge error: ' + e.message }, 502);
    }
});

/* ---------------- 静态资源 ---------------- */

app.get('/admin', async (c) => {
    const url = new URL('/admin.html', new URL(c.req.url).origin);
    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});
app.get('/admin/', async (c) => {
    const url = new URL('/admin.html', new URL(c.req.url).origin);
    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

app.get('*', async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;