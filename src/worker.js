/**
 * Infoto - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 托管静态前端（public/，经 ASSETS 绑定）
 *   2. /api/photos  —— 照片元数据读写（KV 持久化，按 id 拆分存储）
 *   3. /api/vote    —— 按 IP 防重的喜欢/不喜欢投票
 *   4. /api/photos/hash —— SHA-256 查重（O(1) 反向索引）
 *   5. /api/file —— 多分片文件在边缘 Worker 内合并还原为完整文件（200 直出）
 *
 * KV 存储结构：
 *   p:<id>        → 单张元数据（含服务端权威的 likes/dislikes）
 *   photo_ids     → 有序 id 列表 [id...]（最新在前）
 *   sha:<hash>    → 对应 photoId（查重反向索引）
 *   votes:<id>    → { likes:[ip...], dislikes:[ip...] }（投票真值源）
 *   admin_pw      → PBKDF2$<iter>$<saltHex>$<hashHex>（唯一格式，不再兼容旧格式）
 *   sess:<token>  → { adminHash, exp }（随机 Session Token，带过期）
 *
 * 上传统一由浏览器经 /api/upload-proxy 中转 tc 图床（Worker 可访问 tc，/api/file 200 直出字节供外部抓取）；
 * 取图时由本服务端合并还原。图片统一 WebP/WebM 格式，压缩在浏览器端完成，服务端不做转码。
 */

// 速率限制桶（单 Worker 实例内存；Cloudflare 无共享内存，单实例内有效）
const rlBuckets = new Map();
const RL_MAX_BUCKETS = 5000;
function rlCheck(key, windowMs, max) {
  // 防内存无限增长：桶数超上限时整体清空（低危：瞬时放开速率限制）
  if (rlBuckets.size > RL_MAX_BUCKETS) rlBuckets.clear();
  const now = Date.now();
  let b = rlBuckets.get(key);
  if (!b) { b = { t: now, e: [] }; rlBuckets.set(key, b); }
  if (now - b.t > windowMs) { b.e = b.e.filter(t => now - t < windowMs); b.t = now; }
  if (b.e.length >= max) return false;
  b.e.push(now); return true;
}

// 进程内互斥（Promise 链）：KV 的 read-modify-write 非原子，并发写会丢更新（如 photo_ids 并发 unshift）
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS（方便前端若部署到其它域名）
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Sha256',
      'Access-Control-Max-Age': '86400',
    };
    // 图片资源需要 CORS 放行（前端跨域取尺寸/复制图片），由 /api/file 单独追加
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 注：写接口不设同源校验——CORS * 的设计意图就是"前端可部署到其它域名"，
    // 匿名上传/投票本身接受公开写入，速率限制（rlCheck）已兜底防滥用。

    /* ---------- 照片元数据 API ---------- */
    if (path === '/api/photos') {
      if (request.method === 'GET') {
        const limit = Math.max(0, Math.min(100000, Number(url.searchParams.get('limit') || 'Infinity')));
        const offset = Math.max(0, Number(url.searchParams.get('offset') || '0'));
        const arr = await getAllPhotos(env, { limit, offset });
        return json(cors, arr);
      }
      if (request.method === 'POST') {
        // 按 id upsert 单条（禁止整组覆盖，防止无鉴权清空/篡改整个相册）
        try {
          // 元数据体很小，预检 Content-Length 防超大 JSON 撑爆内存
          const cl = Number(request.headers.get('Content-Length') || 0);
          if (cl > 512 * 1024) return json(cors, { error: 'payload too large' }, 413);
          const body = await request.json();
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json(cors, { error: 'expected photo object' }, 400);
          }
          if (!body.id) return json(cors, { error: 'missing id' }, 400);
          const clean = sanitizePhoto(body);
          if (!clean.parts) return json(cors, { error: 'missing valid parts' }, 400);
          // parts 必须全部出自本 worker 上传代理（防任意 URL 投毒/SSRF）
          if (!(await isUploadedLink(env, clean.parts))) {
            return json(cors, { error: 'invalid parts: not uploaded via proxy' }, 400);
          }
          // 保留服务端权威计数（图片 onload 回写尺寸时也走这里，不能清掉投票数）
          const existing = await env.Infoto.get('p:' + clean.id, 'json');
          const merged = {
            ...clean,
            likes: existing && typeof existing.likes === 'number' ? existing.likes : 0,
            dislikes: existing && typeof existing.dislikes === 'number' ? existing.dislikes : 0,
          };
          await env.Infoto.put('p:' + clean.id, JSON.stringify(merged));
          // 更新有序 id 列表（幂等，不重复插入）；withLock 串行化 read-modify-write 防并发丢 id
          const idList = await withLock('photo_ids', async () => {
            const ids = await env.Infoto.get('photo_ids', 'json');
            const list = Array.isArray(ids) ? ids : [];
            if (!list.includes(clean.id)) {
              list.unshift(clean.id);
              await env.Infoto.put('photo_ids', JSON.stringify(list));
            }
            return list;
          });
          // 建立 sha 反向索引（查重 O(1)）
          if (clean.sha256 && /^[0-9a-f]{64}$/.test(clean.sha256)) {
            await env.Infoto.put('sha:' + clean.sha256, clean.id);
          }
          return json(cors, { ok: true, count: idList.length });
        } catch (e) {
          return json(cors, { error: 'bad json' }, 400);
        }
      }
      return json(cors, { error: 'method not allowed' }, 405);
    }

    // 批量回写尺寸（N 张图片 onload 聚合一次请求，避免 N 次单独 POST）
    // 请求体：{ updates: [ {id, width, height}, ... ] }
    if (path === '/api/photos/dims' && request.method === 'PATCH') {
      const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      if (!rlCheck('dims:' + ip, 60 * 1000, 60)) return json(cors, { error: 'too many requests' }, 429);
      try {
        const cl = Number(request.headers.get('Content-Length') || 0);
        if (cl > 256 * 1024) return json(cors, { error: 'payload too large' }, 413);
        const body = await request.json();
        const updates = Array.isArray(body && body.updates) ? body.updates : [];
        if (updates.length === 0) return json(cors, { ok: true, updated: 0 });
        if (updates.length > 200) return json(cors, { error: 'too many updates (>200)' }, 400);
        let updated = 0;
        for (const u of updates) {
          if (!u || !u.id) continue;
          const id = String(u.id);
          const w = Number(u.width) | 0;
          const h = Number(u.height) | 0;
          if (!w || !h || w <= 0 || w > 16384 || h <= 0 || h > 16384) continue;
          const key = 'p:' + id;
          const existing = await env.Infoto.get(key, 'json');
          if (!existing) continue;
          if (existing.width === w && existing.height === h) continue;
          existing.width = w; existing.height = h;
          await env.Infoto.put(key, JSON.stringify(existing));
          updated++;
        }
        return json(cors, { ok: true, updated });
      } catch (e) {
        return json(cors, { error: 'bad json' }, 400);
      }
    }

    /* ---------- 投票：POST /api/vote {id, delta} ---------- */
    if (path === '/api/vote' && request.method === 'POST') {
      try {
        const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        // 每 IP 每 10 秒最多 10 票（防脚本刷）
        if (!rlCheck('vote:' + ip, 10 * 1000, 10)) return json(cors, { error: 'too many votes' }, 429);

        const body = await request.json();
        const id = body && body.id;
        const delta = body && body.delta;
        if (!id || (delta !== 1 && delta !== -1)) {
          return json(cors, { error: 'bad vote payload' }, 400);
        }

        const photo = await getPhoto(env, id);
        if (!photo) return json(cors, { error: 'photo not found' }, 404);

        const vkey = 'votes:' + id;
        const raw = await env.Infoto.get(vkey, 'json');
        const votes = raw && typeof raw === 'object'
          ? { likes: Array.isArray(raw.likes) ? raw.likes : [], dislikes: Array.isArray(raw.dislikes) ? raw.dislikes : [] }
          : { likes: [], dislikes: [] };

        if (delta > 0) {
          votes.dislikes = votes.dislikes.filter(x => x !== ip);
          if (!votes.likes.includes(ip)) votes.likes.push(ip);
        } else {
          votes.likes = votes.likes.filter(x => x !== ip);
          if (!votes.dislikes.includes(ip)) votes.dislikes.push(ip);
        }
        await env.Infoto.put(vkey, JSON.stringify(votes));
        const likes = votes.likes.length;
        const dislikes = votes.dislikes.length;
        // withLock 串行化「读 p → 写 p 计数」，防并发投票时计数互相覆盖（votes 数组为权威）
        await withLock('pcount:' + id, async () => {
          const cur = (await getPhoto(env, id)) || { id };
          await env.Infoto.put('p:' + id, JSON.stringify({ ...cur, likes, dislikes }));
        });
        return json(cors, { ok: true, delta, likes, dislikes });
      } catch (e) {
        return json(cors, { error: 'bad json' }, 400);
      }
    }

    /* ---------- 哈希查重：GET /api/photos/hash/<sha256> ---------- */
    if (path.startsWith('/api/photos/hash/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const sha = path.slice('/api/photos/hash/'.length).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) return json(cors, { error: 'bad hash' }, 400);
      const pid = await env.Infoto.get('sha:' + sha);
      if (!pid) return json(cors, { exists: false });
      const photo = await env.Infoto.get('p:' + pid, 'json');
      return json(cors, photo ? { exists: true, photo } : { exists: false });
    }

    /* ---------- 管理员认证 + 删除 ---------- */
    if (path === '/api/admin/check' && request.method === 'GET') {
      const hash = await getAdminHash(env);
      if (!hash) return json(cors, { ok: false, setup: true });
      return json(cors, { ok: await isAdmin(request, env) });
    }

    if (path === '/api/admin/login' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      // 登录速率限制：每 IP 每分钟最多 5 次（防暴力破解）
      if (!rlCheck('admin-login:' + ip, 60 * 1000, 5)) {
        return json(cors, { error: 'too many attempts, try again later' }, 429);
      }
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const pw = body && body.password;
      if (!pw) return json(cors, { error: 'missing password' }, 400);
      let stored = await getAdminHash(env);
      if (!stored) {
        // 设置模式：优先用环境变量预设，否则以本次提交为准（直接存 PBKDF2）
        const preset = env.ADMIN_PASSWORD;
        if (preset) {
          // 预设模式：先验证输入与预设一致，通过后才写库（避免错误密码也触发 KV 写入）
          if (preset !== pw) return json(cors, { error: 'wrong password' }, 401);
          stored = await hashPasswordForStorage(preset);
        } else {
          stored = await hashPasswordForStorage(pw);
        }
        await env.Infoto.put('admin_pw', stored);
      } else {
        const vr = await verifyPassword(env, pw, stored);
        if (!vr.ok) return json(cors, { error: 'wrong password' }, 401);
      }
      const token = await createSession(env, stored);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionCookieHeaders(token, request, cors) });
    }

    if (path === '/api/admin/change' && request.method === 'POST') {
      if (!(await isAdmin(request, env))) return json(cors, { error: 'unauthorized' }, 401);
      // 退出旧 Session（密码改动后，把当前的 Session 也标记掉）
      const oldToken = parseCookies(request)['admin_session'];
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const pw = body && body.password;
      if (!pw || String(pw).length < 4) return json(cors, { error: 'password too short' }, 400);
      const hash = await hashPasswordForStorage(pw);
      await env.Infoto.put('admin_pw', hash);
      // 密码改动后：当前 Session 绑定的是旧 adminHash，新的请求走到 isAdmin 时比对失败 → 自动失效
      if (oldToken) destroySession(env, oldToken).catch(() => { });
      const newToken = await createSession(env, hash);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionCookieHeaders(newToken, request, cors) });
    }

    if (path === '/api/admin/logout' && request.method === 'POST') {
      const tok = parseCookies(request)['admin_session'];
      if (tok) destroySession(env, tok).catch(() => { });
      const h = new Headers(cors);
      const isHttps = request.url.startsWith('https://');
      const isLocalhost = /^https?:\/\/localhost(:|\d|\/)/.test(request.url);
      const secureFlag = isHttps ? ' Secure;' : (isLocalhost ? '' : ' Secure;');
      h.set('Set-Cookie', `admin_session=; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=0`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
    }

    if (path.startsWith('/api/photos/') && request.method === 'DELETE') {
      if (!(await isAdmin(request, env))) return json(cors, { error: 'unauthorized' }, 401);
      const id = path.slice('/api/photos/'.length);
      if (!isValidPhotoId(id)) return json(cors, { error: 'invalid id' }, 400);
      const p = await getPhoto(env, id);
      if (p) {
        if (p.sha256) await env.Infoto.delete('sha:' + p.sha256);
        await env.Infoto.delete('p:' + id);
        await env.Infoto.delete('votes:' + id);
      }
      await withLock('photo_ids', async () => {
        const ids = await env.Infoto.get('photo_ids', 'json');
        const list = Array.isArray(ids) ? ids : [];
        const idx = list.indexOf(id);
        if (idx >= 0) { list.splice(idx, 1); await env.Infoto.put('photo_ids', JSON.stringify(list)); }
      });
      return json(cors, { ok: true });
    }

    /* ---------- 上传中转：POST /api/upload-proxy（大文件分片走 tc 图床） ---------- */
    if (path === '/api/upload-proxy' && request.method === 'POST') {
      // 优先读取密钥：Secret > 环境变量 > 内置回退值（内置默认仅开发兜底，生产请用 wrangler secret put）
      const tcSecret = env.TC_SECRET || env.TC_SECRET_DEV || '9a31f2e82617e4b4b482110f8c928b9b2734d809f060c30f12e8b2574a84c122';
      const MAX_PAYLOAD = 25 * 1024 * 1024;
      // 不信任 Content-Length 头（可伪造），用 TransformStream 按实际字节限流
      const limitedBody = request.body ? limitBodySize(request.body, MAX_PAYLOAD) : null;
      const sha = request.headers.get('X-File-Sha256') || '';
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30000);
      try {
        const token = await makeTcToken(tcSecret, sha);
        const headers = new Headers();
        const ct = request.headers.get('Content-Type') || 'application/octet-stream';
        headers.set('Content-Type', ct);
        headers.set('X-Auth-Token', token);
        const upstream = await fetch('https://tc.0147258.xyz/upload', {
          method: 'POST',
          headers,
          body: limitedBody,
          duplex: 'half',
          signal: ac.signal,
        });
        clearTimeout(timer);
        const outHeaders = new Headers(cors);
        outHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
        // 记录本次上传产出的直链（KV `up:<url>`，TTL 7 天）。写库（POST /api/photos）时校验
        // parts 必须全部出自本 worker 上传（见 sanitizePhoto 的 isUploadedLink），防任意 URL 投毒/SSRF。
        // 注意：tc 图床是聚合多 CDN 的（返回网易/美团等第三方直链），不能按域名白名单过滤。
        try {
          const bodyText = await upstream.text();
          try {
            const j = JSON.parse(bodyText);
            const data = j && typeof j.data === 'string' ? j.data : '';
            if (data && /^https:\/\//i.test(data)) {
              await env.Infoto.put('up:' + data, '1', { expirationTtl: 7 * 24 * 3600 });
            }
          } catch (_) { /* 非 JSON 响应不记录 */ }
          return new Response(bodyText, { status: upstream.status, headers: outHeaders });
        } catch (e) {
          return json(cors, { error: 'proxy upstream read failed: ' + e.message }, 502);
        }
      } catch (e) {
        clearTimeout(timer);
        const timedOut = ac.signal.aborted;
        if (e && e.code === 'PAYLOAD_TOO_LARGE') return json(cors, { error: 'payload too large' }, 413);
        return json(cors, { error: timedOut ? 'proxy upstream timeout' : 'proxy upstream error: ' + e.message }, timedOut ? 504 : 502);
      }
    }

    /* ---------- 取图 / 分片还原：GET /api/file/<id> ---------- */
    if (path.startsWith('/api/file/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const id = path.slice('/api/file/'.length);
      if (!isValidPhotoId(id)) return json(cors, { error: 'invalid id' }, 400);
      const p = await getPhoto(env, id);
      if (!p) return json(cors, { error: 'not found' }, 404);
      const parts = (Array.isArray(p.parts) && p.parts.length) ? p.parts : [];
      if (!parts.length) return json(cors, { error: 'no parts' }, 404);
      const forceDownload = url.searchParams.has('dl');
      if (!p.ext) return json(cors, { error: 'photo missing ext' }, 500);
      const ext = String(p.ext).toLowerCase();
      const dlName = p.id + '.' + ext;
      const ct = mimeFromExt(ext);
      const isSafe = ct.startsWith('image/') || ct.startsWith('video/');
      const fhdrs = {
        ...cors,
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=86400', // 不设 stale-while-revalidate：删除照片后边缘缓存须在 max-age 内过期，避免已删内容继续被服务
      };
      if (forceDownload || !isSafe) {
        fhdrs['Content-Disposition'] = safeDisposition(dlName, forceDownload || !isSafe);
      }
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      const tcHeaders = { 'User-Agent': ua, 'Referer': 'https://inf.prom.cc.cd/', 'Accept': '*/*' };

      // 单分片：Worker 流式转发 tc 字节（200）
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
          return json(cors, { error: 'upstream rejected ' + r.status }, 502);
        } catch (e) {
          clearTimeout(timer);
          return json(cors, { error: 'upstream fetch failed: ' + e.message }, 502);
        }
      }

      // 多分片：流式合并（TransformStream pipeline，不把所有分片加载到内存）
      try {
        const readable = mergePartsAsStream(parts, tcHeaders);
        return new Response(readable, { status: 200, headers: fhdrs });
      } catch (e) {
        return json(cors, { error: 'merge error: ' + e.message }, 502);
      }
    }

    /* ---------- 管理员页：/admin → admin.html ---------- */
    if (path === '/admin' || path === '/admin/') {
      return env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
    }

    /* ---------- 静态资源（public/） ---------- */
    return env.ASSETS.fetch(request);
  },
};

function json(headers, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 前端统一格式：只有 webp / webm；其他 ext 一律按二进制下载
const SAFE_MIME = {
  webp: 'image/webp',
  webm: 'video/webm',
};
function mimeFromExt(ext) {
  return SAFE_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

// 安全 Content-Disposition：过滤控制字符（含 \r\n\t），用 RFC 5987 filename*=UTF-8'' 支持中文
function safeDisposition(filename, forceDownload = true) {
  const safe = String(filename || 'download').replace(/[\x00-\x1F\x7F]/g, '');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16));
  const type = forceDownload ? 'attachment' : 'inline';
  return `${type}; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
}

// 按实际传输字节限流（防止 Content-Length 伪造）
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

// 多分片流式合并（串行逐片：保证拼接顺序正确，同时任意时刻内存只保存 1 个分片的流 chunk）
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
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      if (gen && gen.return) { try { gen.return(); } catch { } }
    }
  });
}

// ===== 密码哈希（PBKDF2 + 随机 salt，兼容旧版 SHA-256 自动升级）=====
// 迭代数：CF Workers 免费计划 CPU 配额约 10ms/请求，120k 次迭代实测 15-30ms+ 超配额被终止
// （前端 safeJson 兜底显示"服务端响应异常"）。10k 迭代实测约 1-3ms，安全且在配额内。
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
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derived));
}

async function hashPasswordForStorage(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(password, salt, PBKDF2_ITER);
  // 格式：PBKDF2$<iter>$<saltHex>$<hashHex>（显式带迭代数，便于未来调整而不破坏旧哈希验证）
  return 'PBKDF2$' + PBKDF2_ITER + '$' + bytesToHex(salt) + '$' + hash;
}

async function verifyPassword(env, input, stored) {
  // 仅支持当前格式：PBKDF2$<iter>$<saltHex>$<hashHex>（不再兼容旧 SHA-256 / 无标记 PBKDF2）
  const str = String(stored || '');
  const m = str.match(/^PBKDF2\$(\d+)\$([0-9a-f]+)\$([0-9a-f]{64})$/i);
  if (!m) return { ok: false };
  const iter = Number(m[1]);
  try {
    const salt = hexToBytes(m[2]);
    const actual = await pbkdf2Hex(input, salt, iter);
    return { ok: actual === m[3] };
  } catch { return { ok: false }; }
}

// ===== Session 机制：随机 Token 存 KV（sess:<token>），7 天过期 =====
async function createSession(env, adminHash) {
  const token = randomTokenHex(32);
  const sess = { adminHash, exp: Date.now() + SESS_TTL_MS };
  await env.Infoto.put('sess:' + token, JSON.stringify(sess), { expirationTtl: SESS_TTL_SEC });
  return token;
}
async function verifySessionToken(env, token) {
  if (!token) return false;
  const raw = await env.Infoto.get('sess:' + token);
  if (!raw) return false;
  try {
    const sess = JSON.parse(raw);
    if (sess.exp < Date.now()) return false;
    const curHash = await env.Infoto.get('admin_pw');
    return curHash && sess.adminHash === curHash; // 密码改动后旧 Session 自动失效
  } catch { return false; }
}
async function destroySession(env, token) {
  if (token) await env.Infoto.delete('sess:' + token);
}

function parseCookies(req) {
  const c = req.headers.get('Cookie');
  const out = {};
  if (!c) return out;
  for (const part of c.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    // 恶意/损坏 Cookie（非法 %xx 序列）会让 decodeURIComponent 抛 URIError → 整个请求 500
    try { out[k] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}
async function getAdminHash(env) {
  return (await env.Infoto.get('admin_pw')) || '';
}
async function isAdmin(req, env) {
  const token = parseCookies(req)['admin_session'];
  if (!token) return false;
  return await verifySessionToken(env, token);
}
function sessionCookieHeaders(token, request, cors) {
  const h = new Headers(cors);
  const isHttps = request && request.url && request.url.startsWith('https://');
  const isLocalhost = request && request.url && /^https?:\/\/localhost(:|\d|\/)/.test(request.url);
  const secureFlag = isHttps ? ' Secure;' : (isLocalhost ? '' : ' Secure;');
  h.set('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax;${secureFlag} Max-Age=${SESS_TTL_SEC}`);
  return h;
}

// ===== KV 存储辅助 =====

function isValidPhotoId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200
    && !id.includes('/') && !/[\x00-\x1F\x7F]/.test(id);
}

async function getPhoto(env, id) {
  return await env.Infoto.get('p:' + id, 'json');
}

const KV_BATCH = 40;
async function getAllPhotos(env, { limit = Infinity, offset = 0 } = {}) {
  const ids = await env.Infoto.get('photo_ids', 'json');
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const end = isFinite(limit) ? offset + limit : ids.length;
  const sliced = ids.slice(offset, end);
  const photos = [];
  // 分批串行读 KV（全量 Promise.all 并发在大相册下会触发 KV 限流导致整请求 429）
  for (let i = 0; i < sliced.length; i += KV_BATCH) {
    const batch = sliced.slice(i, i + KV_BATCH);
    const resolved = await Promise.all(batch.map(async id => {
      const p = await env.Infoto.get('p:' + id, 'json');
      return p || null;
    }));
    for (const p of resolved) if (p) photos.push(p);
  }
  return photos;
}

// tc 图床允许的域名白名单（上传代理仅转发到这些域；取图时也只会 fetch 这些域，防 SSRF/投毒）
// 只保留受信任字段，剥离客户端传入的 likes/dislikes / 派生值 url 等
function sanitizePhoto(p) {
  const out = {};
  for (const k of ['id', 'parts', 'sha256', 'width', 'height', 'createdAt', 'ext', 'hasAudio']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  // parts：必须是 https 直链数组（≤512 片）。
  // 是否可信不在此判断——由调用方用 isUploadedLink 异步校验（KV `up:<url>` 必须是本 worker
  // 上传代理产出的，见 POST /api/photos）。tc 图床聚合多 CDN（网易/美团等第三方直链），
  // 按域名白名单过滤会误杀全部新上传（曾导致写库 400 missing valid parts）。
  if (Array.isArray(out.parts)) {
    out.parts = out.parts.filter(u => typeof u === 'string' && /^https:\/\//i.test(u));
    if (out.parts.length === 0 || out.parts.length > 512) delete out.parts;
  } else {
    delete out.parts;
  }
  // createdAt：必须是有限数字（防 NaN 破坏排序）
  if (typeof out.createdAt === 'number' && isFinite(out.createdAt)) {
    out.createdAt = Math.max(0, Math.floor(out.createdAt));
  } else {
    delete out.createdAt;
  }
  // width/height：必须是非负有限数字（前端用它算卡片比例）
  for (const k of ['width', 'height']) {
    if (typeof out[k] === 'number' && isFinite(out[k]) && out[k] >= 0) {
      out[k] = Math.min(16384, Math.floor(out[k]));
    } else {
      delete out[k];
    }
  }
  // ext：仅允许字母数字（≤12 字符），防 Content-Disposition 文件名注入
  if (typeof out.ext !== 'string' || !/^[a-z0-9]{1,12}$/i.test(out.ext)) delete out.ext;
  return out;
}

// 校验 parts 是否全部出自本 worker 上传代理（KV `up:<url>` 有记录）。防 SSRF/投毒。
async function isUploadedLink(env, parts) {
  for (const u of parts) {
    const rec = await env.Infoto.get('up:' + u);
    if (!rec) return false;
  }
  return true;
}

// tc 图床上传签名（仅服务端使用，切勿暴露到前端）
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