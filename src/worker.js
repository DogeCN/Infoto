/**
 * Infoto - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 托管静态前端（public/，经 ASSETS 绑定）
 *   2. /api/photos  —— 照片元数据读写（KV 持久化，按 id 拆分存储）
 *   3. /api/vote    —— 按 IP 防重的喜欢/不喜欢投票
 *   4. /api/photos/hash —— SHA-256 查重（O(1) 反向索引）
 *   5. /api/file —— 多分片文件在边缘 Worker 内合并还原为完整文件（单分片 302 直连图床）
 *
 * KV 存储结构（避免单 key 25MB 上限 / 读放大 / 并发写丢失）：
 *   p:<id>        → 单张元数据（含服务端权威的 likes/dislikes）
 *   photo_ids     → 有序 id 列表 [id...]（最新在前）
 *   sha:<hash>    → 对应 photoId（查重反向索引）
 *   votes:<id>    → { likes:[ip...], dislikes:[ip...] }（投票真值源）
 *
 * 上传由浏览器直连图床（cdeaa OSS），本服务端只接收最终直链；大文件分片经 tc 中转，
 * 取图时由本服务端合并还原。图片压缩（WebP）在浏览器端完成，服务端不做转码。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS（方便前端若部署到其它域名）
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
          const existing = await env.PHOTOS.get('p:' + clean.id, 'json');
          const merged = {
            ...clean,
            likes: existing && typeof existing.likes === 'number' ? existing.likes : 0,
            dislikes: existing && typeof existing.dislikes === 'number' ? existing.dislikes : 0,
          };
          await env.PHOTOS.put('p:' + clean.id, JSON.stringify(merged));
          // 更新有序 id 列表（幂等，不重复插入）
          const ids = await env.PHOTOS.get('photo_ids', 'json');
          const idList = Array.isArray(ids) ? ids : [];
          if (!idList.includes(clean.id)) {
            idList.unshift(clean.id);
            await env.PHOTOS.put('photo_ids', JSON.stringify(idList));
          }
          // 建立 sha 反向索引（查重 O(1)）
          if (clean.sha256 && /^[0-9a-f]{64}$/.test(clean.sha256)) {
            await env.PHOTOS.put('sha:' + clean.sha256, clean.id);
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

        // 验证照片存在（先 p:<id>，回退旧 photos）
        const photo = await getPhoto(env, id);
        if (!photo) return json(cors, { error: 'photo not found' }, 404);

        const vkey = 'votes:' + id;
        const raw = await env.PHOTOS.get(vkey, 'json');
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
        await env.PHOTOS.put(vkey, JSON.stringify(votes));
        const likes = votes.likes.length;
        const dislikes = votes.dislikes.length;
        // 同步写回照片对象，使 GET /api/photos 不再需要 N+1 读 votes
        const cur = (await getPhoto(env, id)) || { id };
        await env.PHOTOS.put('p:' + id, JSON.stringify({ ...cur, likes, dislikes }));
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
      const pid = await env.PHOTOS.get('sha:' + sha);
      if (!pid) return json(cors, { exists: false });
      const photo = await env.PHOTOS.get('p:' + pid, 'json');
      return json(cors, photo ? { exists: true, photo } : { exists: false });
    }

    /* ---------- 上传中转：POST /api/upload-proxy（大文件分片走 tc 图床） ---------- */
    // 浏览器直传 cdeaa 有 ~600KB 上限；大文件分片后经本接口中转 tc 图床（Worker 可访问 tc）
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
    // 照片以多个分片直链（cdeaa / tc OSS）存储在 KV，本接口动态拉取各分片拼接还原为完整文件。
    // 单分片 → 302 直连图床；多分片（tc）在 Worker 内合并后原样回传。不做转码（浏览器已存 WebP/原图）。
    if (path.startsWith('/api/file/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const id = path.slice('/api/file/'.length);
      const p = await getPhoto(env, id);
      if (!p) return json(cors, { error: 'not found' }, 404);
      const parts = (Array.isArray(p.parts) && p.parts.length) ? p.parts : (p.url ? [p.url] : []);
      if (!parts.length) return json(cors, { error: 'no parts' }, 404);
      const forceDownload = url.searchParams.has('dl');

      // 单分片（小/中文件，存于 cdeaa）：Worker 出口被 EdgeOne 封，无法直连，只能 302 让浏览器取
      if (parts.length === 1) {
        return Response.redirect(parts[0], 302);
      }

      try {
        // 多分片（大文件，分片存于 tc，Worker 可访问）：逐片拉取拼接
        // EdgeOne 会拦截无 UA/数据中心 UA 的请求，伪装浏览器 UA 绕过
        const chunks = [];
        let total = 0;
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
        for (const u of parts) {
          const r = await fetch(u, { headers: { 'User-Agent': ua, 'Referer': 'https://inf.prom.cc.cd/', 'Accept': '*/*' } });
          if (!r.ok) return json(cors, { error: 'part fetch failed ' + r.status }, 502);
          const ab = await r.arrayBuffer();
          chunks.push(new Uint8Array(ab));
          total += ab.byteLength;
        }
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }

        const ext = p.ext || extFromName(p.filename) || extFromName(p.parts && p.parts[0]) || 'webp';
        const dlName = p.id + '.' + ext;
        const ct = mimeFromName(dlName);
        const isSafe = ct.startsWith('image/') || ct.startsWith('video/');
        const fhdrs = {
          ...cors,
          'Content-Type': ct,
          'Content-Length': String(total),
          'Cache-Control': 'public, max-age=86400',
        };
        if (forceDownload || !isSafe) {
          fhdrs['Content-Disposition'] = safeDisposition(dlName, forceDownload || !isSafe);
        }
        return new Response(merged, { headers: fhdrs });
      } catch (e) {
        return json(cors, { error: 'merge error: ' + e.message }, 502);
      }
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

// 仅放行安全的图像/视频类型；svg/html/pdf 等可渲染/含脚本类型一律按二进制下载，杜绝存储型 XSS
const SAFE_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', jxl: 'image/jxl',
  heic: 'image/heic', ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
  webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
};
function extFromName(name) {
  if (!name) return '';
  const i = String(name).lastIndexOf('.');
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}
function mimeFromName(name) {
  const ext = extFromName(name);
  return SAFE_MIME[ext] || 'application/octet-stream';
}

// 安全 Content-Disposition：过滤控制字符（含 \r\n\t），用 RFC 5987 filename*=UTF-8'' 支持中文
function safeDisposition(filename, forceDownload = true) {
  const safe = String(filename || 'download').replace(/[\x00-\x1F\x7F]/g, '');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16));
  const type = forceDownload ? 'attachment' : 'inline';
  return `${type}; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
}

// ===== KV 存储辅助 =====

// 取单张照片：优先 p:<id>，回退旧 photos 大数组（迁移过渡期安全）
async function getPhoto(env, id) {
  const p = await env.PHOTOS.get('p:' + id, 'json');
  if (p && typeof p === 'object') return p;
  const old = await env.PHOTOS.get('photos', 'json');
  if (Array.isArray(old)) {
    const hit = old.find(x => x && x.id === id);
    if (hit) return hit;
  }
  return null;
}

// 取全部照片（按 photo_ids 顺序）；无 photo_ids 时从旧 photos 自动迁移一次
async function getAllPhotos(env) {
  let ids = await env.PHOTOS.get('photo_ids', 'json');
  if (!Array.isArray(ids) || ids.length === 0) {
    const old = await env.PHOTOS.get('photos', 'json');
    if (Array.isArray(old) && old.length) {
      await migrateOldToNew(env, old);
      ids = await env.PHOTOS.get('photo_ids', 'json') || [];
    } else {
      return [];
    }
  }
  const photos = await Promise.all(ids.map(async id => {
    const p = await env.PHOTOS.get('p:' + id, 'json');
    return p || null;
  }));
  return photos.filter(Boolean);
}

// 旧单 key photos → 拆分存储（幂等，可重复调用）
async function migrateOldToNew(env, old) {
  const idList = [];
  for (const p of old) {
    if (!p || !p.id) continue;
    // 从 votes:<id> 计算计数，避免丢失已有投票
    let likes = 0, dislikes = 0;
    const v = await env.PHOTOS.get('votes:' + p.id, 'json');
    if (v) {
      likes = Array.isArray(v.likes) ? v.likes.length : 0;
      dislikes = Array.isArray(v.dislikes) ? v.dislikes.length : 0;
    }
    const clean = sanitizePhoto(p);
    clean.likes = likes;
    clean.dislikes = dislikes;
    await env.PHOTOS.put('p:' + clean.id, JSON.stringify(clean));
    if (clean.sha256 && /^[0-9a-f]{64}$/.test(clean.sha256)) {
      await env.PHOTOS.put('sha:' + clean.sha256, clean.id);
    }
    idList.push(clean.id);
  }
  await env.PHOTOS.put('photo_ids', JSON.stringify(idList));
}

// 只保留受信任字段，剥离客户端传入的 likes/dislikes 等（计数由服务端维护）
// 文件名不再存储，统一用 <id>.<ext>；ext 标记 webp/webm 等由前端压缩转换后确定的后缀
function sanitizePhoto(p) {
  const out = {};
  for (const k of ['id', 'url', 'parts', 'sha256', 'width', 'height', 'createdAt', 'ext']) {
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

// 图片服务端解码已移除：WebP 压缩在浏览器端完成，服务端仅做分片合并还原（见 /api/file）。