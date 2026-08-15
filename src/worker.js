/**
 * Infoto - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 托管静态前端（public/，经 ASSETS 绑定）
 *   2. /api/photos  —— 照片元数据读写（KV 持久化）
 *   3. /api/upload-proxy —— 上传透明代理（浏览器按逆向协议生成 JWT+multipart，
 *      因图床 CORS 拒绝自定义头 X-Auth-Token，由本 Worker 同源转发）
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS（方便前端若部署到其它域名）
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
      'Access-Control-Max-Age': '86400',
    };
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

    /* ---------- 临时管理：清理投票记录（部署后即移除） ---------- */
    if (path === '/api/vote-clear' && request.method === 'POST') {
      const token = request.headers.get('X-Admin-Token') || '';
      if (token !== 'infoto-admin-tmp-8f3k') return json(cors, { error: 'forbidden' }, 403);
      try {
        const body = await request.json();
        const id = body && body.id;
        if (!id) return json(cors, { error: 'bad payload' }, 400);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const vkey = 'vote:' + id + ':' + ip;
        const data = await env.PHOTOS.get('photos', 'json');
        const arr = Array.isArray(data) ? data : [];
        const p = arr.find(x => x.id === id);
        if (p && (p.likes || 0) > 0) p.likes = (p.likes || 0) - 1;
        await env.PHOTOS.put('photos', JSON.stringify(arr));
        await env.PHOTOS.delete(vkey);
        return json(cors, { ok: true });
      } catch (e) {
        return json(cors, { error: 'bad json' }, 400);
      }
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

    /* ---------- 上传透明代理 ---------- */
    if (path === '/api/upload-proxy' && request.method === 'POST') {
      const token = request.headers.get('X-Auth-Token') || '';
      const headers = new Headers();
      const ct = request.headers.get('Content-Type') || 'application/octet-stream';
      headers.set('Content-Type', ct);
      if (token) headers.set('X-Auth-Token', token);
      headers.set('Content-Length', request.headers.get('Content-Length') || '');

      try {
        const upstream = await fetch('https://tc.0147258.xyz/upload', {
          method: 'POST',
          headers,
          body: request.body,
          duplex: 'half',
        });
        const outHeaders = new Headers(cors);
        outHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
        return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
      } catch (e) {
        return json(cors, { error: 'proxy upstream error: ' + e.message }, 502);
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
