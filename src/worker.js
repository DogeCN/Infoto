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
