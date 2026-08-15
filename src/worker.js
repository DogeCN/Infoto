/**
 * Infoto - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 托管静态前端（public/，经 ASSETS 绑定）
 *   2. /api/photos  —— 照片元数据读写（KV 持久化）
 *   3. /api/vote    —— 按 IP 防重的喜欢/不喜欢投票
 *   4. /api/photos/hash —— SHA-256 查重
 *   5. /api/file —— 多分片文件在边缘 Worker 内合并还原为完整文件（单分片 302 直连图床）
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
        const data = await getJson(env.PHOTOS, 'photos', []);
        const arr = Array.isArray(data) ? data : [];
        // 动态计算每张照片的 likes / dislikes（从 votes:<id> 集合）
        const withCounts = await Promise.all(arr.map(async p => {
          const v = await getJson(env.PHOTOS, 'votes:' + p.id, null);
          const likes = v && Array.isArray(v.likes) ? v.likes.length : 0;
          const dislikes = v && Array.isArray(v.dislikes) ? v.dislikes.length : 0;
          return { ...p, likes, dislikes };
        }));
        return json(cors, withCounts);
      }
      if (request.method === 'POST') {
        // 按 id upsert 单条，禁止整组覆盖（防止无鉴权清空/篡改整个相册）
        try {
          const body = await request.json();
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json(cors, { error: 'expected photo object' }, 400);
          }
          if (!body.id) return json(cors, { error: 'missing id' }, 400);
          const data = await getJson(env.PHOTOS, 'photos', []);
          const arr = Array.isArray(data) ? data : [];
          const clean = { ...body };
          delete clean.likes; delete clean.dislikes;
          const idx = arr.findIndex(x => x.id === clean.id);
          if (idx >= 0) arr[idx] = clean; else arr.unshift(clean);
          const value = JSON.stringify(arr);
          if (!value) throw new Error('failed to serialize photos');
          await env.PHOTOS.put('photos', value);
          return json(cors, { ok: true, count: arr.length });
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

        // 验证照片存在
        const data = await getJson(env.PHOTOS, 'photos', []);
        const arr = Array.isArray(data) ? data : [];
        if (!arr.some(x => x.id === id)) return json(cors, { error: 'photo not found' }, 404);

        const vkey = 'votes:' + id;
        const raw = await getJson(env.PHOTOS, vkey, null);
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
        return json(cors, { ok: true, delta, likes: votes.likes.length, dislikes: votes.dislikes.length });
      } catch (e) {
        return json(cors, { error: 'bad json' }, 400);
      }
    }

    /* ---------- 哈希查重：GET /api/photos/hash/<sha256> ---------- */
    if (path.startsWith('/api/photos/hash/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const sha = path.slice('/api/photos/hash/'.length).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha)) return json(cors, { error: 'bad hash' }, 400);
        const data = await getJson(env.PHOTOS, 'photos', []);
        const arr = Array.isArray(data) ? data : [];
        const hit = arr.find(p => p.sha256 === sha);
      return json(cors, hit ? { exists: true, photo: hit } : { exists: false });
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
      const data = await getJson(env.PHOTOS, 'photos', []);
      const arr = Array.isArray(data) ? data : [];
      const p = arr.find(x => x.id === id);
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

        const ct = mimeFromName(p.filename) || 'application/octet-stream';
        const isSafe = ct.startsWith('image/') || ct.startsWith('video/');
        const fhdrs = {
          ...cors,
          'Content-Type': ct,
          'Content-Length': String(total),
          'Cache-Control': 'public, max-age=86400',
        };
        if ((forceDownload || !isSafe) && p.filename) {
          fhdrs['Content-Disposition'] = `attachment; filename="${p.filename.replace(/"/g, '')}"`;
        }
        return new Response(merged, { headers: fhdrs });
      } catch (e) {
        return json(cors, { error: 'merge error: ' + e.message }, 502);
      }
    }

    /* ---------- 诊断接口：查看 KV photos 原始值（调试用，可删） ---------- */
    if (path === '/api/debug/photos-raw') {
      try {
        const raw = await env.PHOTOS.get('photos');
        return new Response(raw === null ? '<null>' : raw, {
          headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      } catch (e) {
        return json(cors, { error: 'get raw failed: ' + e.message }, 500);
      }
    }

    /* ---------- 静态资源（public/） ---------- */
    return env.ASSETS.fetch(request);
  },
};

// 安全读取 JSON 格式的 KV：值不存在/损坏时返回默认值，避免整个 Worker 1101
async function getJson(kv, key, fallback = null) {
  try {
    const raw = await kv.get(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[infoto] KV JSON parse failed for', key, e.message);
    return fallback;
  }
}

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
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
function mimeFromName(name) {
  if (!name) return 'application/octet-stream';
  const ext = name.split('.').pop().toLowerCase();
  return SAFE_MIME[ext] || 'application/octet-stream';
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