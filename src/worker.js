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
 *
 * 上传统一由浏览器经 /api/upload-proxy 中转 tc 图床（Worker 可访问 tc，/api/file 200 直出字节供外部抓取）；
 * 取图时由本服务端合并还原。图片统一 WebP/WebM 格式，压缩在浏览器端完成，服务端不做转码。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS（方便前端若部署到其它域名）
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Sha256',
      'Access-Control-Max-Age': '86400',
    };
    // 图片资源需要 CORS 放行（前端跨域取尺寸/复制图片），由 /api/file 单独追加
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    /* ---------- 照片元数据 API ---------- */
    if (path === '/api/photos') {
      if (request.method === 'GET') {
        const arr = await getAllPhotos(env);
        return json(cors, arr);
      }
      if (request.method === 'POST') {
        // 按 id upsert 单条（禁止整组覆盖，防止无鉴权清空/篡改整个相册）
        try {
          const body = await request.json();
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json(cors, { error: 'expected photo object' }, 400);
          }
          if (!body.id) return json(cors, { error: 'missing id' }, 400);
          const clean = sanitizePhoto(body);
          // 保留服务端权威计数（图片 onload 回写尺寸时也走这里，不能清掉投票数）
          const existing = await env.Infoto.get('p:' + clean.id, 'json');
          const merged = {
            ...clean,
            likes: existing && typeof existing.likes === 'number' ? existing.likes : 0,
            dislikes: existing && typeof existing.dislikes === 'number' ? existing.dislikes : 0,
          };
          await env.Infoto.put('p:' + clean.id, JSON.stringify(merged));
          // 更新有序 id 列表（幂等，不重复插入）
          const ids = await env.Infoto.get('photo_ids', 'json');
          const idList = Array.isArray(ids) ? ids : [];
          if (!idList.includes(clean.id)) {
            idList.unshift(clean.id);
            await env.Infoto.put('photo_ids', JSON.stringify(idList));
          }
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

    /* ---------- 投票：POST /api/vote {id, delta} ---------- */
    // 真值来源：votes:<photoId> = { likes: [ip...], dislikes: [ip...] }
    // 动态计算数量，不再写冗余计数器到 photos；从集合内查找做 IP 防重
    if (path === '/api/vote' && request.method === 'POST') {
      try {
        const body = await request.json();
        const id = body && body.id;
        const delta = body && body.delta;
        if (!id || (delta !== 1 && delta !== -1)) {
          return json(cors, { error: 'bad vote payload' }, 400);
        }
        // 取客户端 IP（Cloudflare 注入，绕过代理）
        const ip = request.headers.get('CF-Connecting-IP')
          || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
          || 'unknown';

        const photo = await getPhoto(env, id);
        if (!photo) return json(cors, { error: 'photo not found' }, 404);

        const vkey = 'votes:' + id;
        const raw = await env.Infoto.get(vkey, 'json');
        const votes = raw && typeof raw === 'object'
          ? { likes: Array.isArray(raw.likes) ? raw.likes : [], dislikes: Array.isArray(raw.dislikes) ? raw.dislikes : [] }
          : { likes: [], dislikes: [] };

        // 直接按最新操作方向写入：同方向=保持，反方向=切换；不做取消/拒绝
        // 先从对侧集合移除（若有），再保证本侧集合包含该 IP
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
        // 同步写回照片对象，使 GET /api/photos 不再需要 N+1 读 votes
        const cur = (await getPhoto(env, id)) || { id };
        await env.Infoto.put('p:' + id, JSON.stringify({ ...cur, likes, dislikes }));
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
      // O(1)：先查反向索引 → 再取照片对象
      const pid = await env.Infoto.get('sha:' + sha);
      if (!pid) return json(cors, { exists: false });
      const photo = await env.Infoto.get('p:' + pid, 'json');
      return json(cors, photo ? { exists: true, photo } : { exists: false });
    }

    /* ---------- 管理员认证 + 删除 ---------- */
    // 密码以 SHA-256 存 KV（key: admin_pw）。登录成功下发 admin_session Cookie（HttpOnly）。
    // 首次使用（KV 无密码）进入"设置密码"模式：提交的密码即成为管理员密码；
    // 也可通过环境变量 ADMIN_PASSWORD 预设（防止被他人抢先设置）。
    if (path === '/api/admin/check' && request.method === 'GET') {
      const hash = await getAdminHash(env);
      if (!hash) return json(cors, { ok: false, setup: true });
      return json(cors, { ok: await isAdmin(request, env) });
    }

    if (path === '/api/admin/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const pw = body && body.password;
      if (!pw) return json(cors, { error: 'missing password' }, 400);
      let hash = await getAdminHash(env);
      if (!hash) {
        // 设置模式：优先用环境变量预设，否则以本次提交为准
        hash = env.ADMIN_PASSWORD ? await sha256Hex(env.ADMIN_PASSWORD) : await sha256Hex(pw);
        await env.Infoto.put('admin_pw', hash);
      }
      if (await sha256Hex(pw) !== hash) return json(cors, { error: 'wrong password' }, 401);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionCookieHeaders(hash, cors) });
    }

    if (path === '/api/admin/change' && request.method === 'POST') {
      if (!(await isAdmin(request, env))) return json(cors, { error: 'unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const pw = body && body.password;
      if (!pw || String(pw).length < 4) return json(cors, { error: 'password too short' }, 400);
      const hash = await sha256Hex(pw);
      await env.Infoto.put('admin_pw', hash);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: sessionCookieHeaders(hash, cors) });
    }

    if (path === '/api/admin/logout' && request.method === 'POST') {
      const h = new Headers(cors);
      h.set('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
    }

    if (path.startsWith('/api/photos/') && request.method === 'DELETE') {
      if (!(await isAdmin(request, env))) return json(cors, { error: 'unauthorized' }, 401);
      const id = path.slice('/api/photos/'.length);
      if (!id || id.includes('/')) return json(cors, { error: 'invalid id' }, 400);
      const p = await getPhoto(env, id);
      if (p) {
        if (p.sha256) await env.Infoto.delete('sha:' + p.sha256);
        await env.Infoto.delete('p:' + id);
      }
      const ids = await env.Infoto.get('photo_ids', 'json');
      const list = Array.isArray(ids) ? ids : [];
      const idx = list.indexOf(id);
      if (idx >= 0) { list.splice(idx, 1); await env.Infoto.put('photo_ids', JSON.stringify(list)); }
      return json(cors, { ok: true });
    }

    /* ---------- 上传中转：POST /api/upload-proxy（大文件分片走 tc 图床） ---------- */
    // 浏览器经本接口中转 tc 图床（Worker 可访问 tc）：小文件整文件、大文件分片后均经此上传。
    // 服务端不落盘、不二次处理，只转发并原样返回直链。
    if (path === '/api/upload-proxy' && request.method === 'POST') {
      // 仅服务端用密钥签发 tc token，前端不再持有密钥（防止泄露被滥用上传/托管恶意文件）
      const cl = Number(request.headers.get('Content-Length') || 0);
      if (cl > 25 * 1024 * 1024) return json(cors, { error: 'payload too large' }, 413);
      const sha = request.headers.get('X-File-Sha256') || '';
      // 兜底超时：tc 不可达/过慢时不能让请求永久挂起（否则浏览器侧也无超时、静默卡死）
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30000);
      try {
        const token = await makeTcToken(env.JWT_SECRET || TC_SECRET, sha);
        const headers = new Headers();
        const ct = request.headers.get('Content-Type') || 'application/octet-stream';
        headers.set('Content-Type', ct);
        headers.set('X-Auth-Token', token);
        const upstream = await fetch('https://tc.0147258.xyz/upload', {
          method: 'POST',
          headers,
          body: request.body,
          duplex: 'half',
          signal: ac.signal,
        });
        clearTimeout(timer);
        const outHeaders = new Headers(cors);
        outHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
        return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
      } catch (e) {
        clearTimeout(timer);
        const timedOut = ac.signal.aborted;
        return json(cors, { error: timedOut ? 'proxy upstream timeout' : 'proxy upstream error: ' + e.message }, timedOut ? 504 : 502);
      }
    }

    /* ---------- 取图 / 分片还原：GET /api/file/<id> ---------- */
    // 照片分片直链存于 tc 图床（KV 记 parts），本接口动态拉取各分片拼接还原为完整文件。
    // 单分片：Worker 流式转发 tc 字节（200）；多分片：Worker 内合并回传。不做转码（浏览器已统一 WebP/WebM 格式）。
    if (path.startsWith('/api/file/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const id = path.slice('/api/file/'.length);
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
        'Cache-Control': 'public, max-age=86400',
      };
      if (forceDownload || !isSafe) {
        fhdrs['Content-Disposition'] = safeDisposition(dlName, forceDownload || !isSafe);
      }
      // tc 图床公开可读（仅需伪 UA），Worker 拉取后 200 直出，外部抓取（谷歌搜图等）可拿到字节
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      const tcHeaders = { 'User-Agent': ua, 'Referer': 'https://inf.prom.cc.cd/', 'Accept': '*/*' };

      // 单分片：Worker 流式转发 tc 字节（200），统一 200 直出（保证谷歌搜图等外部抓取可直接读取字节 / CORS 正常）
      if (parts.length === 1) {
        try {
          const r = await fetch(parts[0], { headers: tcHeaders, redirect: 'follow' });
          if (r.ok) {
            const cl = r.headers.get('Content-Length');
            if (cl) fhdrs['Content-Length'] = cl;
            return new Response(r.body, { status: 200, headers: fhdrs });
          }
          return json(cors, { error: 'upstream rejected ' + r.status }, 502);
        } catch (e) {
          return json(cors, { error: 'upstream fetch failed: ' + e.message }, 502);
        }
      }

      // 多分片（tc）：逐片拉取合并回传
      try {
        const chunks = [];
        let total = 0;
        for (const u of parts) {
          const r = await fetch(u, { headers: tcHeaders });
          if (!r.ok) return json(cors, { error: 'part fetch failed ' + r.status }, 502);
          const ab = await r.arrayBuffer();
          chunks.push(new Uint8Array(ab));
          total += ab.byteLength;
        }
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        fhdrs['Content-Length'] = String(total);
        return new Response(merged, { status: 200, headers: fhdrs });
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

// 前端统一格式：只有 webp / webm；其他 ext 一律按二进制下载（防御性编程）
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

// ===== 管理员辅助 =====
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function parseCookies(req) {
  const c = req.headers.get('Cookie');
  const out = {};
  if (!c) return out;
  for (const part of c.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
async function getAdminHash(env) {
  return (await env.Infoto.get('admin_pw')) || '';
}
async function isAdmin(req, env) {
  const cookie = parseCookies(req)['admin_session'];
  if (!cookie) return false;
  const hash = await getAdminHash(env);
  return !!hash && cookie === hash;
}
function sessionCookieHeaders(value, cors) {
  const h = new Headers(cors);
  h.set('Set-Cookie', `admin_session=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`);
  return h;
}

// ===== KV 存储辅助 =====

async function getPhoto(env, id) {
  return await env.Infoto.get('p:' + id, 'json');
}

async function getAllPhotos(env) {
  const ids = await env.Infoto.get('photo_ids', 'json');
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const photos = await Promise.all(ids.map(async id => {
    const p = await env.Infoto.get('p:' + id, 'json');
    return p || null;
  }));
  return photos.filter(Boolean);
}

// 只保留受信任字段，剥离客户端传入的 likes/dislikes / 派生值 url 等
// 文件名不再存储，统一用 <id>.<ext>；ext 只允许 webp / webm（前端统一压缩转换后确定）
function sanitizePhoto(p) {
  const out = {};
  for (const k of ['id', 'parts', 'sha256', 'width', 'height', 'createdAt', 'ext', 'hasAudio']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

// tc 图床上传签名密钥（仅服务端使用，切勿暴露到前端）
const TC_SECRET = '9a31f2e82617e4b4b482110f8c928b9b2734d809f060c30f12e8b2574a84c122';

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