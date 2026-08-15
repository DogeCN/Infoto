/* Infoto Service Worker —— 离线壳 + 图片 Stale-While-Revalidate 缓存 */
const V = 'infoto-v3';
const CORE = ['./', './index.html', './app.js', './styles.css', './shared.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // 同源 API（含 /api/file 图片）走网络优先、失败回退缓存；图片类用缓存优先秒开
    event.respondWith((async () => {
        const cache = await caches.open(V);
        const cached = await cache.match(req);
        if (url.pathname.startsWith('/api/')) {
            if (url.pathname.startsWith('/api/file/')) {
                // 图片字节：缓存优先秒开，后台静默刷新
                if (cached) {
                    fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); }).catch(() => { });
                    return cached;
                }
                try {
                    const network = await fetch(req);
                    if (network.ok) cache.put(req, network.clone());
                    return network;
                } catch (e) { return cached || Response.error(); }
            }
            // JSON API（含 /api/photos 等）：网络优先、绝不缓存，保证删除/更新后立即生效
            try {
                return await fetch(req);
            } catch (e) {
                return cached || new Response('offline', { status: 503 });
            }
        }
        if (req.destination === 'image') {
            if (cached) {
                fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); }).catch(() => { });
                return cached;
            }
            try {
                const network = await fetch(req);
                if (network.ok) cache.put(req, network.clone());
                return network;
            } catch (e) { return cached || Response.error(); }
        }
        // 其它静态资源：网络优先，失败回退缓存
        try {
            const network = await fetch(req);
            if (network.ok) cache.put(req, network.clone());
            return network;
        } catch (e) { return cached || new Response('offline', { status: 503 }); }
    })());
});
