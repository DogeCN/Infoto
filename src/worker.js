/**
 * Infoto - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 托管静态前端（public/，经 ASSETS 绑定）
 *   2. /api/photos  —— 照片元数据读写（KV 持久化）
 *   3. /api/vote    —— 按 IP 防重的喜欢/不喜欢投票
 *   4. /api/photos/hash —— SHA-256 查重
 *
 * 上传由浏览器直连图床（cdeaa OSS），本服务端只接收最终直链，不做文件中转。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS（方便前端若部署到其它域名）
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    // 图片资源需要 CORS 放行（前端跨域取尺寸/复制图片），由 /api/file 单独追加
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    /* ---------- 照片元数据 API ---------- */
    if (path === '/api/photos') {
      if (request.method === 'GET') {
        const data = await env.PHOTOS.get('photos', 'json');
        return json(cors, Array.isArray(data) ? data : []);
      }
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (!Array.isArray(body)) return json(cors, { error: 'expected array' }, 400);
          await env.PHOTOS.put('photos', JSON.stringify(body));
          return json(cors, { ok: true, count: body.length });
        } catch (e) {
          return json(cors, { error: 'bad json' }, 400);
        }
      }
      return json(cors, { error: 'method not allowed' }, 405);
    }

    /* ---------- 投票：POST /api/vote {id, delta} ---------- */
    // 按 IP 防重：每个 IP 对同一张照片只能投一次（喜欢+1 / 不喜欢-1）
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
        const vkey = 'vote:' + id + ':' + ip;
        const existing = await env.PHOTOS.get(vkey);
        if (existing) {
          const prev = JSON.parse(existing);
          return json(cors, { ok: false, already: true, delta: prev.delta });
        }
        // 更新照片计数（读-改-写，小数据量可接受）
        const data = await env.PHOTOS.get('photos', 'json');
        const arr = Array.isArray(data) ? data : [];
        const p = arr.find(x => x.id === id);
        if (!p) return json(cors, { error: 'photo not found' }, 404);
        if (delta > 0) p.likes = (p.likes || 0) + 1;
        else p.dislikes = (p.dislikes || 0) + 1;
        await env.PHOTOS.put('photos', JSON.stringify(arr));
        // 投票记录保留 1 年，防止 KV 无限膨胀
        await env.PHOTOS.put(vkey, JSON.stringify({ delta, ts: Date.now() }), { expirationTtl: 31536000 });
        return json(cors, { ok: true, likes: p.likes, dislikes: p.dislikes });
      } catch (e) {
        return json(cors, { error: 'bad json' }, 400);
      }
    }

    /* ---------- 哈希查重：GET /api/photos/hash/<sha256> ---------- */
    if (path.startsWith('/api/photos/hash/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const sha = path.slice('/api/photos/hash/'.length).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) return json(cors, { error: 'bad hash' }, 400);
      const data = await env.PHOTOS.get('photos', 'json');
      const arr = Array.isArray(data) ? data : [];
      const hit = arr.find(p => p.sha256 === sha);
      return json(cors, hit ? { exists: true, photo: hit } : { exists: false });
    }

    /* ---------- 分片还原：GET /api/file/<id> ---------- */
    // 照片以多个分片直链（cdeaa OSS）存储在 KV，本接口动态拉取各分片拼接还原为完整文件
    if (path.startsWith('/api/file/')) {
      if (request.method !== 'GET') return json(cors, { error: 'method not allowed' }, 405);
      const id = path.slice('/api/file/'.length);
      const data = await env.PHOTOS.get('photos', 'json');
      const arr = Array.isArray(data) ? data : [];
      const p = arr.find(x => x.id === id);
      if (!p) return json(cors, { error: 'not found' }, 404);
      const parts = (Array.isArray(p.parts) && p.parts.length) ? p.parts : (p.url ? [p.url] : []);
      if (!parts.length) return json(cors, { error: 'no parts' }, 404);
      try {
        // 逐片拉取并拼接（小图数据量，Worker 内存可承受）
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
        return new Response(merged, {
          headers: {
            ...cors,
            'Content-Type': mimeFromName(p.filename) || 'application/octet-stream',
            'Content-Length': String(total),
            'Cache-Control': 'public, max-age=86400',
          },
        });
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

function mimeFromName(name){
  if(!name) return 'application/octet-stream';
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
    webp:'image/webp', bmp:'image/bmp', svg:'image/svg+xml', avif:'image/avif',
    heic:'image/heic', ico:'image/x-icon', tiff:'image/tiff', tif:'image/tiff',
    mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
    pdf:'application/pdf', zip:'application/zip', json:'application/json',
    txt:'text/plain', html:'text/html', css:'text/css', js:'application/javascript',
  };
  return map[ext] || 'application/octet-stream';
}
