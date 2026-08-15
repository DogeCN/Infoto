/* =========================================================
   图标库（内联 SVG，lucide 风格路径，无外部依赖）
   ========================================================= */
const ICONS = {
    'aperture': '<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>',
    'upload-cloud': '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/>',
    'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'clock-desc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'clock-asc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'more': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
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

/* =========================================================
   配置
   ========================================================= */
const CONFIG = {
    API_BASE: '',
    CDEAA_LIMIT: 600 * 1024,
    CHUNK_SIZE: 1024 * 1024,
    CONCURRENCY: 3,
    MAX_RETRY: 3,
};

async function sha256Hex(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- 无损压缩（JXL，libjxl WASM；压缩率实测优于 WebP，effort=7 最快） ---- */
// 编码是 CPU 密集的 WASM 运算，放在 Web Worker 里跑，避免阻塞主线程导致上传时界面卡顿
let jxlWorker = null;
function getJxlWorker() {
    if (!jxlWorker) {
        jxlWorker = new Worker('/jxl-worker.js', { type: 'module' });
    }
    return jxlWorker;
}

async function fileToImageData(file) {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function compressLossless(file) {
    try {
        const data = await fileToImageData(file);
        const worker = getJxlWorker();
        const buf = await new Promise((resolve, reject) => {
            const id = Math.random().toString(36).slice(2);
            const onMsg = (e) => {
                if (!e.data || e.data.id !== id) return;
                worker.removeEventListener('message', onMsg);
                if (e.data.ok) resolve(e.data.buf);
                else reject(new Error(e.data.error || 'jxl encode failed'));
            };
            worker.addEventListener('message', onMsg);
            worker.addEventListener('error', (ev) => {
                worker.removeEventListener('message', onMsg);
                reject(new Error(ev.message || 'jxl worker error'));
            }, { once: true });
            // 把像素缓冲转移（零拷贝）给 Worker 编码，避免大图在主线程额外复制
            worker.postMessage(
                { id, width: data.width, height: data.height, buffer: data.data.buffer },
                [data.data.buffer]
            );
        });
        return new Blob([buf], { type: 'image/jxl' });
    } catch (e) {
        console.warn('[infoto] JXL 压缩失败，使用原文件', e);
        return null;
    }
}

/* ---- 旧 JXL 照片解码兜底（浏览器不支持 JXL 时转 PNG 显示） ---- */
let jxlDecode = null;
async function loadJxlDecode() {
    if (jxlDecode) return jxlDecode;
    const mod = await import('https://cdn.jsdelivr.net/npm/@jsquash/jxl@1.2.0/+esm');
    jxlDecode = mod.decode;
    return jxlDecode;
}
async function decodeJxlToPng(url) {
    const decode = await loadJxlDecode();
    const buf = await (await fetch(url)).arrayBuffer();
    const data = await decode(buf);
    const canvas = document.createElement('canvas');
    canvas.width = data.width; canvas.height = data.height;
    canvas.getContext('2d').putImageData(data, 0, 0);
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* ---- 图床上传 ---- */
function uploadViaXhr(url, fd, headers, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        for (const k in headers) xhr.setRequestHeader(k, headers[k]);
        // 防止网络停滞导致永久挂起：超时即失败，让上层弹出错误提示而不是静默卡死
        xhr.timeout = 30000;
        xhr.ontimeout = () => reject(new Error('上传超时（30s）'));
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => { xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status)); };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(fd);
    });
}

async function withRetry(fn, retries) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) {
            lastErr = e;
            if (i < retries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw lastErr;
}

async function uploadPartToCdeaa(blob, name) {
    return withRetry(async () => {
        const fd = new FormData();
        fd.append('file', blob, name);
        const txt = await uploadViaXhr('https://cdeaa.qdqqd.com/public/resource/oss/put-file-attach', fd, {});
        const json = JSON.parse(txt);
        if (!(json.data && json.data.link)) throw new Error('上传响应缺少 link');
        return 'https://www.lnjubao.cn' + json.data.link;
    }, CONFIG.MAX_RETRY);
}

async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let next = 0;
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
        workers.push((async () => {
            while (next < tasks.length) {
                const i = next++;
                results[i] = await tasks[i]();
            }
        })());
    }
    await Promise.all(workers);
    return results;
}

async function uploadToBed(blob, name, onProgress) {
    onProgress(0.05);
    const parts = [];
    if (blob.size <= CONFIG.CDEAA_LIMIT) {
        onProgress(0.5);
        parts.push(await uploadPartToCdeaa(blob, name));
        onProgress(1);
        return parts;
    }
    const total = Math.ceil(blob.size / CONFIG.CHUNK_SIZE);
    const chunkProgress = new Array(total).fill(0);
    function updateOverall() {
        const avg = chunkProgress.reduce((a, b) => a + b, 0) / total;
        onProgress(0.05 + avg * 0.9);
    }
    const tasks = [];
    for (let i = 0; i < total; i++) {
        const idx = i;
        const chunk = blob.slice(idx * CONFIG.CHUNK_SIZE, Math.min((idx + 1) * CONFIG.CHUNK_SIZE, blob.size));
        const chunkName = `${name}.part${idx + 1}`;
        tasks.push(async () => {
            let lastP = 0;
            const link = await uploadPartToTcProgressive(chunk, chunkName, p => {
                chunkProgress[idx] = lastP = p;
                updateOverall();
            });
            chunkProgress[idx] = 1;
            updateOverall();
            return { idx, link };
        });
    }
    const results = await runWithConcurrency(tasks, CONFIG.CONCURRENCY);
    results.sort((a, b) => a.idx - b.idx);
    for (const r of results) parts.push(r.link);
    onProgress(1);
    return parts;
}

async function uploadPartToTcProgressive(blob, name, onProgress) {
    return withRetry(async () => {
        const sha = await sha256Hex(await blob.arrayBuffer());
        const fd = new FormData();
        fd.append('file', blob, name);
        // 不再前端签名：由 Worker 用服务端密钥签发 tc token（见 /api/upload-proxy）
        const txt = await uploadViaXhr(apiBase() + '/api/upload-proxy', fd, { 'X-File-Sha256': sha }, onProgress);
        const json = JSON.parse(txt);
        if (!json.data) throw new Error('上传响应缺少 data');
        return json.data;
    }, CONFIG.MAX_RETRY);
}

function apiBase() { return CONFIG.API_BASE || ''; }

function fileUrl(id) {
    const base = apiBase() || location.origin;
    return base + '/api/file/' + id;
}

/* =========================================================
   数据层：Cloudflare Worker 同源 API
   ========================================================= */
const Store = {
    photos: [],
    _loaded: false,

    async load() {
        if (this._loaded) return this.photos;
        this._loaded = true;
        try {
            const r = await fetch(apiBase() + '/api/photos', { cache: 'no-store' });
            if (r.ok) { this.photos = await r.json(); return this.photos; }
        } catch (e) { console.warn('[infoto] 加载失败', e); }
        this.photos = [];
        return this.photos;
    },

    async save(photo) {
        await fetch(apiBase() + '/api/photos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(photo)
        });
    },

    async add(photo) {
        photo.id = photo.id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        this.photos.unshift(photo);
        await this.save(photo);
        return photo;
    },
    async setLike(id, delta) {
        const p = this.photos.find(x => x.id === id);
        if (!p) return { ok: false, already: false };
        try {
            const r = await fetch(apiBase() + '/api/vote', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, delta })
            });
            const j = await r.json();
            if (j.ok) {
                p.likes = j.likes; p.dislikes = j.dislikes;
                return { ok: true, already: false };
            }
            if (j.already) {
                return { ok: false, already: true };
            }
        } catch (e) {
            console.warn('[infoto] 投票接口失败', e);
        }
        return { ok: false, already: false };
    }
};

/* =========================================================
   UI 状态
   ========================================================= */
const state = {
    sortBy: 'latest', latestDir: 'desc', hotestDir: 'desc',
    multiMode: false, selected: new Set(),
    longPressTimer: null, longPressTriggered: false,
    lightboxOpen: false, currentIndex: 0,
    boxSelecting: false, boxStart: null, boxArm: false, suppressClick: false,
    menuOpen: false,
    dragging: false, dragStart: null, dragCurrent: null
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };

function toast(msg, icon = 'info') {
    const t = el('div', 'toast', `<svg class="icon" data-i="${icon}"></svg><span></span>`);
    renderIcons(t);
    t.querySelector('span').textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---- 排序 ---- */
function getSorted() {
    const arr = [...Store.photos];
    if (state.sortBy === 'latest') {
        arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (state.latestDir === 'desc') arr.reverse();
    } else {
        arr.sort((a, b) => (a.likes || 0) - (b.likes || 0));
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
$('#sortLatest').addEventListener('click', () => {
    if (state.sortBy === 'latest') state.latestDir = state.latestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'latest';
    updateSortUI(); renderMasonry();
});
$('#sortHotest').addEventListener('click', () => {
    if (state.sortBy === 'hotest') state.hotestDir = state.hotestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'hotest';
    updateSortUI(); renderMasonry();
});

/* =========================================================
   瀑布流（列容器法：动态列数 + 最短列优先）
   ========================================================= */
function colCount() {
    const w = window.innerWidth;
    if (w >= 1536) return 6; if (w >= 1280) return 5; if (w >= 1024) return 4; if (w >= 768) return 3; return 2;
}
let cols = [];

function buildColumns() {
    const m = $('#masonry');
    m.innerHTML = '';
    cols = [];
    for (let i = 0; i < colCount(); i++) {
        const c = el('div', 'masonry-col');
        m.appendChild(c); cols.push(c);
    }
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
    const img = el('img', 'ph-img');
    img.loading = 'lazy';
    img.draggable = false;
    img.alt = photo.filename || 'photo';
    img.src = photo.url;
    img.onload = () => {
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (nw && nh) {
            if (photo.width !== nw || photo.height !== nh) {
                photo.width = nw; photo.height = nh;
                holder.style.paddingBottom = (nh / nw * 100) + '%';
                Store.save(photo);
            }
        }
        img.classList.add('loaded');
        skel.remove();
    };
    img.onerror = () => {
        // JXL 兼容性兜底：浏览器不支持时解码转 PNG 显示
        if ((photo.filename || '').endsWith('.jxl')) {
            decodeJxlToPng(photo.url).then(blob => {
                if (!blob) return;
                img.src = URL.createObjectURL(blob);
            }).catch(() => { skel.remove(); img.classList.add('loaded'); img.style.opacity = '.4'; });
        } else {
            skel.remove(); img.classList.add('loaded'); img.style.opacity = '.4';
        }
    };

    holder.appendChild(skel);
    holder.appendChild(img);
    card.appendChild(holder);

    if ((photo.likes || 0) > 0) {
        const badge = el('div', 'card-badge', `<svg class="icon" data-i="heart"></svg><span>${photo.likes}</span>`);
        renderIcons(badge);
        card.appendChild(badge);
    }
    const check = el('div', 'multi-check', `<svg class="icon" data-i="check"></svg>`);
    renderIcons(check);
    card.appendChild(check);
    return card;
}

function applySelectUI() {
    $$('.photo-card').forEach(c => {
        const sel = state.selected.has(c.dataset.id);
        c.classList.toggle('selected', sel);
        c.querySelector('.multi-check').style.display = state.multiMode ? 'flex' : 'none';
    });
}

function renderMasonry() {
    const list = getSorted();
    const m = $('#masonry');
    if (list.length === 0) {
        m.classList.add('hidden');
        $('#emptyState').classList.remove('hidden');
        return;
    }
    $('#emptyState').classList.add('hidden');
    m.classList.remove('hidden');
    buildColumns();

    const heights = new Array(cols.length).fill(0);
    list.forEach((photo, i) => {
        const card = makeCard(photo, i);
        let minCol = 0;
        for (let j = 1; j < cols.length; j++) if (heights[j] < heights[minCol]) minCol = j;
        cols[minCol].appendChild(card);
        const ratio = (photo.height && photo.width) ? photo.height / photo.width : 1;
        heights[minCol] += ratio * 100 + 12;
    });

    if (state.multiMode) applySelectUI();
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (colCount() !== cols.length && !state.lightboxOpen) renderMasonry();
    }, 200);
});

/* =========================================================
   多选模式
   ========================================================= */
function enterMulti(initialId) {
    state.multiMode = true;
    state.selected.clear();
    if (initialId) state.selected.add(initialId);
    $('#multiSelectBtn').querySelector('svg').setAttribute('data-i', 'x');
    $('#uploadBtn').classList.add('hidden');
    $('#multiBar').classList.add('show');
    renderIcons();
    applySelectUI();
    updateCount();
}
function exitMulti() {
    state.multiMode = false;
    state.selected.clear();
    $('#multiSelectBtn').querySelector('svg').setAttribute('data-i', 'check-square');
    $('#uploadBtn').classList.remove('hidden');
    $('#multiBar').classList.remove('show');
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
$('#multiSelectBtn').addEventListener('click', () => {
    state.multiMode ? exitMulti() : enterMulti();
});

$('#masonry').addEventListener('mousedown', onCardPress);
$('#masonry').addEventListener('touchstart', onCardPress, { passive: true });
function onCardPress(e) {
    const card = e.target.closest('.photo-card');
    if (!card) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (state.multiMode) return;
    state.longPressTriggered = false;
    clearTimeout(state.longPressTimer);
    state.longPressTimer = setTimeout(() => {
        state.longPressTriggered = true;
        if (!state.multiMode) enterMulti(card.dataset.id);
        else toggleSelect(card.dataset.id);
    }, 500);
}
['mouseup', 'mouseleave', 'touchend', 'touchmove', 'touchcancel', 'click'].forEach(ev => {
    $('#masonry').addEventListener(ev, () => {
        clearTimeout(state.longPressTimer);
    });
});
$('#masonry').addEventListener('click', (e) => {
    if (state.suppressClick) { state.suppressClick = false; return; }
    const card = e.target.closest('.photo-card');
    if (!card) return;
    if (state.longPressTriggered) return;
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
    $$('.photo-card').forEach(c => {
        const r = c.getBoundingClientRect();
        const hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
        if (hit) state.selected.add(c.dataset.id);
    });
    applySelectUI(); updateCount();
});
document.addEventListener('mouseup', () => {
    state.boxArm = false;
    if (state.boxSelecting) {
        state.boxSelecting = false;
        $('#selectionBox').style.display = 'none';
    }
});

/* ---- 批量操作 ---- */
$('#batchDownloadBtn').addEventListener('click', async () => {
    const list = getSorted().filter(p => state.selected.has(p.id));
    if (list.length === 0) { toast('请先选择照片'); return; }
    toast(`开始下载 ${list.length} 张图片`, 'download');
    list.forEach(p => downloadUrl(p.url + '?raw=1', p.filename || 'image.jpg'));
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

/* 上传进度 UI：按钮右下角小圆圈 + 悬停详情 */
function resetUploadUI() {
    const ind = $('#upIndicator');
    ind.classList.add('hidden');
    $('#upRing').style.strokeDashoffset = '97.4';
    $('#upPct').textContent = '0%';
    $('#upDone').textContent = '0';
    $('#upSkipped').textContent = '0';
    $('#upFailed').textContent = '0';
    $('#upTipFile').textContent = '准备上传…';
    $('#upTipStep').textContent = '';
}
function setUploadProgress(p, file, step) {
    const ind = $('#upIndicator');
    ind.classList.remove('hidden');
    const pct = Math.round(p * 100);
    $('#upRing').style.strokeDashoffset = String(97.4 * (1 - p));
    $('#upPct').textContent = pct + '%';
    if (file) $('#upTipFile').textContent = file;
    if (step) $('#upTipStep').textContent = step;
}

async function uploadFiles(files) {
    resetUploadUI();
    const total = files.length;
    let done = 0, failed = 0, skipped = 0;
    for (let i = 0; i < total; i++) {
        const file = files[i];
        if (file.type === 'image/svg+xml') {
            skipped++;
            $('#upSkipped').textContent = String(skipped);
            toast(`「${file.name}」SVG 暂不支持`, 'alert');
            continue;
        }
        // 整体进度 = 已处理 / 总数（单文件内部进度细化为当前文件的进度）
        const base = i / total;
        const span = 1 / total;
        // 600KB 以下小文件不压缩，直接传原格式到 cdeaa（JXL 压缩对微小文件无收益）
        const willCompress = file.type.startsWith('image/') && !/gif|svg/.test(file.type) && file.size > CONFIG.CDEAA_LIMIT;
        let stepMsg = willCompress ? 'JXL 无损压缩…' : '直传（小文件跳过压缩）';
        setUploadProgress(base, file.name, stepMsg);
        try {
            let upBlob = file;
            let upName = file.name;
            if (willCompress) {
                const jxl = await compressLossless(file);
                if (jxl && jxl.size < file.size * 0.9) {
                    upBlob = jxl;
                    upName = file.name.replace(/\.[^.]+$/, '') + '.jxl';
                }
            }
            const sha = await sha256Hex(await upBlob.arrayBuffer());
            stepMsg = '查重…';
            setUploadProgress(base, file.name, stepMsg);
            const dup = await checkHashExists(sha);
            if (dup) {
                skipped++;
                $('#upSkipped').textContent = String(skipped);
                setUploadProgress(base + span, file.name, '已存在，跳过');
                toast(`「${file.name}」已存在，跳过`, 'info');
                continue;
            }
            const parts = await uploadToBed(upBlob, upName, p => {
                setUploadProgress(base + p * span, file.name, p < 1 ? '直链上传' : '获取直链');
            });
            stepMsg = '获取尺寸…';
            setUploadProgress(base + span * 0.95, file.name, stepMsg);
            const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            const photo = {
                id, url: fileUrl(id), parts, sha256: sha,
                width: 0, height: 0, createdAt: Date.now(),
                likes: 0, dislikes: 0,
                filename: upName, originalName: file.name
            };
            await loadDims(photo);
            await Store.add(photo);
            done++;
            $('#upDone').textContent = String(done);
        } catch (err) {
            console.error('upload failed:', file.name, err);
            failed++;
            $('#upFailed').textContent = String(failed);
            toast(`「${file.name}」上传失败: ${err.message}`, 'alert');
        }
    }
    setUploadProgress(1, null, '完成');
    renderMasonry();
    const parts = [];
    if (done > 0) parts.push(`成功 ${done}`);
    if (skipped > 0) parts.push(`跳过重复 ${skipped}`);
    if (failed > 0) parts.push(`失败 ${failed}`);
    if (parts.length) toast(`上传完成：${parts.join('，')}`, done > 0 || skipped > 0 ? 'success' : 'alert');
    // 完成后短暂展示结果，再隐藏
    setTimeout(resetUploadUI, 2500);
}

async function checkHashExists(sha) {
    try {
        const r = await fetch(apiBase() + '/api/photos/hash/' + sha, { cache: 'no-store' });
        if (r.ok) {
            const j = await r.json();
            if (j && j.exists) return j.photo || true;
        }
    } catch (e) { /* ignore */ }
    return false;
}

function loadDims(photo) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { photo.width = img.naturalWidth || 0; photo.height = img.naturalHeight || 0; resolve(); };
        img.onerror = () => { photo.width = photo.width || 0; photo.height = photo.height || 0; resolve(); };
        img.src = photo.url;
        setTimeout(resolve, 8000);
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
}
function curPhoto() { return getSorted()[state.currentIndex]; }
function updateLightbox() {
    const p = curPhoto();
    if (!p) return;
    const img = $('#lbImg');
    img.style.transition = 'none';
    img.style.transform = 'translate(0,0) scale(1)';
    img.style.opacity = 1;
    img.src = p.url;
    img.alt = p.filename || 'photo';
    img.onerror = () => {
        if ((p.filename || '').endsWith('.jxl')) {
            decodeJxlToPng(p.url).then(blob => {
                if (blob) img.src = URL.createObjectURL(blob);
            }).catch(() => { });
        }
    };
    $('#lbCounter').textContent = `${state.currentIndex + 1} / ${getSorted().length}`;
    renderDots();
}
function renderDots() {
    const d = $('#lbDots');
    d.innerHTML = '';
    const list = getSorted();
    const max = Math.min(list.length, 20);
    for (let i = 0; i < max; i++) {
        const dot = el('span', 'dot' + (i === state.currentIndex ? ' active' : ''));
        d.appendChild(dot);
    }
}
function prevPhoto() { state.currentIndex = (state.currentIndex - 1 + getSorted().length) % getSorted().length; updateLightbox(); }
function nextPhoto() { state.currentIndex = (state.currentIndex + 1) % getSorted().length; updateLightbox(); }

$('#lbCloseBtn').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });

document.addEventListener('keydown', e => {
    if (!state.lightboxOpen) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
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
    else if (e.key === 'Escape') closeLightbox();
});

function resetGestures() {
    ['#giLeft', '#giRight', '#giUp', '#giDown'].forEach(s => {
        const g = $(s);
        g.style.opacity = 0; g.style.transform = '';
    });
}
function onGs(e) {
    if (!state.lightboxOpen || state.menuOpen) return;
    if (e.target.closest('#lbMoreBtn,#lbCloseBtn')) return;
    state.dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    state.dragStart = { x: pt.clientX, y: pt.clientY };
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    $('#lbImg').style.transition = 'none';
    resetGestures();
}
function onGm(e) {
    if (!state.dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - state.dragStart.x;
    const dy = pt.clientY - state.dragStart.y;
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const img = $('#lbImg');
    img.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;

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
async function triggerGesture(dir) {
    if (!state.lightboxOpen || state.menuOpen) return;
    const p = curPhoto();
    if (!p) return;
    const img = $('#lbImg');
    img.style.transition = 'transform .2s ease';
    img.style.transform = 'translate(0,0)';
    if (dir === 'left') {
        const gi = $('#giLeft'); gi.style.opacity = 1; gi.style.transform = 'translateY(-50%) scale(1.2)';
        const r = await Store.setLike(p.id, +1);
        toast(r.already ? '你已标记过喜欢这张' : '已标记为喜欢', 'heart');
        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'right') {
        const gi = $('#giRight'); gi.style.opacity = 1; gi.style.transform = 'translateY(-50%) scale(1.2)';
        const r = await Store.setLike(p.id, -1);
        toast(r.already ? '你已标记过不喜欢这张' : '已标记为不喜欢', 'alert');
        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'down') {
        const gi = $('#giDown'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        downloadUrl(p.url + '?raw=1', p.filename || 'image.jpg');
        toast('开始下载', 'download');
        setTimeout(() => { resetGestures(); }, 250);
    } else if (dir === 'up') {
        const gi = $('#giUp'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        setTimeout(() => { resetGestures(); openMenu(); }, 200);
    }
}
function onGe() {
    if (!state.dragging) return;
    state.dragging = false;
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const img = $('#lbImg');
    img.style.transition = 'transform .3s ease, opacity .3s ease';

    if (ax > ay) {
        if (ax > THRESHOLD) triggerGesture(dx > 0 ? 'right' : 'left');
    } else {
        if (ay > THRESHOLD) triggerGesture(dy > 0 ? 'down' : 'up');
    }
    img.style.transform = 'translate(0,0)';
    resetGestures();
}

const stage = $('#lbStage');
stage.addEventListener('mousedown', onGs);
document.addEventListener('mousemove', onGm);
document.addEventListener('mouseup', () => { if (state.dragging) onGe(); });
stage.addEventListener('touchstart', onGs, { passive: false });
stage.addEventListener('touchmove', onGm, { passive: false });
stage.addEventListener('touchend', onGe);

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
    catch (e) {
        try {
            const ta = el('textarea');
            ta.value = txt; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove(); return true;
        } catch (e2) { return false; }
    }
}
$('#menuCopyLink').addEventListener('click', async () => {
    const ok = await copyText(curPhoto().url);
    toast(ok ? '已复制直链到剪贴板' : '复制失败', 'success');
    closeMenu();
});
$('#menuCopyImage').addEventListener('click', async () => {
    try {
        const blob = await (await fetch(curPhoto().url)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已复制图片到剪贴板', 'success');
    } catch (e) {
        toast('复制图片失败（浏览器限制），已复制直链', 'alert');
        copyText(curPhoto().url);
    }
    closeMenu();
});
$('#menuShare').addEventListener('click', async () => {
    const p = curPhoto();
    if (navigator.share) {
        try { await navigator.share({ title: p.filename || 'Infoto 照片', url: p.url }); } catch (e) { }
    } else {
        await copyText(p.url);
        toast('已复制链接，去分享吧', 'success');
    }
    closeMenu();
});
$('#menuGoogle').addEventListener('click', () => {
    window.open('https://www.google.com/searchbyimage?image_url=' + encodeURIComponent(curPhoto().url), '_blank');
    toast('即将打开 Google 搜图', 'info');
    closeMenu();
});

function downloadUrl(url, name) {
    const a = el('a');
    a.href = url; a.download = name || 'image.jpg';
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
}

/* =========================================================
   初始化
   ========================================================= */
(async function init() {
    try {
        const q = new URLSearchParams(location.search).get('api');
        if (q) CONFIG.API_BASE = q;
    } catch (e) { }
    renderIcons();
    updateSortUI();
    await Store.load();
    renderMasonry();
})();