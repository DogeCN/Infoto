/* =========================================================
   图标库（内联 SVG，lucide 风格路径，无外部依赖）
   ========================================================= */
const ICONS = {
    'upload-cloud': '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/>',
    'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'clock-desc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'clock-asc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'more': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'external': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    'check': '<polyline points="20 6 9 17 4 12"/>',
    'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    'alert': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'success': '<circle cx="12" cy="12" r="10"/><polyline points="20 6 9 17 4 12"/>',
    'volume-2': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
};

function renderIcons(root) {
    (root || document).querySelectorAll('[data-i]').forEach(el => {
        const name = el.getAttribute('data-i');
        if (ICONS[name]) {
            el.setAttribute('viewBox', '0 0 24 24');
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', 'currentColor');
            el.setAttribute('stroke-width', '2');
            el.setAttribute('stroke-linecap', 'round');
            el.setAttribute('stroke-linejoin', 'round');
            el.innerHTML = ICONS[name];
        }
    });
}

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };

// 页面级唯一标识：多标签页下，下载任务完成广播只有发起页弹下载，其他页只提示
const TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* =========================================================
   TaskWorker 适配层：跨页面保持上传/下载/删除推进
   - 支持 SharedWorker 的浏览器：任务在 Worker 中执行，页面切换不中断
   - 不支持的浏览器：降级为页面内执行（原有逻辑）
   ========================================================= */
const TaskWorker = (() => {
    let sw = null;
    let supported = typeof SharedWorker !== 'undefined';
    let listeners = new Set();
    let currentTasks = { upload: null, download: null, delete: null };
    let reconnectTimer = null;
    let bc = null;
    let _bcInstalled = false;
    // 双通道（SharedWorker port + BroadcastChannel）同一条广播会各投递一次，用 _seq 去重
    let _lastSeq = 0;
    function _dedupeMsg(msg) {
        if (typeof msg._seq !== 'number') return true; // reply 类消息无 seq，幂等无需去重
        // worker 被回收重建后 _seq 从 1 重新计数：若消息序号比当前基线小很多（>128），
        // 判定为新 worker 的首批广播，重置基线——否则所有广播都会被当作过期消息丢弃，进度永远卡死。
        if (msg._seq < _lastSeq - 128) _lastSeq = msg._seq - 1;
        if (msg._seq <= _lastSeq) return false;
        _lastSeq = msg._seq;
        return true;
    }

    function _installBC() {
        if (_bcInstalled) return;
        _bcInstalled = true;
        try {
            bc = new BroadcastChannel('infoto-task-bc');
            bc.onmessage = (ev) => {
                const msg = ev.data || {};
                if (msg.type === 'bc-keepalive' || msg.type === 'bc-ping') return;
                if (msg.type === 'task-update' && msg.task) {
                    currentTasks[msg.task.type] = msg.task;
                }
                if (msg.type === 'task-started' && msg.taskType) {
                    // 任务刚启动、首条 task-update 还没广播时，先占位登记，保证刷新后 resume 能检测到
                    currentTasks[msg.taskType] = { id: msg.taskId, type: msg.taskType, status: 'running', progress: 0, step: '准备中…', curFile: '准备中', done: 0, skipped: 0, failed: 0, total: 1, extraStat: '' };
                }
                if (msg.type === 'task-clear') {
                    currentTasks[msg.taskType] = null;
                }
                if (msg.type === 'status' && msg.tasks) {
                    currentTasks = { ...currentTasks, ...msg.tasks };
                }
                if (!_dedupeMsg(msg)) return;
                _emit(msg);
            };
        } catch (e) { bc = null; }
    }

    function _port() {
        return sw ? sw.port : null;
    }

    function onMessage(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function _emit(msg) {
        for (const fn of listeners) try { fn(msg); } catch (e) { console.warn('[TaskWorker] listener error', e); }
    }

    function _syncFromBC() {
        if (!bc) return;
        try { bc.postMessage({ type: 'get-status' }); } catch (_) { }
    }

    function connect() {
        _installBC();
        if (!supported) return false;
        if (sw) return true;
        try {
            sw = new SharedWorker('./task.js', { name: 'infoto-task-worker' });
            sw.port.onmessage = (ev) => {
                const msg = ev.data || {};
                if (msg.type === 'task-update' && msg.task) {
                    currentTasks[msg.task.type] = msg.task;
                }
                if (msg.type === 'task-started' && msg.taskType) {
                    currentTasks[msg.taskType] = { id: msg.taskId, type: msg.taskType, status: 'running', progress: 0, step: '准备中…', curFile: '准备中', done: 0, skipped: 0, failed: 0, total: 1, extraStat: '' };
                }
                if (msg.type === 'task-clear') {
                    currentTasks[msg.taskType] = null;
                }
                if (msg.type === 'status' && msg.tasks) {
                    currentTasks = { ...currentTasks, ...msg.tasks };
                }
                if (!_dedupeMsg(msg)) return;
                _emit(msg);
            };
            sw.port.start();
            try { sw.port.postMessage({ type: 'get-status' }); } catch (_) { }
            _syncFromBC();
            if (reconnectTimer) clearInterval(reconnectTimer);
            reconnectTimer = setInterval(() => {
                try { sw.port.postMessage({ type: 'ping' }); } catch (_) { sw = null; connect(); }
            }, 15000);
            return true;
        } catch (e) {
            console.warn('[TaskWorker] SharedWorker 不可用，降级为页面内执行', e);
            supported = false;
            sw = null;
            return false;
        }
    }

    function isSupported() { return supported; }
    function getTask(type) { return currentTasks[type] || null; }
    function hasAnyTask() { return !!(currentTasks.upload || currentTasks.download || currentTasks.delete); }

    function startDelete(ids, apiBase) {
        if (!connect()) return false;
        try {
            sw.port.postMessage({ type: 'start-delete', ids, apiBase });
            return true;
        } catch (e) { return false; }
    }

    function startDownload(list, apiBase, tabId) {
        if (!connect()) return false;
        try {
            sw.port.postMessage({ type: 'start-download', list, apiBase, tabId });
            return true;
        } catch (e) { return false; }
    }

    function startUpload(files, apiBase) {
        if (!connect()) return false;
        try {
            // File[] 经 structured clone 引用传递（不复制字节），Worker 内完成转码/查重/上传/写库
            sw.port.postMessage({ type: 'start-upload', files, apiBase });
            return true;
        } catch (e) { return false; }
    }

    try {
        connect();
        window.addEventListener('beforeunload', () => {
            try { if (sw) sw.port.postMessage({ type: 'disconnect' }); } catch (_) { }
        }, { once: true });
    } catch (e) { console.warn('[TaskWorker] init connect fail:', e && e.message); }

    return { connect, isSupported, onMessage, getTask, hasAnyTask, startDelete, startDownload, startUpload };
})();

/* =========================================================
   WebCodecs AV1 探测 / 压缩 / 转码 已迁至 shared.js（页面与 SharedWorker 共用）
   - isVideoFile/isGifFile/isPicFile/isMp4File/hasAnimatedMedia/picMediaType
   - supportsAv1WebCodecs / compressToWebp / transcodeToAv1Webm / WEBP_QUALITY / FPS_CAP
   shared.js 先于 app.js 加载（index.html），此处仅取引用并保留 DOM 专用兜底。
   ========================================================= */
const isVideoFile = window.isVideoFile;
const isGifFile = window.isGifFile;
const isPicFile = window.isPicFile;
const isMp4File = window.isMp4File;
const hasAnimatedMedia = window.hasAnimatedMedia;
const picMediaType = window.picMediaType;
const supportsAv1WebCodecs = window.supportsAv1WebCodecs;
const compressToWebp = window.compressToWebp;
const transcodeToAv1Webm = window.transcodeToAv1Webm;
const WEBP_QUALITY = window.WEBP_QUALITY;
const FPS_CAP = window.FPS_CAP;

function applyFileInputAccept() {
    const inp = $('#fileInput');
    if (!inp) return;
    if (window._av1Support === true) inp.setAttribute('accept', 'image/*,video/*,.gif');
    else if (window._av1Support === false) inp.setAttribute('accept', 'image/png,image/jpeg,image/webp');
}
$('#fileInput')?.setAttribute('accept', 'image/*,video/*,.gif');
supportsAv1WebCodecs().then(applyFileInputAccept);

/* ---- 主线程专用：非 MP4 视频的 <video> 元素解码兜底（SharedWorker 无 DOM，走不到这里） ---- */
function _videoMetaViaVideoEl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
        v.onloadedmetadata = () => { const m = { width: v.videoWidth, height: v.videoHeight, durationSec: Math.max(0.001, isFinite(v.duration) ? v.duration : 1), fps: FPS_CAP }; URL.revokeObjectURL(url); resolve(m); };
        v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('video load fail')); };
        v.load();
    });
}
async function _decodeEncodeVideoElSeek(file, meta, sink, report) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try { await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video load fail')); v.load(); }); }
    catch (e) { URL.revokeObjectURL(url); throw e; }
    const targetFps = Math.min(meta.fps || FPS_CAP, FPS_CAP);
    const nOut = Math.max(1, Math.round((meta.durationSec || v.duration || 1) * targetFps));
    const seekTo = (t) => new Promise((res) => {
        const onSeeked = () => { v.removeEventListener('seeked', onSeeked); res(); };
        v.addEventListener('seeked', onSeeked);
        v.currentTime = Math.min(t, v.duration || t);
    });
    for (let i = 0; i < nOut; i++) {
        await seekTo(i / targetFps);
        await new Promise(r => requestAnimationFrame(r));
        const bmp = await createImageBitmap(v);
        sink.push(bmp);
        if ((i & 3) === 0) report(0.01 + 0.49 * Math.min(1, (i + 1) / nOut));
    }
    v.pause();
    try { v.currentTime = 0; } catch (e) { console.warn('[infoto] video reset fail', e); }
    URL.revokeObjectURL(url);
}
// 非 MP4 / MP4 解码失败兜底：注入 shared.js transcodeToAv1Webm 的 opts.videoFallback
async function _transcodeVideoFallback(file, { makeEncoder, muxer, report }) {
    const vmeta = await _videoMetaViaVideoEl(file);
    const ew = (vmeta.width + 1) & ~1, eh = (vmeta.height + 1) & ~1;
    const { enc, sink } = await makeEncoder(ew, eh);
    muxer.w = ew; muxer.h = eh;
    const targetFps = Math.min(vmeta.fps || FPS_CAP, FPS_CAP);
    const s = sink(1 / targetFps);
    await _decodeEncodeVideoElSeek(file, vmeta, s, report);
    await enc.flush(); enc.close();
}

function _safeForWebp(file) { return isPicFile(file); }

function apiBase() { return CONFIG.API_BASE || ''; }

function fileUrl(id) {
    const base = apiBase() || location.origin;
    return base + '/api/file/' + id;
}

function dlName(p) {
    return p.id + '.' + String(p.ext).toLowerCase();
}

/* =========================================================
   数据层：Cloudflare Worker 同源 API
   ========================================================= */
const Store = {
    photos: [],
    _loaded: false,
    myVotes: Object.create(null),

    // 批量尺寸回写：防抖 + 聚合 PATCH（一次 HTTP 请求代替 N 次单独 POST 回写尺寸）
    _pendingDims: Object.create(null), // id -> {width, height}
    _dimsTimer: null,
    _dimFlushRunning: false,

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
        photo.id = photo.id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
        }
        const rollback = () => {
            if (!p) return;
            p.likes = prevLikes; p.dislikes = prevDislikes;
            if (prevMy) this.myVotes[id] = prevMy; else delete this.myVotes[id];
        };
        return (async () => {
            try {
                const r = await fetch(apiBase() + '/api/vote', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, delta })
                });
                if (!r.ok) throw new Error('http ' + r.status);
                const j = await r.json();
                if (j.ok) {
                    if (p) { p.likes = j.likes; p.dislikes = j.dislikes; }
                    this.myVotes[id] = delta;
                    return { ok: true, already: false, delta };
                }
                if (j.already) {
                    const serverDelta = typeof j.delta === 'number' ? j.delta : delta;
                    if (p) {
                        p.likes = prevLikes;
                        p.dislikes = prevDislikes;
                        if (serverDelta === 1 && prevMy !== 1) p.likes++;
                        if (serverDelta === -1 && prevMy !== -1) p.dislikes++;
                    }
                    this.myVotes[id] = serverDelta;
                    return { ok: false, already: true, delta: serverDelta };
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

/* =========================================================
   UI 状态
   ========================================================= */
// 提前声明 stage：clampPan / zoomTo 等函数会引用，定义在文件底部事件绑定处赋值
let stage = null;
const state = {
    sortBy: 'latest', latestDir: 'desc', hotestDir: 'desc',
    multiMode: false, selected: new Set(),
    longPressTimer: null, longPressTriggered: false, longPressJustFired: false,
    lightboxOpen: false, currentIndex: 0,
    boxSelecting: false, boxStart: null, boxArm: false, suppressClick: false,
    menuOpen: false,
    isAdmin: false,
    dragging: false, dragStart: null, dragCurrent: null,
    batchSize: 60, loadedCount: 60,
    zoom: { s: 1, x: 0, y: 0 },
    panning: false,
    _lastTap: null
};

function toast(msg, icon = 'info') {
    if (!ICONS[icon]) icon = 'info';
    const t = el('div', 'toast', `<svg class="icon" data-i="${icon}"></svg><span></span>`);
    renderIcons(t);
    t.querySelector('span').textContent = msg;
    const box = $('#toasts');
    box.appendChild(t);
    // 最多同时显示 3 条：超出直接顶掉最旧的（防堆积，干扰最小）
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---- 排序 ---- */
function getSorted() {
    const arr = [...Store.photos];
    if (state.sortBy === 'latest') {
        arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (state.latestDir === 'desc') arr.reverse();
    } else {
        const score = p => (p.likes || 0) - (p.dislikes || 0);
        arr.sort((a, b) => score(a) - score(b));
        if (state.hotestDir === 'desc') arr.reverse();
    }
    return arr;
}
function updateSortUI() {
    const latestActive = state.sortBy === 'latest';
    $('#sortLatest').classList.toggle('active', latestActive);
    $('#sortHotest').classList.toggle('active', !latestActive);
    $('#latestText').textContent = latestActive ? (state.latestDir === 'desc' ? '最新' : '最旧') : '最新';
    $('#hotestText').textContent = !latestActive ? (state.hotestDir === 'desc' ? '最热' : '最冷') : '最热';
    const ic = latestActive ? (state.latestDir === 'desc' ? 'clock-desc' : 'clock-asc') : 'flame';
    $('#sortLatest').querySelector('.icon').setAttribute('data-i', ic);
    renderIcons();
}
function safeResortAndKeepCurrent() {
    const oldSorted = getSorted();
    const curId = state.lightboxOpen && oldSorted[state.currentIndex] ? oldSorted[state.currentIndex].id : null;
    updateSortUI();
    if (state.lightboxOpen && curId) {
        const newIdx = getSorted().findIndex(p => p.id === curId);
        state.currentIndex = newIdx >= 0 ? newIdx : 0;
        updateLightbox();
    }
    renderMasonry();
}
$('#sortLatest').addEventListener('click', () => {
    if (state.sortBy === 'latest') state.latestDir = state.latestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'latest';
    safeResortAndKeepCurrent();
});
$('#sortHotest').addEventListener('click', () => {
    if (state.sortBy === 'hotest') state.hotestDir = state.hotestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'hotest';
    safeResortAndKeepCurrent();
});

/* =========================================================
   瀑布流
   ========================================================= */
function colCount() {
    const w = window.innerWidth;
    if (w >= 1536) return 6; if (w >= 1280) return 5; if (w >= 1024) return 4; if (w >= 768) return 3; return 2;
}
let cols = [];
let renderedCount = 0;

function buildColumns() {
    const m = $('#masonry');
    m.innerHTML = '';
    cols = [];
    const need = Math.max(1, colCount());
    for (let i = 0; i < need; i++) {
        const c = el('div', 'masonry-col');
        m.appendChild(c); cols.push(c);
    }
    // 显式设列宽，避免某些浏览器（X5/UC/旧 Safari）对 flex-basis:0% 的 0 宽塌陷
    applyColWidths();
}

// 根据 .masonry 实际宽度与 gap 计算每列像素宽度并显式设置（绕开 flex 0 宽 bug）
let _colWidthRetry = 0;
function applyColWidths() {
    if (!cols.length) return;
    const m = $('#masonry');
    const cs = getComputedStyle(m);
    const gap = parseFloat(cs.gap || cs.columnGap) || 0;
    const containerW = m.clientWidth || m.getBoundingClientRect().width;
    if (!containerW) {
        // 容器不可测（display:none / 布局未稳定）：下一帧重试，最多 5 次。
        // 否则列宽永久缺失，flex:1 1 0% 在部分浏览器塌缩成单列。
        if (_colWidthRetry < 5) {
            _colWidthRetry++;
            requestAnimationFrame(applyColWidths);
        }
        return;
    }
    _colWidthRetry = 0;
    const n = cols.length;
    const colW = Math.max(0, (containerW - gap * (n - 1)) / n);
    for (const c of cols) {
        c.style.width = colW + 'px';
        c.style.flex = '0 0 ' + colW + 'px';
    }
}

function _shortestCol() {
    if (!cols || cols.length === 0) buildColumns();
    let best = cols[0], bestH = best.getBoundingClientRect().height || best.scrollHeight || 0;
    for (let i = 1; i < cols.length; i++) {
        const ch = cols[i].getBoundingClientRect().height || cols[i].scrollHeight || 0;
        if (ch < bestH) { best = cols[i]; bestH = ch; }
    }
    return best;
}

/* ---------- 音量按钮 ---------- */
function volumeSVG() {
    return `<svg class="icon" data-i="volume-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
}
function muteSVG() {
    return `<svg class="icon" data-i="volume-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
}
function makeVolumeBtn({ initiallyMuted = true } = {}) {
    const b = el('button', 'audio-toggle' + (initiallyMuted ? ' is-muted' : ''), volumeSVG() + muteSVG());
    b.type = 'button';
    b.title = initiallyMuted ? '点按取消静音' : '点按静音';
    b.style.pointerEvents = 'auto';
    b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const v = b.parentElement && b.parentElement.querySelector('video.ph-img,video.lb-img');
        if (!v) return;
        const nowMuted = v.muted ? false : true;
        v.muted = nowMuted;
        if (!nowMuted) { try { v.play().catch(e => console.warn('[infoto] volume play fail', e)); } catch (e) { console.warn('[infoto] volume play fail', e); } }
        b.classList.toggle('is-muted', nowMuted);
        b.title = nowMuted ? '点按取消静音' : '点按静音';
    });
    return b;
}

/* ---- 投票 badges 公共渲染（updateCardStatsById + updateMasonryStatsOnly 共用，去重）---- */
/* ---- 卡片视频视口播放：IntersectionObserver 控制，进视口才播、离开暂停（省流量/性能）；
       无 IO 的旧浏览器回退为自动播放 ---- */
let _cardVideoObserver = null;
function _getCardVideoObserver() {
    if (typeof IntersectionObserver === 'undefined') return null;
    if (_cardVideoObserver) return _cardVideoObserver;
    _cardVideoObserver = new IntersectionObserver((entries) => {
        for (const en of entries) {
            const v = en.target;
            if (!(v instanceof HTMLVideoElement)) continue;
            if (en.isIntersecting) {
                try { const p = v.play(); if (p && p.catch) p.catch(() => { }); } catch (_) { }
            } else {
                try { v.pause(); } catch (_) { }
            }
        }
    }, { rootMargin: '200px 0px' }); // 提前 200px 预热，滚动到前已缓冲
    return _cardVideoObserver;
}

function renderCardStatsBadges(p, myVote) {
    const likes = p.likes || 0;
    const dislikes = p.dislikes || 0;
    const haveVotes = likes > 0 || dislikes > 0;
    if (!haveVotes) return { html: '', haveVotes: false };
    const html =
        `${likes > 0 ? `<div class="card-badge card-badge-like${myVote === 1 ? ' active' : ''}"><svg class="icon" data-i="heart"></svg><span>${likes}</span></div>` : ''}` +
        `${dislikes > 0 ? `<div class="card-badge card-badge-dislike${myVote === -1 ? ' active' : ''}"><svg class="icon" data-i="x-circle"></svg><span>${dislikes}</span></div>` : ''}`;
    return { html, haveVotes: true };
}

function makeCard(photo, index) {
    const card = el('div', 'photo-card');
    card.dataset.id = photo.id;

    const holder = el('div', 'ratio-holder');
    if (photo.width && photo.height) {
        holder.style.paddingBottom = (photo.height / photo.width * 100) + '%';
    } else {
        holder.style.paddingBottom = '100%';
    }
    const skel = el('div', 'skeleton');
    const animated = hasAnimatedMedia(photo);
    let media;
    if (animated) {
        media = el('video', 'ph-img');
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.controls = false;
        media.preload = 'metadata';
        media.setAttribute('playsinline', '');
        media.draggable = false;
        media.onloadedmetadata = () => {
            const nw = media.videoWidth, nh = media.videoHeight;
            if (nw && nh) {
                if (photo.width !== nw || photo.height !== nh) {
                    photo.width = nw; photo.height = nh;
                    holder.style.paddingBottom = (nh / nw * 100) + '%';
                    Store.markDimsDirty(photo, nw, nh);
                }
            }
            if (photo.hasAudio && !card.querySelector('.audio-toggle')) {
                const vbtn = makeVolumeBtn({ initiallyMuted: true });
                holder.appendChild(vbtn);
            }
            media.classList.add('loaded');
            skel.remove();
            // 播放由 IntersectionObserver 控制（进视口才播）；无 IO 环境回退自动播放
            if (!_cardVideoObserver) {
                try { media.play().catch(e => console.warn('[infoto] card video autoplay fail', e)); } catch (e) { console.warn('[infoto] card video autoplay fail', e); }
            }
        };
        media.onerror = () => {
            skel.remove(); media.classList.add('loaded'); media.style.opacity = '.4';
        };
        media.src = photo.url;
    } else {
        media = el('img', 'ph-img');
        media.loading = 'lazy';
        media.draggable = false;
        media.alt = ''; // 装饰性图片：与相邻图形成语境，alt 留空避免逐张朗读噪音（WCAG）
        media.src = photo.url;
        media.onload = () => {
            const nw = media.naturalWidth, nh = media.naturalHeight;
            if (nw && nh) {
                if (photo.width !== nw || photo.height !== nh) {
                    photo.width = nw; photo.height = nh;
                    holder.style.paddingBottom = (nh / nw * 100) + '%';
                    Store.markDimsDirty(photo, nw, nh);
                }
            }
            media.classList.add('loaded');
            skel.remove();
        };
        media.onerror = () => {
            skel.remove(); media.classList.add('loaded'); media.style.opacity = '.4';
        };
    }
    holder.appendChild(skel);
    holder.appendChild(media);
    card.appendChild(holder);

    if (animated && photo.hasAudio) {
        const vbtn = makeVolumeBtn({ initiallyMuted: true });
        holder.appendChild(vbtn);
    }

    const myVote = Store.getMyVote(photo.id);
    const { html, haveVotes } = renderCardStatsBadges(photo, myVote);
    if (haveVotes) {
        const stats = el('div', 'card-stats', html);
        renderIcons(stats);
        card.appendChild(stats);
    }
    const check = el('div', 'multi-check', `<svg class="icon" data-i="check"></svg>`);
    renderIcons(check);
    card.appendChild(check);
    // 视口播放：视频卡注册到 IO（先创建 observer，onloadedmetadata 据此决定是否回退 autoplay）
    if (animated) {
        const ob = _getCardVideoObserver();
        if (ob) { try { ob.observe(media); } catch (_) { } }
    }
    return card;
}

function applySelectUI() {
    const show = state.multiMode;
    $$('.photo-card').forEach(c => {
        const sel = state.selected.has(c.dataset.id);
        c.classList.toggle('selected', sel);
        const m = c.querySelector('.multi-check');
        if (m) {
            m.classList.toggle('on', sel);
            // 勾勾显隐必须由 JS 控制：CSS .multi-check 默认 display:none，
            // 仅靠 .selected 下换背景色不改变 display → 多选模式下勾勾会一直不可见（历史回归点）
            m.style.display = show ? 'flex' : 'none';
        }
    });
}

function renderMasonry(reset = true) {
    const expectedCols = colCount();
    const curColsDom = $('#masonry').querySelectorAll('.masonry-col').length;
    if (!cols || cols.length !== expectedCols || curColsDom !== expectedCols) {
        reset = true;
    }
    // 先按数据量决定 empty/masonry 显隐，再建列。
    // 若此时 masonry 仍带 hidden（display:none），clientWidth=0 会让 applyColWidths
    // 提前 return（列宽缺失，flex:1 1 0% 在部分浏览器塌缩成单列），且 _shortestCol
    // 在 display:none 下所有列高都是 0 永远选中第 0 列 → 刷新后瀑布流变单列；
    // 直到点击排序触发重新渲染（masonry 已可见）才恢复。先移 hidden 即可根治。
    const sorted = getSorted();
    $('#emptyState').classList.toggle('hidden', sorted.length > 0);
    $('#masonry').classList.toggle('hidden', sorted.length === 0);
    if (reset) { buildColumns(); renderedCount = 0; }
    const n = Math.min(sorted.length, state.loadedCount);
    for (let i = renderedCount; i < n; i++) _shortestCol().appendChild(makeCard(sorted[i], i));
    renderedCount = n;
    applySelectUI();
    // 不再全量 updateMasonryStatsOnly：makeCard 已按当前 Store 数据渲染 stats，
    // 增量渲染（滚动加载）时全量遍历已渲染卡是 O(n²) 卡顿源；数据变化路径均有
    // 显式更新（投票 → updateCardStatsById / 上传收尾 → updateMasonryStatsOnly）。
}

function prependCardToMasonry(photo) {
    // 仅「最新」排序下新上传卡必在排序顶部，插入 DOM 语义正确；
    // 其它排序（最热/最冷）下新卡（无投票）排在末尾，硬插顶部会造成排序与 DOM 错位，
    // 且滚动增量渲染（renderMasonry(false) 按 sorted 续 append）时同一张卡会重复出现。
    if (state.sortBy !== 'latest') return;
    const list = getSorted();
    const idxInSorted = list.findIndex(p => p.id === photo.id);
    if (idxInSorted < 0 || idxInSorted >= state.loadedCount) return;
    const card = makeCard(photo, idxInSorted);
    const targetCol = _shortestCol();
    if (!targetCol) return;
    if (targetCol.firstChild) targetCol.insertBefore(card, targetCol.firstChild);
    else targetCol.appendChild(card);
    // 若 Lightbox 开着，新照片插入到列表前面会让当前浏览索引错位 → 按 id 重新定位
    if (state.lightboxOpen) {
        const cur = getSorted()[state.currentIndex];
        const newIdx = cur ? getSorted().findIndex(p => p.id === cur.id) : -1;
        if (newIdx >= 0 && newIdx !== state.currentIndex) {
            state.currentIndex = newIdx;
            const c = $('#lbCounter');
            if (c) c.textContent = `${newIdx + 1} / ${getSorted().length}`;
        }
        renderDots();
    }
    applySelectUI();
    updateCardStatsById(photo.id);
    $('#emptyState').classList.add('hidden');
    $('#masonry').classList.remove('hidden');
}

function installInfiniteScroll() {
    const handler = () => {
        const sorted = getSorted();
        if (state.loadedCount >= sorted.length) return;
        const scrolled = window.scrollY + window.innerHeight;
        const threshold = document.body.scrollHeight - 2.5 * window.innerHeight;
        if (scrolled >= threshold) {
            state.loadedCount = Math.min(sorted.length, state.loadedCount + state.batchSize);
            renderMasonry(false);
        }
    };
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    let safety = 0;
    const fill = () => {
        const sorted = getSorted();
        if (state.loadedCount >= sorted.length || safety++ > 10) return;
        if (document.body.scrollHeight <= window.innerHeight + 100) {
            state.loadedCount = Math.min(sorted.length, state.loadedCount + state.batchSize);
            renderMasonry(false);
            setTimeout(fill, 50);
        }
    };
    setTimeout(fill, 150);
}

function updateCardStatsById(id) {
    const p = Store.photos.find(x => x.id === id);
    if (!p) return;
    const myVote = Store.getMyVote(id);
    $$(`.photo-card[data-id="${id}"]`).forEach(c => {
        const oldStats = c.querySelector('.card-stats');
        const { html, haveVotes } = renderCardStatsBadges(p, myVote);
        if (!haveVotes) { if (oldStats) oldStats.remove(); return; }
        if (oldStats) { oldStats.innerHTML = html; renderIcons(oldStats); }
        else { const s = el('div', 'card-stats', html); renderIcons(s); c.appendChild(s); }
    });
    if (state.lightboxOpen) {
        const likes = p.likes || 0, dislikes = p.dislikes || 0;
        const lbLikes = document.querySelector('#lbLikes');
        const lbDislikes = document.querySelector('#lbDislikes');
        if (lbLikes) { lbLikes.classList.toggle('active', myVote === 1); lbLikes.querySelector('span').textContent = likes; lbLikes.style.display = likes > 0 ? '' : 'none'; }
        if (lbDislikes) { lbDislikes.classList.toggle('active', myVote === -1); lbDislikes.querySelector('span').textContent = dislikes; lbDislikes.style.display = dislikes > 0 ? '' : 'none'; }
    }
}

function updateMasonryStatsOnly() {
    $$('.photo-card').forEach(c => {
        const id = c.dataset.id;
        const p = Store.photos.find(x => x.id === id);
        if (!p) return;
        const myVote = Store.getMyVote(id);
        const { html, haveVotes } = renderCardStatsBadges(p, myVote);
        const oldStats = c.querySelector('.card-stats');
        if (!haveVotes) { if (oldStats) oldStats.remove(); return; }
        if (oldStats) { oldStats.innerHTML = html; renderIcons(oldStats); }
        else { const s = el('div', 'card-stats', html); renderIcons(s); c.appendChild(s); }
    });
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        // 宽度变化但列数不变时，也要更新显式列宽（applyColWidths 用像素值，需跟随容器）
        applyColWidths();
        if (colCount() !== cols.length && !state.lightboxOpen) renderMasonry();
    }, 200);
});

/* =========================================================
   多选模式
   ========================================================= */
function enterMulti(initialId) {
    state.multiMode = true;
    // 复位 longPressTriggered（避免历次长按残留阻断多选单击）；
    // 但若本次是「刚长按进入」（longPressJustFired），拦截标志必须保留，
    // 让松手后的合成 click 被 click handler 吃掉，否则 toggleSelect 会取消刚选中的卡。
    if (!state.longPressJustFired) state.longPressTriggered = false;
    state.longPressJustFired = false;
    state.selected.clear();
    if (initialId) state.selected.add(initialId);
    $('#multiSelectBtn').querySelector('svg').setAttribute('data-i', 'x');
    $('#uploadBtn').classList.add('hidden');
    $('#multiBar').classList.add('show');
    $('#batchDeleteBtn').classList.toggle('hidden', !state.isAdmin);
    renderIcons();
    applySelectUI();
    updateCount();
}
function exitMulti() {
    state.multiMode = false;
    state.longPressTriggered = false; // 复位：退出后普通模式单击不受影响
    state.selected.clear();
    $('#multiSelectBtn').querySelector('svg').setAttribute('data-i', 'check-square');
    $('#uploadBtn').classList.remove('hidden');
    $('#multiBar').classList.remove('show');
    $('#batchDeleteBtn').classList.add('hidden');
    $('#selectionBox').style.display = 'none';
    renderIcons();
    applySelectUI();
}
function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    applySelectUI(); updateCount();
}
function updateCount() {
    const n = state.selected.size;
    $('#selectedCount').textContent = `已选择 ${n} 张`;
}

async function checkAdmin() {
    try {
        const r = await fetch(apiBase() + '/api/admin/check', { cache: 'no-store' });
        const j = await r.json();
        state.isAdmin = !!(j && j.ok);
    } catch (e) { state.isAdmin = false; }
}
$('#multiSelectBtn').addEventListener('click', () => {
    state.multiMode ? exitMulti() : enterMulti();
});
$('#batchDeleteBtn').addEventListener('click', deleteSelected);
let _deleting = false;
let _deleteWorkerListener = null;
async function deleteSelected() {
    if (!state.isAdmin) return;
    if (_deleting) return;
    const ids = [...state.selected];
    if (ids.length === 0) { toast('请先选择照片'); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 张照片吗？此操作不可撤销。`)) return;

    _deleting = true;
    _mode = 'delete';
    resetProgressUI();

    if (TaskWorker.isSupported() && TaskWorker.startDelete(ids, apiBase())) {
        toast(`后台删除 ${ids.length} 张`, 'info');
        if (_deleteWorkerListener) _deleteWorkerListener();
        _deleteWorkerListener = TaskWorker.onMessage((msg) => {
            if (msg.type === 'error') {
                toast(msg.error || '删除启动失败', 'alert');
                _deleting = false;
                _mode = 'upload';
                resetProgressUI();
                if (_deleteWorkerListener) { _deleteWorkerListener(); _deleteWorkerListener = null; }
                return;
            }
            if (msg.type === 'task-update' && msg.task && msg.task.type === 'delete') {
                const t = msg.task;
                setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed, done: t.done, skipped: t.skipped, failed: t.failed });
            }
            if (msg.type === 'delete-complete') {
                const s = msg.summary || {};
                setProgress(1, null, s.failed === 0 ? '完成' : '部分失败', { stat: `成功 ${s.done || 0} · 失败 ${s.failed || 0}` });
                toast(s.failed === 0 ? `已删除 ${s.done || 0} 张` : `删除完成 ${s.done || 0} 成功 ${s.failed || 0} 失败`, s.failed === 0 ? 'success' : 'alert');
                (async () => {
                    await Store.load(true);
                    exitMulti();
                    renderMasonry();
                })();
                setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
                if (_deleteWorkerListener) { _deleteWorkerListener(); _deleteWorkerListener = null; }
                _deleting = false;
            }
        });
        return;
    }

    const total = ids.length;
    let done = 0, fail = 0;

    const tasks = ids.map(id => async () => {
        try {
            const r = await fetch(apiBase() + '/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
            if (r.ok) done++; else fail++;
        } catch (e) { fail++; }
        const finished = done + fail;
        setProgress(
            total ? finished / total : 1,
            `${finished} / ${total} 张`,
            '删除中…',
            { stat: `成功 ${done} · 失败 ${fail}`, remaining: total - finished }
        );
    });

    await runWithConcurrency(tasks, CONFIG.CONCURRENCY);

    setProgress(1, null, fail === 0 ? '完成' : '部分失败', { stat: `成功 ${done} · 失败 ${fail}` });
    toast(fail === 0 ? `已删除 ${done} 张` : `删除完成 ${done} 成功 ${fail} 失败`, fail === 0 ? 'success' : 'alert');

    await Store.load(true);
    exitMulti();
    renderMasonry();
    setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
    _deleting = false;
}

$('#masonry').addEventListener('mousedown', onCardPress);
$('#masonry').addEventListener('touchstart', onCardPress, { passive: true });
function onCardPress(e) {
    const card = e.target.closest('.photo-card');
    if (!card) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (e.target.closest('.audio-toggle')) return; // 音量按钮不触发长按/拖动
    if (state.multiMode) return;
    // 仅隐藏"这张卡片"的音量按钮，其他卡片不动，避免全局闪烁
    card.querySelectorAll('.audio-toggle').forEach(b => b.classList.add('is-hidden'));
    state.longPressTriggered = false;
    clearTimeout(state.longPressTimer);
    state.longPressTimer = setTimeout(() => {
        // 置两个标志：
        //  - longPressTriggered：拦截「本次长按松手后浏览器合成的 click」，
        //    防止它落到 masonry click handler 把刚选中的卡取消（见 click handler）
        //  - longPressJustFired：供 enterMulti 判断「刚因长按进入多选」，进入后
        //    不再被 826 行的复位抹掉拦截标志（否则合成 click 会 toggleSelect 取消选中）
        state.longPressTriggered = true;
        state.longPressJustFired = true;
        if (!state.multiMode) enterMulti(card.dataset.id);
        else toggleSelect(card.dataset.id);
    }, 500);
}
['mouseup', 'touchend', 'touchcancel'].forEach(ev => {
    $('#masonry').addEventListener(ev, function () {
        clearTimeout(state.longPressTimer);
        document.querySelectorAll('#masonry .audio-toggle.is-hidden').forEach(function (b) { b.classList.remove('is-hidden'); });
    });
});
$('#masonry').addEventListener('mouseleave', function (e) {
    clearTimeout(state.longPressTimer);
    var to = e.relatedTarget;
    if (!to || !e.currentTarget.contains(to)) {
        document.querySelectorAll('#masonry .audio-toggle.is-hidden').forEach(function (b) { b.classList.remove('is-hidden'); });
    }
});
$('#masonry').addEventListener('touchmove', (e) => {
    clearTimeout(state.longPressTimer);
    // 手指滑动即视为"拖动" → 隐藏全部音量按钮（滚动视口下用户不需要点按钮）
    document.querySelectorAll('#masonry .audio-toggle').forEach(b => b.classList.add('is-hidden'));
}, { passive: true });
$('#masonry').addEventListener('click', (e) => {
    if (state.suppressClick) { state.suppressClick = false; return; }
    const card = e.target.closest('.photo-card');
    if (!card) return;
    if (state.longPressTriggered) { state.longPressTriggered = false; return; }
    const id = card.dataset.id;
    if (state.multiMode) { toggleSelect(id); return; }
    openLightbox(getSorted().findIndex(p => p.id === id));
});

/* ---- 拖动框选 ---- */
const BOX_DRAG_THRESHOLD = 5;
document.addEventListener('mousedown', e => {
    if (!state.multiMode) return;
    if (!e.target.closest('#masonry')) return;
    if (e.button !== 0) return;
    state.boxArm = true;
    state.boxSelecting = false;
    state.boxStart = { x: e.clientX, y: e.clientY };
    // 框选基线：进入框选前已手动选中的卡片集合。
    // 框选过程中每次重算 = 基线 ∪ 当前矩形命中的卡；矩形移开的卡必须取消选中
    // （原实现只 add 不 delete，卡片一旦被框过就永久选中，与真实框选语义不符）。
    state.boxBase = new Set(state.selected);
    state.suppressClick = false;
});
document.addEventListener('mousemove', e => {
    if (!state.boxArm) return;
    const s = state.boxStart;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!state.boxSelecting && Math.max(Math.abs(dx), Math.abs(dy)) < BOX_DRAG_THRESHOLD) return;
    state.boxSelecting = true;
    state.suppressClick = true;
    e.preventDefault();
    const x = Math.min(s.x, e.clientX), y = Math.min(s.y, e.clientY);
    const w = Math.abs(e.clientX - s.x), h = Math.abs(e.clientY - s.y);
    const b = $('#selectionBox');
    b.style.display = 'block';
    b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.width = w + 'px'; b.style.height = h + 'px';
    const box = { left: x, right: x + w, top: y, bottom: y + h };
    // 动态重算：先复位为基线，再并入当前矩形命中的卡（矩形外移出的卡会被取消）
    state.selected = new Set(state.boxBase);
    $$('.photo-card').forEach(c => {
        const r = c.getBoundingClientRect();
        const hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
        if (hit) state.selected.add(c.dataset.id);
    });
    applySelectUI(); updateCount();
});
document.addEventListener('mouseup', () => {
    state.boxArm = false;
    state.boxBase = null;
    if (state.boxSelecting) {
        state.boxSelecting = false;
        $('#selectionBox').style.display = 'none';
    }
});

/* ---- 批量操作 ---- */
// JSZip 用动态 import（项目零 npm 依赖），首次用到才加载
let _jszip = null;
async function getZipLib() {
    if (_jszip) return _jszip;
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    _jszip = JSZip;
    return _jszip;
}

// 带字节级进度的 fetch（利用 XHR 读取 content-length，不支持则降级为整文件完成）
function fetchWithProgress(url, opts, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        let knownTotal = 0;
        xhr.onprogress = (e) => {
            if (e.lengthComputable) {
                knownTotal = e.total;
                onProgress?.(e.loaded, e.total);
            } else if (knownTotal) {
                onProgress?.(e.loaded, knownTotal);
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (!knownTotal && xhr.response?.size) {
                    onProgress?.(xhr.response.size, xhr.response.size);
                }
                resolve({ blob: xhr.response, total: knownTotal || xhr.response?.size || 0 });
            } else {
                reject(new Error('HTTP ' + xhr.status));
            }
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.timeout = 60000;
        xhr.ontimeout = () => reject(new Error('下载超时（60s）'));
        xhr.send();
    });
}

let _downloadWorkerListener = null;
$('#batchDownloadBtn').addEventListener('click', async () => {
    const list = getSorted().filter(p => state.selected.has(p.id));
    if (list.length === 0) { toast('请先选择照片'); return; }
    if (list.length === 1) {
        exitMulti(); // 下载触发后退出多选
        return downloadUrl(list[0].url + '?dl=1', dlName(list[0]));
    }

    _mode = 'download';
    resetProgressUI();

    if (TaskWorker.isSupported() && TaskWorker.startDownload(list, apiBase(), TAB_ID)) {
        toast(`后台下载 ${list.length} 张`, 'info');
        if (_downloadWorkerListener) _downloadWorkerListener();
        _downloadWorkerListener = TaskWorker.onMessage((msg) => {
            if (msg.type === 'error') {
                toast(msg.error || '下载启动失败', 'alert');
                _mode = 'upload';
                resetProgressUI();
                if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
                return;
            }
            if (msg.type === 'task-update' && msg.task && msg.task.type === 'download') {
                const t = msg.task;
                setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed, done: t.done, skipped: t.skipped, failed: t.failed });
            }
            if (msg.type === 'download-complete' && msg.zipUrl) {
                // 多标签页去重：仅发起页弹下载，其他页提示即可（zip blob URL 各页共享，双端弹窗重复）
                if (msg.tabId && msg.tabId !== TAB_ID) {
                    toast('已在其他页面完成下载', 'info');
                    setProgress(1, msg.fileName || 'download.zip', '完成');
                    exitMulti(); // 本页若在多选，下载结束一并退出
                    setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
                    if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
                    return;
                }
                downloadUrl(msg.zipUrl, msg.fileName || 'download.zip');
                setTimeout(() => URL.revokeObjectURL(msg.zipUrl), 60000);
                setProgress(1, msg.fileName || 'download.zip', '完成');
                toast('下载完成', 'success');
                exitMulti();
                setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
                if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
            }
        });
        return;
    }

    const JSZip = await getZipLib();
    const zip = new JSZip();
    const total = list.length;

    toast(`打包 ${total} 张…`, 'download');

    const perItemProgress = new Array(total).fill(0);
    const perItemTotal = new Array(total).fill(0);
    const perItemDone = new Array(total).fill(false);
    let downloadedBytes = 0;
    let estimatedTotalBytes = 0;
    let zipProgress = 0;
    const ZIP_WEIGHT = 0.12;
    const FETCH_WEIGHT = 1 - ZIP_WEIGHT;

    const recomputeOverall = () => {
        let sumCur = 0, sumTot = 0;
        let finishedItems = 0;
        for (let i = 0; i < total; i++) {
            const t = perItemTotal[i] || 1;
            sumCur += perItemProgress[i];
            sumTot += t;
            if (perItemDone[i]) finishedItems++;
        }
        const fetchPart = sumTot > 0 ? (sumCur / sumTot) * FETCH_WEIGHT : 0;
        const zipPart = zipProgress * ZIP_WEIGHT;
        const overall = Math.min(1, fetchPart + zipPart);
        downloadedBytes = sumCur;
        estimatedTotalBytes = sumTot;
        const stat = `下载 ${finishedItems}/${total} 张`;
        setProgress(overall, `${finishedItems} / ${total} 张`, zipProgress > 0 ? '打包 zip 中' : '下载中…', { stat, remaining: total - finishedItems });
    };

    const dlTasks = list.map((p, i) => async () => {
        try {
            const base = dlName(p);
            const { blob, total: t } = await fetchWithProgress(
                p.url,
                { cache: 'force-cache' },
                (loaded, tot) => {
                    perItemProgress[i] = loaded;
                    if (tot > perItemTotal[i]) perItemTotal[i] = tot;
                    recomputeOverall();
                }
            );
            perItemProgress[i] = perItemTotal[i] = t || blob.size || 1;
            perItemDone[i] = true;
            zip.file(base, blob, { binary: true });
            recomputeOverall();
            return { ok: true };
        } catch (e) {
            perItemDone[i] = true;
            toast(`${dlName(p)} 下载失败`, 'alert');
            return { ok: false, err: e };
        }
    });

    const results = await runWithConcurrency(dlTasks, CONFIG.CONCURRENCY);
    const successCount = results.filter(r => r.ok).length;
    if (successCount === 0) {
        toast('全部下载失败', 'alert');
        setProgress(1, null, '失败', { stat: null });
        setTimeout(resetProgressUI, 2500);
        _mode = 'upload';
        return;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        zipProgress = meta.percent / 100;
        recomputeOverall();
        const failedCount = total - successCount;
        const stat = `${successCount}/${total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`;
        setProgress(
            Math.min(1, (1 - ZIP_WEIGHT) + zipProgress * ZIP_WEIGHT),
            `生成 zip ${meta.percent.toFixed(0)}%`,
            failedCount ? `打包中（${successCount}/${total} 张成功）` : '打包 zip…',
            { stat, remaining: total - successCount }
        );
    });
    zipProgress = 1;
    recomputeOverall();

    const url = URL.createObjectURL(zipBlob);
    const finalName = 'download.zip';
    downloadUrl(url, finalName);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    exitMulti(); // 下载触发后退出多选

    const finalFailed = total - successCount;
    toast(`下载完成 ${successCount} 张${finalFailed ? `（跳过 ${finalFailed}）` : ''}`, 'success');
    const finalStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
    setProgress(1, finalName, '完成', { stat: finalStat });
    setTimeout(() => {
        resetProgressUI();
        _mode = 'upload';
    }, 3000);
});

/* =========================================================
   上传
   ========================================================= */
$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length === 0) return;
    await uploadFiles(files);
});
document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length === 0) return;
    e.preventDefault();
    await uploadFiles(files);
});
document.addEventListener('dragover', e => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault();
});

/* 上传/下载 进度 UI：按钮右下角小圆圈 + 悬停详情 */
let _mode = 'upload';
// 上传精细化进度：各子阶段字节进度跟踪（按"实际字节工作量"加权，而非文件数）
let _prepBytes = { total: 0, done: 0 };
let _uploadBytes = { total: 0, done: 0 };
// 阶段权重（总和≈1）：预处理20% → 查重+上传75% → 收尾同步5%（收尾进度动画内联）
const PHASE_WEIGHT = { PREP: 0.20, UPLOAD: 0.75 };

function resetProgressUI() {
    const ind = $('#upIndicator');
    ind.classList.add('hidden');
    ind.classList.remove('open'); // 收起展开的详情
    $('#upRing').style.strokeDashoffset = '94.25';
    // 重置：用数字 0，清空 check 图标
    $('#upPct').innerHTML = '0';
    $('#upPct').style.fontSize = '';
    $('#upPct').style.color = '';
    $('#upDone').textContent = '0';
    $('#upSkipped').textContent = '0';
    $('#upFailed').textContent = '0';
    $('#upTipFile').textContent = _mode === 'download' ? '等待下载' : _mode === 'delete' ? '等待删除' : '待上传';
    $('#upTipStep').textContent = _mode === 'download' ? '准备下载' : _mode === 'delete' ? '准备删除' : '准备中';
    _prepBytes = { total: 0, done: 0 };
    _uploadBytes = { total: 0, done: 0 };
    $('#upTipStatExtra')?.remove();
}
function setProgress(p, file, step, extra) {
    const ind = $('#upIndicator');
    ind.classList.remove('hidden');
    const clampedP = Math.max(0, Math.min(1, p));
    $('#upRing').style.strokeDashoffset = String(94.25 * (1 - clampedP));
    const pctEl = $('#upPct');
    if (clampedP >= 1) {
        // 完成：统一显示对勾图标（完整 svg，避免裸 <polyline> 不渲染）
        pctEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (extra && extra.remaining !== undefined && extra.remaining !== null) {
        // 未完成：统一显示剩余数目（不再百分比），上传/下载/删除一致
        pctEl.textContent = String(extra.remaining);
        pctEl.style.fontSize = '';
    } else {
        // 兜底：百分比
        pctEl.textContent = Math.round(clampedP * 100) + '%';
        pctEl.style.fontSize = '';
    }
    if (file) $('#upTipFile').textContent = file;
    if (step) $('#upTipStep').textContent = step;
    // 成功/重复/失败 计数动态更新（上传/下载/删除通用；extra.done/skipped/failed 传入即刷新）
    if (extra && extra.done !== undefined) $('#upDone').textContent = String(extra.done);
    if (extra && extra.skipped !== undefined) $('#upSkipped').textContent = String(extra.skipped);
    if (extra && extra.failed !== undefined) $('#upFailed').textContent = String(extra.failed);
    if (extra && extra.stat !== undefined && extra.stat !== null) {
        $('#upTipStatExtra')?.remove();
        const s = document.createElement('div');
        s.id = 'upTipStatExtra';
        s.style.cssText = 'margin-top:.6rem;padding-top:.6rem;border-top:1px solid rgba(123,133,160,.18);font-size:.72rem;color:var(--on-variant);letter-spacing:.03em';
        s.textContent = extra.stat;
        $('#upTip').appendChild(s);
    } else if (extra && extra.stat === null) {
        $('#upTipStatExtra')?.remove();
    }
}
const resetUploadUI = resetProgressUI;
const setUploadProgress = (p, file, step, extra) => setProgress(p, file, step, extra);

/* ---- 进度环：点击展开/收起详情（桌面 hover 仍可用，移动端无 hover 靠点击） ---- */
(() => {
    const ind = $('#upIndicator');
    if (!ind) return;
    ind.addEventListener('click', (e) => {
        e.stopPropagation();
        ind.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
        if (!ind.classList.contains('open')) return;
        if (!ind.contains(e.target)) ind.classList.remove('open');
    });
})();

async function uploadFiles(files) {
    resetUploadUI();
    _mode = 'upload';
    await supportsAv1WebCodecs();
    applyFileInputAccept();
    const total = files.length;
    if (total === 0) return;
    // 后台任务路径（SharedWorker）：仅纯图片可后台转码/上传、跨页面推进。
    // 视频/GIF 必须走主线程：WebCodecs（VideoEncoder/VideoDecoder/VideoFrame）在
    // SharedWorker 环境中不可用（Chrome 仅 Window/DedicatedWorker 暴露），Worker 内
    // 探测 supportsAv1WebCodecs 恒 false、转码必然失败——此前"图片/GIF/MP4 均可后台"
    // 的假设是错的（实测 SharedWorker 无 VideoEncoder），含视频/GIF 一律降级主线程。
    const hasVideoOrGif = files.some(f => isVideoFile(f) || isGifFile(f));
    if (TaskWorker.isSupported() && !hasVideoOrGif) {
        uploadViaTaskWorker(files);
        return;
    }
    runMainThreadUpload(files);
}

// 后台上传：任务在 SharedWorker 中执行（转码/查重/上传/写库），页面只收进度 + 按序插卡
function uploadViaTaskWorker(files) {
    const total = files.length;
    const pendingPhotos = new Map();
    let _nextInsertIdx = 0;
    function flushCards() {
        const run = [];
        while (pendingPhotos.has(_nextInsertIdx)) {
            run.push(pendingPhotos.get(_nextInsertIdx));
            pendingPhotos.delete(_nextInsertIdx);
            _nextInsertIdx++;
        }
        for (let k = run.length - 1; k >= 0; k--) {
            if (run[k]) prependCardToMasonry(run[k]);
        }
    }
    function markReady(idx, photo) {
        pendingPhotos.set(idx, photo || null);
        flushCards();
    }

    const summary = { done: 0, skipped: 0, failed: 0 };
    const off = TaskWorker.onMessage((msg) => {
        if (msg.type === 'error') {
            // 多为"已有上传任务进行中"：提示即可，不能回退主线程（会造成重复上传）
            toast(msg.error || '上传启动失败', 'alert');
            resetUploadUI();
            off();
            return;
        }
        if (msg.type === 'task-update' && msg.task && msg.task.type === 'upload') {
            const t = msg.task;
            setUploadProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed, done: t.done, skipped: t.skipped, failed: t.failed });
        }
        if (msg.type === 'photo-result') {
            if (msg.photo) {
                const p = msg.photo;
                p.url = fileUrl(p.id);
                p.hasAudio = !!p.hasAudio;
                Store.photos.unshift(p);
                summary.done++;
                markReady(msg.idx, p);
                loadDims(p).then(() => Store.markDimsDirty(p, p.width, p.height));
            } else if (msg.skipped) {
                summary.skipped++;
                markReady(msg.idx, null);
                toast(`${msg.name || ''} 已存在，跳过`, 'info');
            } else {
                summary.failed++;
                markReady(msg.idx, null);
                toast(`${msg.name || ''} 上传失败: ${msg.err || '未知错误'}`, 'alert');
            }
        }
        if (msg.type === 'upload-complete') {
            setUploadProgress(1, null, summary.failed === 0 ? '完成' : '部分失败', { stat: `成功 ${summary.done} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`, done: summary.done, skipped: summary.skipped, failed: summary.failed });
            const parts = [];
            if (summary.done > 0) parts.push(`成功 ${summary.done}`);
            if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped}`);
            if (summary.failed > 0) parts.push(`失败 ${summary.failed}`);
            toast(`上传完成 ${parts.join('，')}`, summary.done > 0 || summary.skipped > 0 ? 'success' : 'alert');
            setTimeout(resetUploadUI, 2500);
            off();
        }
    });

    if (!TaskWorker.startUpload(files, apiBase())) {
        off();
        runMainThreadUpload(files); // 罕见兜底：消息通道异常时回退主线程
        return;
    }
    toast(`后台上传 ${total} 个文件`, 'info');
}

async function runMainThreadUpload(files) {
    const t0 = Date.now();
    const av1Ok = window._av1Support === true;
    _prepBytes = { total: 0, done: 0 };
    _uploadBytes = { total: 0, done: 0 };

    let done = 0, failed = 0, skipped = 0;
    const PHASE = { PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05 };

    // 每文件独立状态：各自写入自己的进度，整体进度统一汇总（并发写入互不干扰，不会互相覆盖）
    const fileStates = files.map((f, i) => ({ idx: i, size: f.size || 0, prepP: 0, upP: 0, uploadBytes: f.size || 0, err: null }));
    const prepTotal = fileStates.reduce((a, s) => a + s.size, 0) || 1;

    // 并发保序缓冲：按原始下标顺序 flush 卡片，避免乱序插入造成视觉抖动
    const pendingPhotos = new Map();
    let _nextInsertIdx = 0;
    function flushCards() {
        const run = [];
        while (pendingPhotos.has(_nextInsertIdx)) {
            run.push(pendingPhotos.get(_nextInsertIdx));
            pendingPhotos.delete(_nextInsertIdx);
            _nextInsertIdx++;
        }
        // 逆序 prepend：使本批次在阅读顺序上保持正向（0,1,2…）
        for (let k = run.length - 1; k >= 0; k--) {
            if (run[k]) prependCardToMasonry(run[k]);
        }
    }
    function markReady(idx, photo) {
        // photo 为 null 表示跳过/失败（无卡片），但仍占位以推进 _nextInsertIdx
        pendingPhotos.set(idx, photo || null);
        flushCards();
    }

    let currentFile = total > 1 ? `${total} 个文件` : (files[0] && files[0].name || '');
    let currentStep = '准备中…';

    function curOverall() {
        let prepSum = 0, upSum = 0, upDen = 0;
        for (const s of fileStates) {
            prepSum += s.prepP * s.size;
            const ub = s.uploadBytes || s.size || 1;
            upSum += s.upP * ub; upDen += ub;
        }
        const prepP = prepSum / prepTotal;
        const upP = upDen ? upSum / upDen : 0;
        return Math.min(1, PHASE.PREP * prepP + PHASE.UPLOAD * upP);
    }
    function buildStat() {
        const elapsed = (Date.now() - t0) / 1000 || 0.001;
        const overallPct = curOverall();
        const processedEst = prepTotal * overallPct;
        const speed = processedEst / elapsed;
        const remain = overallPct > 0.02 ? (prepTotal - processedEst) / Math.max(0.0001, speed) : 0;
        const mm = Math.floor(remain / 60), ss = Math.round(remain % 60).toString().padStart(2, '0');
        const parts = [`${formatSize(processedEst)} / ${formatSize(prepTotal)}`];
        if (elapsed > 2) parts.push(`${formatSize(speed)}/s`);
        if (elapsed > 4 && remain > 0 && remain < 3600 * 6) parts.push(`剩 ${mm ? mm + '分' : ''}${ss}秒`);
        return parts.join(' · ');
    }
    let uiTick = null;
    const startUiTick = () => {
        if (uiTick) return; uiTick = setInterval(() => {
            setUploadProgress(curOverall(), currentFile, currentStep, { stat: buildStat(), remaining: Math.max(0, total - done - skipped - failed), done, skipped, failed });
        }, 120);
    };
    const stopUiTick = () => { if (uiTick) { clearInterval(uiTick); uiTick = null; } };

    async function processOne(file, idx) {
        const st = fileStates[idx];
        try {
            if (file.type === 'image/svg+xml') { st.err = 'SVG 暂不支持'; failed++; markReady(idx, null); toast(`${file.name} 不支持 SVG`, 'alert'); return; }
            let blob = file, ext = 'webp', hasAudio = false;
            // 尺寸直接来自压缩/转码阶段的位图元数据（loadDims 仅在两者缺失时兜底）
            let dimsW = 0, dimsH = 0;
            const isV = isVideoFile(file), isG = isGifFile(file), isP = _safeForWebp(file);
            if (isP) {
                currentFile = file.name; currentStep = '压缩中…';
                const webp = await compressToWebp(file, WEBP_QUALITY);
                if (!webp || !webp.blob) { st.err = '图片 WebP 压缩失败'; failed++; markReady(idx, null); toast(`${file.name} 压缩失败`, 'alert'); return; }
                blob = webp.blob; ext = 'webp'; dimsW = webp.width || 0; dimsH = webp.height || 0;
            } else if (isV || isG) {
                if (!av1Ok) {
                    const msg = (isG ? 'GIF' : '视频') + '需要支持 AV1 WebCodecs 的浏览器（Chrome/Edge/Firefox 等）';
                    st.err = msg; failed++; markReady(idx, null); toast(`${file.name}: 需 AV1 编码支持`, 'alert'); return;
                }
                const label = isG ? 'GIF 转码' : '视频转码';
                currentFile = file.name; currentStep = label + '中…';
                const r = await transcodeToAv1Webm(file, (p) => { st.prepP = Math.max(0, Math.min(1, p || 0)); }, { videoFallback: _transcodeVideoFallback });
                blob = r.blob; ext = 'webm'; hasAudio = !!r.hasAudio; dimsW = r.width || 0; dimsH = r.height || 0;
            }
            st.prepP = 1;
            st.uploadBytes = blob.size || st.size || 1;
            const ab = await blob.arrayBuffer();
            const sha = await sha256Hex(ab);
            currentStep = '查重…'; st.upP = 0.02;
            const dup = await checkHashExists(sha);
            if (dup) {
                skipped++; st.upP = 1;
                markReady(idx, null);
                toast(`${file.name} 已存在，跳过`, 'info');
                return;
            }
            currentFile = file.name; currentStep = '上传到图床';
            const parts = await uploadToBed(blob, 'upload.' + ext, (p) => { st.upP = 0.02 + p * 0.93; }, apiBase());
            st.upP = 0.96; currentStep = '获取尺寸…';
            const photo = {
                id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                url: '', parts, sha256: sha,
                width: dimsW, height: dimsH, createdAt: Date.now(),
                ext, hasAudio
            };
            photo.url = fileUrl(photo.id);
            // 尺寸已由压缩/转码阶段带回；loadDims 仅兜底（例如位图阶段拿不到尺寸的异常路径）
            if (!dimsW || !dimsH) await loadDims(photo);
            st.upP = 0.98;
            await Store.add(photo); // add 内部已带尺寸写库（loadDims 先于 add 执行）
            st.upP = 1; done++;
            markReady(idx, photo);
            blob = null; // 立即释放字节，降低内存峰值
        } catch (e) {
            console.error('upload failed:', file.name, e);
            st.err = e && e.message ? e.message : String(e);
            failed++;
            markReady(idx, null);
            toast(`${file.name} 上传失败: ${st.err}`, 'alert');
        }
    }

    // 拆分：图片走 CONFIG.CONCURRENCY 并发；视频/GIF 单线程（WebCodecs 内部已并行，多开极易 OOM）
    const picTasks = [], av1Tasks = [];
    files.forEach((file, idx) => {
        const heavy = av1Ok && (isVideoFile(file) || isGifFile(file));
        (heavy ? av1Tasks : picTasks).push(() => processOne(file, idx));
    });

    startUiTick();
    await Promise.all([
        runWithConcurrency(picTasks, CONFIG.CONCURRENCY),
        runWithConcurrency(av1Tasks, 1)
    ]);
    stopUiTick();
    flushCards(); // 兜底 flush 剩余卡片

    // 阶段 3：最终同步对齐（占总进度最后 5%）
    const finalStart = Date.now();
    const finalDur = 500;
    const finalAnim = setInterval(() => {
        const t = Math.min(1, (Date.now() - finalStart) / finalDur);
        setUploadProgress(PHASE.PREP + PHASE.UPLOAD + t * PHASE.SYNC, null, '同步服务器…', { remaining: Math.max(0, total - done - skipped - failed), done, skipped, failed });
    }, 30);
    try {
        updateMasonryStatsOnly();
        if (state.lightboxOpen) {
            const cp = curPhoto();
            if (cp) updateLightboxVotes(cp);
            renderDots();
        }
    } catch (_) { }
    clearInterval(finalAnim);

    setUploadProgress(1, null, '完成', { stat: `共 ${formatSize(prepTotal)} · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`, done, skipped, failed });
    const summary = [];
    if (done > 0) summary.push(`成功 ${done}`);
    if (skipped > 0) summary.push(`跳过 ${skipped}`);
    if (failed > 0) summary.push(`失败 ${failed}`);
    if (summary.length) toast(`上传完成 ${summary.join('，')}`, done > 0 || skipped > 0 ? 'success' : 'alert');
    setTimeout(resetUploadUI, 2500);
}

// 查重：shared.js 统一实现，页面侧只需补 apiBase
async function checkHashExists(sha) {
    return window.checkHashExists(sha, apiBase());
}

function loadDims(photo) {
    return new Promise(resolve => {
        const animated = hasAnimatedMedia(photo);
        const done = (w, h) => {
            photo.width = w || 0;
            photo.height = h || 0;
            resolve();
        };
        const timeout = setTimeout(() => done(photo.width || 0, photo.height || 0), 8000);
        if (animated) {
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true; v.preload = 'metadata';
            v.onloadedmetadata = () => { clearTimeout(timeout); done(v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load && v.load(); };
            v.onerror = () => { clearTimeout(timeout); done(photo.width, photo.height); };
            v.src = photo.url;
        } else {
            const img = new Image();
            img.onload = () => { clearTimeout(timeout); done(img.naturalWidth, img.naturalHeight); };
            img.onerror = () => { clearTimeout(timeout); done(photo.width, photo.height); };
            img.src = photo.url;
        }
    });
}

/* =========================================================
   Lightbox 卡片预览 + 四向手势
   ========================================================= */
const THRESHOLD = 80;

function openLightbox(idx) {
    const list = getSorted();
    if (idx < 0 || idx >= list.length) return;
    state.currentIndex = idx;
    state.lightboxOpen = true;
    $('#lightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
    updateLightbox();
    renderDots();
}
function closeLightbox() {
    state.lightboxOpen = false;
    $('#lightbox').classList.remove('show');
    document.body.style.overflow = '';
    closeMenu();
    resetGestures();
    resetZoom();
    // 关闭时暂停 video 并清空 src，释放 GPU / 解码资源
    const vid = $('#lbVid');
    if (vid) {
        try {
            vid.pause();
            vid.removeAttribute('src');
            vid.load && vid.load();
        } catch (_) { }
    }
    // 释放相邻图预加载
    for (const img of _lbPreloadImgs) { try { img.src = ''; } catch (_) { } }
    _lbPreloadImgs = [];
}
function curPhoto() { return getSorted()[state.currentIndex]; }

/* ---- 相邻图预加载：消除切图闪烁（静态图预热进浏览器/SW 缓存；webm 由视频自身缓存） ---- */
let _lbPreloadImgs = [];
function preloadLightboxNeighbors(idx) {
    for (const img of _lbPreloadImgs) { try { img.src = ''; } catch (_) { } }
    _lbPreloadImgs = [];
    const list = getSorted();
    for (const d of [-1, 1]) {
        const n = idx + d;
        if (n < 0 || n >= list.length) continue;
        const p = list[n];
        if (p && !hasAnimatedMedia(p)) {
            const img = new Image();
            img.src = p.url;
            _lbPreloadImgs.push(img);
        }
    }
}
/* ---------- 音量按钮显示/隐藏（拖动时隐藏，结束显示）---------- */
function _setAudioBtnsVisible(v) {
    const list = document.querySelectorAll('.audio-toggle');
    list.forEach(b => { b.classList.toggle('is-hidden', !v); });
}
/* ---------- 轻量通用收尾：Lightbox 手势结束时把 lbWrap 复位 + 图标复位 + 音量按钮恢复 ---------- */
function _resetLbWrapAndGestures(animatedBack = true) {
    const w = lbWrap();
    // 视觉归位 translate(0,0) 即 scale(1)；必须同步 state，否则滚轮缩放后（s≠1）拖动松手
    // 视觉回原大小而 state.zoom.s 残留旧值，下次拖动又按残留值跳变（"恢复原大小↔跳回缩放大小"）。
    if (state.zoom.s !== 1 || state.zoom.x !== 0 || state.zoom.y !== 0) {
        state.zoom = { s: 1, x: 0, y: 0, r: 0 };
    }
    if (w) {
        if (animatedBack) w.style.transition = 'transform .3s ease, opacity .3s ease';
        w.style.transform = 'translate(0,0)';
        w.style.willChange = 'auto';
    }
    resetGestures();
    _setAudioBtnsVisible(true);
}
/* ---------- 根据手势判定触发：投票/下载/菜单 ---------- */
function _triggerGestureByDrag(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > ay) {
        if (ax > THRESHOLD) triggerGesture(dx > 0 ? 'right' : 'left');
    } else {
        if (ay > THRESHOLD) triggerGesture(dy > 0 ? 'down' : 'up');
    }
}
function updateLightboxVotes(p) {
    const likes = p.likes || 0;
    const dislikes = p.dislikes || 0;
    const myVote = Store.getMyVote(p.id);
    const likesStr = likes > 0 ? `<span class="lb-vote lb-vote-like${myVote === 1 ? ' active' : ''}"><svg class="icon" data-i="heart"></svg><b>${likes}</b></span>` : '';
    const dislikesStr = dislikes > 0 ? `<span class="lb-vote lb-vote-dislike${myVote === -1 ? ' active' : ''}"><svg class="icon" data-i="x-circle"></svg><b>${dislikes}</b></span>` : '';
    let votesBox = $('#lbVotes');
    if (!votesBox) {
        votesBox = el('div', 'lb-votes');
        votesBox.id = 'lbVotes';
        $('#lbCounter').after(votesBox);
    }
    votesBox.innerHTML = likesStr + dislikesStr;
    renderIcons(votesBox);

    const giLeft = $('#giLeft'), giRight = $('#giRight');
    giLeft.classList.toggle('voted', myVote === 1);
    giRight.classList.toggle('voted', myVote === -1);
}
function updateLightbox() {
    const p = curPhoto();
    if (!p) return;

    // 清理旧的 lb 音量按钮
    const w = lbWrap();
    if (w) {
        w.querySelectorAll('.audio-toggle').forEach(n => n.remove());
    }
    state.zoom = { s: 1, x: 0, y: 0, r: 0 };
    state.panning = false;
    if (w) {
        w.style.transition = 'none';
        w.style.transformOrigin = '50% 50%';
        w.style.transform = 'translate(0,0) scale(1) rotate(0deg)';
        w.style.opacity = 1;
    }

    const img = $('#lbImg');
    const vid = $('#lbVid');

    try { if (vid && vid.pause) vid.pause(); } catch (_) { }

    const animated = hasAnimatedMedia(p);
    if (animated) {
        img.style.display = 'none';
        try { img.removeAttribute('src'); } catch (_) { }
        vid.style.display = '';
        vid.style.opacity = ''; // 重置上次加载失败残留的 .4 灰显
        vid.muted = true;
        vid.loop = true;
        vid.playsInline = true;
        vid.controls = false;
        vid.preload = 'auto';
        vid.onerror = () => { vid.style.opacity = '.4'; };

        const onMeta = () => {
            if (p.hasAudio && w && !w.querySelector('.audio-toggle')) {
                const vbtn = makeVolumeBtn({ initiallyMuted: true });
                vbtn.classList.add('audio-toggle--lb');
                w.appendChild(vbtn);
                _setAudioBtnsVisible(true);
            }
        };
        vid.addEventListener('loadedmetadata', onMeta, { once: true });

        vid.src = p.url;
        // muted autoplay 允许；失败就等用户交互再 play（常见于 iOS Safari 低电量模式）
        try {
            const pProm = vid.play();
            if (pProm && typeof pProm.catch === 'function') pProm.catch(() => { /* ignore */ });
        } catch (_) { }
    } else {
        vid.style.display = 'none';
        try { vid.removeAttribute('src'); if (vid.load) vid.load(); } catch (_) { }
        img.style.display = '';
        img.onerror = () => { };
        img.src = p.url;
        img.alt = dlName(p);
    }
    $('#lbCounter').textContent = `${state.currentIndex + 1} / ${getSorted().length}`;
    updateLightboxVotes(p);
    renderDots();
    preloadLightboxNeighbors(state.currentIndex);
    _setAudioBtnsVisible(true);
}
function renderDots() {
    const d = $('#lbDots');
    const list = getSorted();
    const len = list.length;
    const W = 20; // 窗口宽度：照片少时全显，多时以当前为中心滑窗
    let start = 0;
    if (len > W) start = Math.max(0, Math.min(state.currentIndex - Math.floor(W / 2), len - W));
    const count = Math.min(len, W);
    // 1) 保证 dot 数量正确（不够补、多了删），不重建已有 dot
    while (d.children.length < count) d.appendChild(el('span', 'dot'));
    while (d.children.length > count) d.removeChild(d.lastChild);
    // 2) 只切换 active class（相对窗口偏移）
    for (let i = 0; i < count; i++) {
        d.children[i].classList.toggle('active', (start + i) === state.currentIndex);
    }
}
function nextPhoto() { state.currentIndex = (state.currentIndex + 1) % getSorted().length; updateLightbox(); }

$('#lbCloseBtn').addEventListener('click', closeLightbox);
// 点击空白（媒体/顶栏/圆点之外）关闭；菜单开着时不关
$('#lightbox').addEventListener('click', e => {
    if (state.menuOpen) return;
    if (e.target.closest && e.target.closest('.lb-media-wrap,.lb-top,.lb-dots,.audio-toggle,#lbMoreBtn,#lbCloseBtn')) return;
    closeLightbox();
});

document.addEventListener('keydown', e => {
    if (!state.lightboxOpen) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => {
    if (!state.lightboxOpen) return;
    if (e.repeat) return;
    if (state.menuOpen) {
        if (e.key === 'Escape') closeMenu();
        return;
    }
    if (e.key === 'ArrowLeft') triggerGesture('left');
    else if (e.key === 'ArrowRight') triggerGesture('right');
    else if (e.key === 'ArrowUp') triggerGesture('up');
    else if (e.key === 'ArrowDown') triggerGesture('down');
    else if (e.key === ' ') {
        // Space：视频播放/暂停，静态图翻下一页
        const vid = $('#lbVid');
        if (vid && vid.style.display !== 'none') {
            if (vid.paused) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => { }); }
            else vid.pause();
        } else nextPhoto();
    }
    else if (e.key === 'm' || e.key === 'M') {
        const p = curPhoto();
        const vid = $('#lbVid');
        if (p && p.hasAudio && vid && vid.style.display !== 'none') {
            vid.muted = !vid.muted;
            const b = document.querySelector('.audio-toggle--lb');
            if (b) b.classList.toggle('is-muted', vid.muted);
            toast(vid.muted ? '已静音' : '已取消静音', vid.muted ? 'volume-x' : 'volume-2');
        }
    }
    else if (e.key === '+' || e.key === '=') {
        if (stage) { const r = stage.getBoundingClientRect(); zoomTo(state.zoom.s * 1.2, r.width / 2, r.height / 2); }
    }
    else if (e.key === '-' || e.key === '_') {
        if (stage) { const r = stage.getBoundingClientRect(); zoomTo(state.zoom.s / 1.2, r.width / 2, r.height / 2); }
    }
    else if (e.key === 'Escape') closeLightbox();
});

function resetGestures() {
    ['#giLeft', '#giRight', '#giUp', '#giDown'].forEach(s => {
        const g = $(s);
        g.style.opacity = 0; g.style.transform = '';
    });
}

/* ---- Lightbox 缩放 / 平移 / 旋转（统一作用到 lbMediaWrap 容器，img/video 同步被变换）---- */
function lbWrap() { return $('#lbMediaWrap'); }
let _zoomRaf = null;
function scheduleZoomRender() {
    // 高频 touchmove 下用 rAF 合并渲染：一次帧内多次 state 更新只写一次 style，
    // 避免真机高刷屏（120Hz）掉帧/卡顿。wheel/双击等低频路径仍可直接 applyZoomTransform。
    if (_zoomRaf) return;
    _zoomRaf = requestAnimationFrame(() => { _zoomRaf = null; applyZoomTransform(); });
}
function applyZoomTransform() {
    const w = lbWrap(); if (!w) return;
    w.style.transform = `translate(${state.zoom.x}px, ${state.zoom.y}px) scale(${state.zoom.s}) rotate(${(state.zoom.r || 0).toFixed(2)}deg)`;
}
function setWillChange(on) {
    const w = lbWrap(); if (!w) return;
    w.style.willChange = on ? 'transform' : 'auto';
}
function clampPan() {
    const w = lbWrap(); if (!w || !stage) return;
    const sr = stage.getBoundingClientRect();
    const r = w.getBoundingClientRect();
    // scale<=1 时 translate 归零，但**不重置旋转**（用户显式旋转过就保留）
    if (state.zoom.s <= 1) { state.zoom.x = 0; state.zoom.y = 0; applyZoomTransform(); return; }
    if (r.left > sr.left + 1) state.zoom.x += (sr.left + 1 - r.left);
    if (r.right < sr.right - 1) state.zoom.x += (sr.right - 1 - r.right);
    if (r.top > sr.top + 1) state.zoom.y += (sr.top + 1 - r.top);
    if (r.bottom < sr.bottom - 1) state.zoom.y += (sr.bottom - 1 - r.bottom);
}
// 以 stage 内坐标 (sx,sy) 为锚点缩放到 ns
function zoomTo(ns, sx, sy) {
    if (!stage) return;
    // 下限 0.5：允许双指/滚轮缩小到 0.5（原下限 1 导致缩小完全无效）
    ns = Math.min(8, Math.max(0.5, ns));
    const sr = stage.getBoundingClientRect();
    const Sx = sr.width / 2, Sy = sr.height / 2;
    // 旋转态（非 0/180/360 倍数）下，transform 含 rotate，锚点数学（假设纯 scale+translate）失效，
    // 围绕手指锚点缩放会"飞走"→ 钉在中心缩放，稳定不飘
    if (_isRotated()) { sx = Sx; sy = Sy; }
    const s = state.zoom.s, x = state.zoom.x, y = state.zoom.y;
    state.zoom.s = ns;
    state.zoom.x = (sx - Sx) - ns * (sx - Sx - x) / s;
    state.zoom.y = (sy - Sy) - ns * (sy - Sy - y) / s;
    applyZoomTransform();
    clampPan();
}
function resetZoom() {
    state.zoom = { s: 1, x: 0, y: 0, r: 0 };
    const w = lbWrap(); if (w) {
        w.style.transition = 'transform .2s ease';
        w.style.transformOrigin = '50% 50%';
    }
    applyZoomTransform();
    setTimeout(() => { if (w) w.style.transition = 'none'; }, 200);
}
let pinch = null;
function startPinch(e) {
    if (!stage) return;
    const t0 = e.touches[0], t1 = e.touches[1];
    const sr = stage.getBoundingClientRect();
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    // 记录初始：双指距离 + 向量角度（度）+ 两指中心（stage 坐标）+ 当前缩放/旋转
    const dist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const cxStage = (t0.clientX + t1.clientX) / 2 - sr.left;
    const cyStage = (t0.clientY + t1.clientY) / 2 - sr.top;
    // 把两指中心换算成 wrap 相对百分位，作为 transform-origin 让旋转/缩放围绕两指中心（仿 iOS/Google Photos）
    const w = lbWrap();
    if (w) {
        // transform-origin 必须始终钉在元素中心(50% 50%)。
        // 若按「已变换后的 getBoundingClientRect」反算 origin 百分比，scale/rotate 后 wr.width/wr.left 已是形变值，
        // 算出的 origin 严重错位 → 缩放/旋转围绕错误支点，图片直接飞走。onGm 里的锚点数学(zoomTo 同款)正是假设中心 origin。
        w.style.transition = 'none';
        w.style.transformOrigin = '50% 50%';
        // 捏合期间提示浏览器把元素提升到合成层（真机高刷屏更跟手，松手后还原）
        w.style.willChange = 'transform';
    }
    pinch = {
        dist, angle,
        cx: cxStage, cy: cyStage,
        s: state.zoom.s,
        r: state.zoom.r || 0,
        // 关键：记录起始 x/y。onGm 双指分支每次 touchmove 都用 pinch 起始的 (s,x,y) 计算锚点，
        // 不能用 state.zoom.x/y（那会被本帧更新，下一帧用更新后的 x 配起始 s 算锚点 → 位置累积漂移，图片飞走）。
        x: state.zoom.x,
        y: state.zoom.y,
    };
}

// 归一化角度差（返回 (-180, +180]，避免 179°→-179° 时旋转突然转 358°）
function _normAngleDelta(d) {
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
}

function _isRotated() {
    // 吸附后 0/180/360° 视为"水平"，其他任何角度（含 90/270°）都视为"旋转了，应该走平移"
    // 注意 90° / 270° 时图片是竖图横放，主流相册依然允许用户 pan 调整位置看图
    const r = Math.abs(state.zoom.r || 0) % 360;
    const TOL = 0.5;
    return !(r <= TOL || Math.abs(r - 180) <= TOL || Math.abs(r - 360) <= TOL);
}
// 图片渲染尺寸（缩放后）是否在任一方向实际超出视口——即"放大到有内容可平移"。
// 小于视口的图片平移无意义，且 clampPan 会把它拉回居中（表现为拖动弹回锚点）。
function _isZoomedBeyondViewport() {
    const w = lbWrap(); if (!w || !stage) return false;
    const sr = stage.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    return wr.width > sr.width + 1 || wr.height > sr.height + 1;
}
function onGs(e) {
    if (!state.lightboxOpen || state.menuOpen) return;
    if (e.target.closest('#lbMoreBtn,#lbCloseBtn,.audio-toggle')) return;
    // 阻止触摸产生的「兼容鼠标事件」(synthetic mousedown/move/up)：
    // 否则一次触摸滑动会先由 touchend(onGe) 触发一次手势，随后浏览器再合成一套 mouse 事件
    // 在 document 上触发 onGeMouse，导致同一滑动被判定两次（如同时「打开菜单 + 标记喜欢」）。
    // 按钮区域已在上面 return（不 preventDefault，保留点击）；其余触摸一律掐断合成链。
    if (e.touches && e.cancelable) e.preventDefault();
    // 双指捏合缩放
    if (e.touches && e.touches.length === 2) { startPinch(e); state.dragging = true; _setAudioBtnsVisible(false); return; }
    // 缩放/旋转后：单指/鼠标拖动 = 平移看图（不做投票/翻页手势）。
    // 判据必须是「图片渲染尺寸实际超出视口」而非 scale 值：
    // 此前用 Math.abs(s-1)>0.01 会把 1.15x 这种「放大后仍小于视口」的图片也
    // 拉进平移模式，而 clampPan 对小于视口的图片强制归零居中 → 一拖就弹回锚点。
    // 只有当图片任一边实际大于视口（放大到有内容可平移）才进 panning；
    // 缩小态（s<1，图片必然小于视口）走普通手势（翻页），不再有"拖动重置大小"
    // 问题（普通拖动分支已保留 scale/rotate，且 _resetLbWrapAndGestures 同步 state）。
    if (_isZoomedBeyondViewport() || _isRotated()) {
        state.dragging = true; state.panning = true;
        const pt = e.touches ? e.touches[0] : e;
        state.dragStart = { x: pt.clientX, y: pt.clientY };
        state.dragCurrent = { x: pt.clientX, y: pt.clientY };
        const w = lbWrap(); if (w) w.style.transition = 'none';
        _setAudioBtnsVisible(false);
        return;
    }
    state.dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    state.dragStart = { x: pt.clientX, y: pt.clientY };
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const w = lbWrap(); if (w) w.style.transition = 'none';
    _setAudioBtnsVisible(false);
    resetGestures();
}
function onGm(e) {
    if (!state.dragging || state.menuOpen) return;
    // 捏合缩放 + 双指旋转（与缩放同 anchor，归一化角度差避免 179↔-179 跨零跳变）
    if (e.touches && e.touches.length === 2) {
        if (!pinch) startPinch(e);
        const t0 = e.touches[0], t1 = e.touches[1];
        const sr = stage.getBoundingClientRect();
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const d = Math.hypot(dx, dy) || 1;
        const curAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        const rotDelta = _normAngleDelta(curAngle - pinch.angle);
        const cx = (t0.clientX + t1.clientX) / 2 - sr.left;
        const cy = (t0.clientY + t1.clientY) / 2 - sr.top;

        // 1) 先把 zoom 按双指锚点缩放（沿用 zoomTo 的锚点计算，不做 clampPan 因为拖动中）
        //    锚点公式要求 (s,x,y) 同时刻：这里全部用 pinch 起始值，ns 只依赖 d/pinch.dist，
        //    每帧从起始状态独立计算，避免累积漂移。
        //    下限 0.5 允许缩小；旋转态锚点钉中心（同 zoomTo，防 rotate 破坏锚点数学导致飞走）
        const ns = Math.min(8, Math.max(0.5, pinch.s * (d / pinch.dist)));
        const Sx = sr.width / 2, Sy = sr.height / 2;
        const s = pinch.s, x = pinch.x, y = pinch.y;
        const ax = _isRotated() ? Sx : cx;
        const ay = _isRotated() ? Sy : cy;
        state.zoom.s = ns;
        state.zoom.x = (ax - Sx) - ns * (ax - Sx - x) / s;
        state.zoom.y = (ay - Sy) - ns * (ay - Sy - y) / s;
        // 2) 叠加旋转相对增量（以 pinch 起始为基准，避免累积浮点漂移）
        state.zoom.r = pinch.r + rotDelta;
        scheduleZoomRender();
        if (e.cancelable) e.preventDefault();
        return;
    }
    // 放大状态下平移
    if (state.panning) {
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - state.dragStart.x;
        const dy = pt.clientY - state.dragStart.y;
        state.dragCurrent = { x: pt.clientX, y: pt.clientY };
        state.zoom.x += dx; state.zoom.y += dy;
        state.dragStart = { x: pt.clientX, y: pt.clientY };
        scheduleZoomRender();
        if (e.cancelable) e.preventDefault();
        return;
    }
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - state.dragStart.x;
    const dy = pt.clientY - state.dragStart.y;
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const w = lbWrap();
    // 拖动预览必须保留当前缩放/旋转（滚轮缩放后 s≠1 时，写死 scale(1) 会让视觉瞬间回到原始大小，
    // 与 state.zoom.s 不一致 → 松手后 transform 复位、再次拖动却按 state 突然跳回缩放大小）
    if (w) w.style.transform = `translate(${dx}px, ${dy}px) scale(${state.zoom.s}) rotate(${(state.zoom.r || 0).toFixed(2)}deg)`;

    const ax = Math.abs(dx), ay = Math.abs(dy);
    let dir = null, dist = 0;
    if (ax > ay) { dir = dx > 0 ? 'right' : 'left'; dist = ax; } else { dir = dy > 0 ? 'down' : 'up'; dist = ay; }
    const ratio = Math.min(dist / THRESHOLD, 1);
    resetGestures();
    if (dist > 10) {
        const g = $(dir === 'left' ? '#giLeft' : dir === 'right' ? '#giRight' : dir === 'down' ? '#giDown' : '#giUp');
        if (g) {
            g.style.opacity = ratio;
            const base = dir === 'left' || dir === 'right' ? 'translateY(-50%)' : 'translateX(-50%)';
            g.style.transform = base + ` scale(${0.8 + ratio * 0.4})`;
        }
    }
    if (e.cancelable) e.preventDefault();
}
function onGe(e) {
    if (!state.dragging || state.menuOpen) return;
    // 触摸结束：掐断随后浏览器合成的 click/mouse 事件（见 onGs 注释），避免同一滑动被判定两次；
    // 同时设一个防御窗口，即便仍有 stray mouse 事件也直接忽略（见 onGeMouse）。
    if (e.changedTouches) {
        if (e.cancelable) e.preventDefault();
        state._suppressMouseUntil = Date.now() + 600;
    }
    // 捏合结束：吸附到最近的 90°（iOS / Google Photos 主流行为）
    if (pinch) {
        const w = lbWrap();
        // 吸附到最近的 90°（iOS / Google Photos 主流行为）。
        // 关键：保留为「连续的有符号值」——Math.round(r/90)*90 的结果本就在当前角度 ±45° 内，
        // 不要强行取模到 [0,360)（如把手势中渲染的 -90° 变成 270°），
        // 否则 CSS transition 在 rotate(-90deg)→rotate(270deg) 间会插值出 360° 整圈旋转，
        // 用户感知就是「逆时针转 90° 却多转了一大圈」。
        let r = (state.zoom.r || 0);
        const snapped = Math.round(r / 90) * 90;
        state.zoom.r = snapped;
        if (state.zoom.s <= 1.01) { state.zoom.x = 0; state.zoom.y = 0; }
        else clampPan();
        if (w) {
            w.style.transition = 'transform .2s ease';
            applyZoomTransform();
            w.style.willChange = 'auto';
            setTimeout(() => { try { w.style.transition = 'none'; } catch (_) { } }, 210);
        } else {
            applyZoomTransform();
        }
        pinch = null; state.dragging = false; _setAudioBtnsVisible(true);
        return;
    }
    // 触摸轻点：双击缩放 / 单击空白关闭。
    // 必须放在 panning 分支之前：放大后（图片超出视口）onGs 会把单指触摸判为平移
    // （panning=true），若 panning 先 return，双击缩小和单击空白关闭都永远到不了。
    if (e && e.changedTouches && e.changedTouches.length) {
        const t = e.changedTouches[0];
        const moved = Math.hypot(state.dragCurrent.x - state.dragStart.x, state.dragCurrent.y - state.dragStart.y);
        if (moved < 12) {
            const now = Date.now();
            const isDbl = state._lastTap && (now - state._lastTap.t) < 300 && Math.hypot(t.clientX - state._lastTap.x, t.clientY - state._lastTap.y) < 40;
            if (isDbl) {
                const sr = stage.getBoundingClientRect();
                if (state.zoom.s > 1.01) resetZoom();
                else zoomTo(2.5, t.clientX - sr.left, t.clientY - sr.top);
                state._lastTap = null;
                state.dragging = false; state.panning = false;
                _setAudioBtnsVisible(true);
                return;
            }
            state._lastTap = { t: now, x: t.clientX, y: t.clientY };
            // 单击且落在媒体/顶栏/圆点之外（触摸下合成 click 已被 preventDefault 掐断，须在此处理）
            const tg = e.target;
            if (tg && tg.closest && !tg.closest('.lb-media-wrap,.lb-top,.lb-dots,.audio-toggle,#lbMoreBtn,#lbCloseBtn')) {
                state.dragging = false; state.panning = false;
                closeLightbox();
                return;
            }
        }
    }
    // 平移结束
    if (state.panning) {
        state.dragging = false; state.panning = false;
        clampPan();
        _setAudioBtnsVisible(true);
        return;
    }
    state.dragging = false;
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    _triggerGestureByDrag(dx, dy);
    _resetLbWrapAndGestures(true);
}

function triggerGesture(dir) {
    if (!state.lightboxOpen || state.menuOpen) return;
    const p = curPhoto();
    if (!p) return;
    const w = lbWrap();
    if (w) { w.style.transition = 'transform .2s ease'; w.style.transform = 'translate(0,0)'; }

    if (dir === 'left' || dir === 'right') {
        const delta = dir === 'left' ? +1 : -1;
        const giId = dir === 'left' ? '#giLeft' : '#giRight';
        const gi = $(giId); gi.style.opacity = 1; gi.style.transform = 'translateY(-50%) scale(1.2)';

        // 先读本地是否已投过，再进行乐观更新（避免本地判断被新状态影响）
        const alreadyLocal = Store.getMyVote(p.id) === delta;
        const dirLabel = delta === 1 ? '喜欢' : '不喜欢';

        // 本地乐观更新后立刻刷新 UI（不阻塞，不等服务器）
        const rPromise = Store.setLike(p.id, delta);

        toast(alreadyLocal ? `已标记过${dirLabel}` : `已标记${dirLabel}`,
            delta === 1 ? 'heart' : 'alert');

        updateLightboxVotes(p);
        updateCardStatsById(p.id);

        // 异步收尾：服务器回来后 → 刷新全局数据（更新其他图的最新投票、新增图等）
        rPromise.then(() => {
            try { return Store.load(); } catch (_) { return Store.photos; }
        }).then(() => {
            const cp = curPhoto();
            if (cp) {
                updateLightboxVotes(cp);
                updateCardStatsById(cp.id);
            }
            if (state.lightboxOpen) renderDots();
        }).catch(() => { });

        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'down') {
        const gi = $('#giDown'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        downloadUrl(p.url + '?dl=1', dlName(p));
        toast('开始下载', 'download');
        setTimeout(() => { resetGestures(); }, 250);
    } else if (dir === 'up') {
        const gi = $('#giUp'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        setTimeout(() => { resetGestures(); openMenu(); }, 200);
    }
}
function onGeMouse() {
    if (!state.dragging || state.menuOpen) return;
    // 防御：触摸刚结束的窗口内（state._suppressMouseUntil）忽略合成 mouse 手势，避免同一滑动被判定两次
    if (state._suppressMouseUntil && Date.now() < state._suppressMouseUntil) {
        state.dragging = false;
        return;
    }
    state.dragging = false;
    // 平移结束：保留缩放/旋转（与触摸 onGe 的 panning 分支一致）。
    // 此前缺此分支——滚轮缩放后鼠标拖动松手会走 _resetLbWrapAndGestures 把 transform 清成
    // translate(0,0)（视觉 scale 1），但 state.zoom.s 仍保留滚轮值；再次 mousedown 时 onGs
    // 按 s>1.01 进 panning，applyZoomTransform 又把 scale 突然加回来（"恢复原大小↔跳回缩放大小"）。
    if (state.panning) {
        state.panning = false;
        clampPan();
        _setAudioBtnsVisible(true);
        return;
    }
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    _triggerGestureByDrag(dx, dy);
    _resetLbWrapAndGestures(true);
}

stage = $('#lbStage');
stage.addEventListener('mousedown', onGs);
document.addEventListener('mousemove', onGm);
document.addEventListener('mouseup', () => { if (state.dragging) onGeMouse(); });
stage.addEventListener('touchstart', onGs, { passive: false });
stage.addEventListener('touchmove', onGm, { passive: false });
stage.addEventListener('touchend', onGe);
// 触摸被系统手势/边缘中断（touchcancel 代替 touchend）时，必须复位拖拽状态并归位，否则会卡住 dragging 导致后续误触发
stage.addEventListener('touchcancel', () => {
    if (!state.lightboxOpen) return;
    state.dragging = false; state.panning = false;
    if (pinch) pinch = null;
    _resetLbWrapAndGestures(true);
});
// 缩放：滚轮 / 双击
stage.addEventListener('wheel', (e) => {
    if (!state.lightboxOpen) return;
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomTo(state.zoom.s * factor, e.clientX - sr.left, e.clientY - sr.top);
}, { passive: false });
stage.addEventListener('dblclick', (e) => {
    if (!state.lightboxOpen) return;
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    if (state.zoom.s > 1.01) resetZoom();
    else zoomTo(2.5, e.clientX - sr.left, e.clientY - sr.top);
});

/* =========================================================
   更多菜单
   ========================================================= */
function openMenu() { state.menuOpen = true; $('#menuMask').classList.add('show'); $('#menu').classList.add('show'); }
function closeMenu() { state.menuOpen = false; $('#menuMask').classList.remove('show'); $('#menu').classList.remove('show'); }
$('#lbMoreBtn').addEventListener('click', e => { e.stopPropagation(); openMenu(); });
$('#menuMask').addEventListener('click', closeMenu);
$('#menuCancel').addEventListener('click', closeMenu);

async function copyText(txt) {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) { return false; }
}
$('#menuCopyLink').addEventListener('click', async () => {
    const ok = await copyText(curPhoto().url);
    toast(ok ? '已复制直链' : '复制失败', ok ? 'success' : 'alert');
    closeMenu();
});
$('#menuCopyImage').addEventListener('click', async () => {
    closeMenu();
    toast('正在准备图片…', 'info'); // 提前反馈，处理在后台进行
    try {
        let blob = await (await fetch(curPhoto().url)).blob();
        // ClipboardItem 的 type 必须与 blob 实际 MIME 一致（Chrome 校验，不匹配直接抛错）。
        // 图库是 webp：webp 在系统剪贴板支持有限，统一 canvas 转 png 保证复制成功率。
        if (blob.type !== 'image/png') {
            const bmp = await createImageBitmap(blob);
            if (typeof OffscreenCanvas !== 'undefined') {
                // OffscreenCanvas.convertToBlob 编码异步执行，不阻塞主线程；
                // 移动端 document canvas 的 toBlob 同步编码大图会卡 UI（卡顿主因）
                const oc = new OffscreenCanvas(bmp.width, bmp.height);
                oc.getContext('2d').drawImage(bmp, 0, 0);
                blob = await oc.convertToBlob({ type: 'image/png' });
            } else {
                const c = document.createElement('canvas');
                c.width = bmp.width; c.height = bmp.height;
                c.getContext('2d').drawImage(bmp, 0, 0);
                blob = await new Promise(res => c.toBlob(res, 'image/png'));
            }
            bmp.close();
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已复制图片', 'success');
    } catch (e) {
        toast('复制失败，已复制直链', 'alert');
        copyText(curPhoto().url);
    }
});
$('#menuShare').addEventListener('click', async () => {
    const p = curPhoto();
    if (navigator.share) {
        try { await navigator.share({ title: dlName(p), url: p.url }); } catch (e) { }
    } else {
        await copyText(p.url);
        toast('已复制链接', 'success');
    }
    closeMenu();
});
$('#menuGoogle').addEventListener('click', () => {
    // 使用 Google Lens 新版 URL（旧 searchbyimage 在多数地区会丢失 image_url 参数并重定向到首页）
    window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(curPhoto().url), '_blank', 'noopener');
    toast('打开 Google 搜图', 'info');
    closeMenu();
});

async function downloadUrl(url, name) {
    const a = el('a');
    a.download = name || 'download';
    try {
        // 同源 fetch Blob 再触发下载：彻底避免 Safari / SW 拦截下"下载 + 新标签预览"同时发生，
        // 也保证文件名不被后端 Content-Disposition 覆盖（download 属性在 blob: URL 上 100% 生效）。
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        // Firefox 对 image/* 类型的 blob 下载有已知 bug（即使 download 属性也会直接打开预览）；
        // 统一强制 application/octet-stream——Firefox/Chrome 对非可预览类型只下载不打开，
        // 文件名由 download 属性指定（blob: 同源，属性必生效）。
        const dlBlob = new Blob([blob], { type: 'application/octet-stream' });
        a.href = URL.createObjectURL(dlBlob);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (_) {
        // 兜底：fetch 失败（如 CORS/离线）。仅同源 URL 可用 <a download>（Firefox/Safari
        // 对跨源 download 属性会完全忽略并导航/打开图片）；跨源一律不裸点，提示代替。
        let sameOrigin = false;
        try { sameOrigin = new URL(url, location.href).origin === location.origin; } catch (_) { }
        if (sameOrigin) {
            a.href = url;
            document.body.appendChild(a); a.click(); a.remove();
        } else {
            toast('下载失败，请重试', 'alert');
        }
    }
}

/* =========================================================
   初始化
   ========================================================= */
let _resumeWorkerListener = null;
function resumeRunningTask() {
    if (!TaskWorker.isSupported()) return;
    const types = ['upload', 'delete', 'download'];
    const activeTypes = [];
    for (var ti = 0; ti < types.length; ti++) {
        var tt = TaskWorker.getTask(types[ti]);
        if (tt && tt.status === 'running') activeTypes.push(types[ti]);
    }
    if (activeTypes.length === 0) return;
    var resumedType = activeTypes[0];
    var t = TaskWorker.getTask(resumedType);
    _mode = resumedType;
    resetProgressUI();
    setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed, done: t.done, skipped: t.skipped, failed: t.failed });
    var msgMap = { delete: '删除', download: '下载', upload: '上传' };
    var extraNote = activeTypes.length > 1 ? `（共 ${activeTypes.length} 个）` : '';
    toast('已恢复 ' + (msgMap[resumedType] || resumedType) + ' 进度' + extraNote, 'info');
    if (_resumeWorkerListener) _resumeWorkerListener();
    _resumeWorkerListener = TaskWorker.onMessage(function (msg) {
        if (msg.type === 'task-update' && msg.task && activeTypes.indexOf(msg.task.type) >= 0) {
            var mt = msg.task;
            if (mt.type === resumedType || !TaskWorker.getTask(resumedType) || TaskWorker.getTask(resumedType).status !== 'running') {
                _mode = mt.type;
                setProgress(mt.progress, mt.curFile, mt.step, { stat: mt.extraStat || '', remaining: mt.total - mt.done - mt.skipped - mt.failed, done: mt.done, skipped: mt.skipped, failed: mt.failed });
            }
        }
        if (msg.type === 'task-clear' && activeTypes.indexOf(msg.taskType) >= 0) {
            var i2 = activeTypes.indexOf(msg.taskType);
            if (i2 >= 0) activeTypes.splice(i2, 1);
            if (activeTypes.length === 0) {
                setTimeout(function () { resetProgressUI(); _mode = 'upload'; }, 2500);
                if (_resumeWorkerListener) { var l = _resumeWorkerListener; _resumeWorkerListener = null; l(); }
            }
        }
        if (msg.type === 'delete-complete') {
            (async function () {
                await Store.load(true);
                exitMulti();
                renderMasonry();
            })();
        }
        if (msg.type === 'download-complete' && msg.zipUrl) {
            // 多标签去重：仅发起页弹下载。resume 页 tabId 不匹配（刷新后 TAB_ID 已变）时提示但不下载，避免双端弹窗。
            if (msg.tabId && msg.tabId !== TAB_ID) {
                toast('已在其他页面完成下载', 'info');
                setTimeout(function () { URL.revokeObjectURL(msg.zipUrl); }, 60000);
                return;
            }
            downloadUrl(msg.zipUrl, msg.fileName || 'download.zip');
            setTimeout(function () { URL.revokeObjectURL(msg.zipUrl); }, 60000);
            toast('下载完成', 'success');
        }
        if (msg.type === 'upload-complete') {
            (async function () {
                await Store.load(true);
                renderMasonry();
            })();
        }
    });
}

(async function init() {
    // 跨域部署支持（?api= 指定后端）已按需求移除：前端固定同源 Worker API
    renderIcons();
    updateSortUI();
    try { await checkAdmin(); } catch (_) { state.isAdmin = false; }
    try { await Store.load(); } catch (_) { /* 空状态也能渲染 empty */ }
    try { renderMasonry(); } catch (e) { console.error('[infoto] renderMasonry', e); }
    try { installInfiniteScroll(); } catch (_) { }

    // 页面加载 / 重新可见时：尝试恢复后台正在进行的任务进度
    try { resumeRunningTask(); } catch (_) { }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            try { TaskWorker.connect(); resumeRunningTask(); } catch (_) { }
        }
    });
    window.addEventListener('pageshow', () => {
        try { TaskWorker.connect(); resumeRunningTask(); } catch (_) { }
    });
})();