/* =========================================================
 * 数据层：Cloudflare Worker 同源 API
 * 依赖：icons.js（DOM 工具）、shared.js（genPhotoId）
 * ========================================================= */
function apiBase() { return CONFIG.API_BASE || ''; }

function fileUrl(id) {
    const base = apiBase() || location.origin;
    return base + '/api/file/' + id;
}

function dlName(p) {
    return p.id + '.' + String(p.ext).toLowerCase();
}

/* ---- 匿名身份：设备级 UUID（localStorage 持久化）----
   投票身份用匿名 ID 而非 IP——动态 IP 用户换 IP 后服务端认不出"我投过"，
   取消/切换标记会失效。ID 在首次访问生成、跨刷新/跨 IP 稳定；
   清 localStorage / 换浏览器 / 隐私模式才会变（可接受）。 */
const anonId = (() => {
    try {
        const KEY = 'infoto_anon_id';
        let id = localStorage.getItem(KEY);
        if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
            id = (crypto.randomUUID && crypto.randomUUID()) || ('a' + Math.random().toString(36).slice(2) + Date.now().toString(36));
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch (_) { return 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

const Store = {
    photos: [],
    _loaded: false,
    myVotes: Object.create(null),

    // 批量尺寸回写：防抖 + 聚合 PATCH（一次 HTTP 请求代替 N 次单独 POST 回写尺寸）
    _pendingDims: Object.create(null), // id -> {width, height}
    _dimsTimer: null,
    _dimFlushRunning: false,

    // myVotes 持久化：刷新后恢复"我投过什么"的展示（配合匿名 ID，
    // 即使 IP 变了也能显示自己的标记状态）。值 {id: 1|-1}
    _mvKey: 'infoto_myvotes',
    _loadMyVotes() {
        try {
            const raw = localStorage.getItem(this._mvKey);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                this.myVotes = Object.create(null);
                for (const [k, v] of Object.entries(obj)) if (v === 1 || v === -1) this.myVotes[k] = v;
            }
        } catch (_) { /* 损坏忽略 */ }
    },
    _saveMyVotes() {
        try { localStorage.setItem(this._mvKey, JSON.stringify(this.myVotes)); }
        catch (_) { /* 隐私模式忽略 */ }
    },

    _hydrate(p) {
        if (!p) return p;
        if (!p.url) p.url = fileUrl(p.id);
        if (typeof p.hasAudio !== 'boolean') p.hasAudio = false;
        return p;
    },

    async load(force = false) {
        if (this._loaded && !force) return this.photos;
        if (this._loadPromise) return this._loadPromise;
        this._loaded = true;
        this._loadMyVotes(); // 刷新后恢复"我投过什么"（匿名 ID 持久化配套）
        const doFetch = async () => {
            try {
                const r = await fetch(apiBase() + '/api/photos', { cache: 'no-store' });
                if (r.ok) {
                    const fresh = await r.json();
                    this.photos = fresh
                        .map(p => this._hydrate({ ...p, likes: p.likes ?? 0, dislikes: p.dislikes ?? 0 }));
                    return this.photos;
                }
            } catch (e) { console.warn('[infoto] 加载失败', e); }
            return this.photos;
        };
        this._loadPromise = doFetch().finally(() => { this._loadPromise = null; });
        return this._loadPromise;
    },

    getMyVote(id) { return this.myVotes[id] || 0; },

    // 标记一张照片的尺寸已拿到 → 推入待批队列
    markDimsDirty(photo, w, h) {
        if (!photo || !photo.id) return;
        if (!w || !h) return;
        if (photo.width === w && photo.height === h) return;
        photo.width = w;
        photo.height = h;
        this._pendingDims[photo.id] = { id: photo.id, width: w, height: h };
        this._scheduleDimsFlush();
    },

    _scheduleDimsFlush() {
        if (this._dimsTimer) return;
        this._dimsTimer = setTimeout(() => this._flushDims(), 500);
    },

    async _flushDims() {
        this._dimsTimer = null;
        if (this._dimFlushRunning) { this._scheduleDimsFlush(); return; }
        const pending = this._pendingDims;
        const ids = Object.keys(pending);
        if (ids.length === 0) return;
        this._pendingDims = Object.create(null);
        this._dimFlushRunning = true;
        const updates = ids.map(id => pending[id]);
        try {
            const r = await fetch(apiBase() + '/api/photos/dims', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
            if (!r.ok) console.warn('[infoto] dims batch patch non-2xx:', r.status);
        } catch (e) {
            console.warn('[infoto] dims flush fail:', e && e.message);
        } finally {
            this._dimFlushRunning = false;
            // flush 过程中可能又有新的 pending 进来
            if (Object.keys(this._pendingDims).length > 0) this._scheduleDimsFlush();
        }
    },

    async save(photo) {
        const { url, ...payload } = photo;
        void url;
        await fetch(apiBase() + '/api/photos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
    },

    async add(photo) {
        photo.id = photo.id || genPhotoId();
        if (!photo.url) photo.url = fileUrl(photo.id);
        this.photos.unshift(photo);
        // 元数据写库失败不抛出：图片已上传图床并本地展示，失败仅影响跨设备同步，不应把整张判为"上传失败"
        try { await this.save(photo); } catch (e) { console.warn('[infoto] 元数据写库失败（不影响本地上传结果）', e); }
        return photo;
    },

    setLike(id, delta) {
        const p = this.photos.find(x => x.id === id);
        if (!p) return Promise.resolve({ ok: false, already: false, delta: 0 });
        const prevLikes = p.likes || 0;
        const prevDislikes = p.dislikes || 0;
        const prevMy = this.myVotes[id] || 0;
        if (prevMy !== delta) {
            if (prevMy === 1) p.likes = Math.max(0, prevLikes - 1);
            else if (prevMy === -1) p.dislikes = Math.max(0, prevDislikes - 1);
            if (delta === 1) p.likes = (p.likes || 0) + 1;
            else if (delta === -1) p.dislikes = (p.dislikes || 0) + 1;
            this.myVotes[id] = delta;
            this._saveMyVotes();
        }
        const rollback = () => {
            if (!p) return;
            p.likes = prevLikes; p.dislikes = prevDislikes;
            if (prevMy) this.myVotes[id] = prevMy; else delete this.myVotes[id];
            this._saveMyVotes();
        };
        return (async () => {
            try {
                const r = await fetch(apiBase() + '/api/vote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Anon-Id': anonId },
                    body: JSON.stringify({ id, delta })
                });
                if (!r.ok) throw new Error('http ' + r.status);
                const j = await r.json();
                // 服务端语义：重复投票按最新方向覆盖写入，恒返回 {ok:true, likes, dislikes}，
                // 无 already 字段——此前 j.already 分支是旧协议遗留的死代码，已删。
                if (j.ok) {
                    if (p) { p.likes = j.likes; p.dislikes = j.dislikes; }
                    this.myVotes[id] = delta;
                    this._saveMyVotes();
                    return { ok: true, already: false, delta };
                }
                rollback();
                return { ok: false, already: false, delta: 0 };
            } catch (e) {
                console.warn('[infoto] 投票接口失败', e);
                rollback();
                return { ok: false, already: false, delta: 0 };
            }
        })();
    }
};
