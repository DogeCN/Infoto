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

/* ---- 客户端有损压缩为 WebP（canvas.toBlob 原生编码，零 WASM、秒级） ----
 * 实测（用户 Favourite 图库 190 张）：quality=0.8 时 97% 照片压到原图 ~46% 且都比原图小，
 * 观感近无损；少数高细节图压不赢原图，按"比原来小才采用"规则回退原图。 */
const WEBP_QUALITY = 0.8;

async function compressToWebp(file, quality = WEBP_QUALITY) {
    try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', quality));
        return blob;
    } catch (e) {
        console.warn('[infoto] WebP 压缩失败，使用原文件', e);
        return null;
    }
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

// 统一文件名生成：不再存 filename/originalName，只使用 id + ext
// 历史老数据（没有 ext）兜底用 webp
function dlName(p) {
    const ext = (p && p.ext) ? String(p.ext).toLowerCase() : 'webp';
    return (p && p.id ? p.id : 'image') + '.' + ext;
}
function extFromNameFn(name) {
    if (!name) return '';
    const i = String(name).lastIndexOf('.');
    return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

/* =========================================================
   数据层：Cloudflare Worker 同源 API
   ========================================================= */
const Store = {
    photos: [],
    _loaded: false,
    myVotes: Object.create(null),

    async load(force = false) {
        if (this._loaded && !force) return this.photos;
        this._loaded = true;
        // 防抖：同一时刻的多次 force load 合并成一次请求（批量上传时避免雪崩）
        if (force && this._loadPromise) return this._loadPromise;
        const doFetch = async () => {
            try {
                const r = await fetch(apiBase() + '/api/photos', { cache: 'no-store' });
                if (r.ok) {
                    const fresh = await r.json();
                    // 保持 myVotes 本地状态（不替换），只刷新照片数组与计数
                    this.photos = fresh.map(p => ({ ...p, likes: p.likes ?? 0, dislikes: p.dislikes ?? 0 }));
                    return this.photos;
                }
            } catch (e) { console.warn('[infoto] 加载失败', e); }
            return this.photos;
        };
        this._loadPromise = doFetch().finally(() => { this._loadPromise = null; });
        return this._loadPromise;
    },

    getMyVote(id) { return this.myVotes[id] || 0; },

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
    /**
     * 投票：先本地乐观更新，再异步请求服务器（不阻塞浏览翻页）
     * @returns {Promise<{ok:boolean, already:boolean, delta:number}>} 最终服务器结果
     */
    setLike(id, delta) {
        const p = this.photos.find(x => x.id === id);
        if (!p) return Promise.resolve({ ok: false, already: false, delta: 0 });
        const prevLikes = p.likes || 0;
        const prevDislikes = p.dislikes || 0;
        const prevMy = this.myVotes[id] || 0;
        // 1) 本地乐观更新（立即生效，让 UI 无感知）
        if (prevMy !== delta) {
            if (prevMy === 1) p.likes = Math.max(0, prevLikes - 1);
            else if (prevMy === -1) p.dislikes = Math.max(0, prevDislikes - 1);
            if (delta === 1) p.likes = (p.likes || 0) + 1;
            else if (delta === -1) p.dislikes = (p.dislikes || 0) + 1;
            this.myVotes[id] = delta;
        }
        // 2) 异步走服务器，不阻塞 UI；最后对齐真实值
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
                    // 服务器成功：以服务器返回的精确长度为准（防并发偏差）
                    if (p) { p.likes = j.likes; p.dislikes = j.dislikes; }
                    this.myVotes[id] = delta;
                    return { ok: true, already: false, delta };
                }
                if (j.already) {
                    // 服务器拒绝：重复投票（这个 IP 之前已经投过票，方向=j.delta）。
                    // 先无条件回滚到乐观更新前的干净值，再按服务器说的历史方向补一次，
                    // 避免和上面"乐观更新"的增减重复计算导致本地计数越算越飘。
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
const state = {
    sortBy: 'latest', latestDir: 'desc', hotestDir: 'desc',
    multiMode: false, selected: new Set(),
    longPressTimer: null, longPressTriggered: false,
    lightboxOpen: false, currentIndex: 0,
    boxSelecting: false, boxStart: null, boxArm: false, suppressClick: false,
    menuOpen: false,
    dragging: false, dragStart: null, dragCurrent: null,
    batchSize: 60, loadedCount: 60,
    zoom: { s: 1, x: 0, y: 0 },
    panning: false,
    _lastTap: null
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
// 切换排序时，若 Lightbox 开着，保持当前正在看的照片不跳页
function safeResortAndKeepCurrent() {
    const oldSorted = getSorted();
    const curId = state.lightboxOpen && oldSorted[state.currentIndex] ? oldSorted[state.currentIndex].id : null;
    updateSortUI();
    if (state.lightboxOpen && curId) {
        const newIdx = getSorted().findIndex(p => p.id === curId);
        state.currentIndex = newIdx >= 0 ? newIdx : 0;
        updateLightbox(); // 重新渲染 counter / dots / 高亮
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
   瀑布流（列容器法：动态列数 + 最短列优先）
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
        skel.remove(); img.classList.add('loaded'); img.style.opacity = '.4';
    };

    holder.appendChild(skel);
    holder.appendChild(img);
    card.appendChild(holder);

    const likes = photo.likes || 0;
    const dislikes = photo.dislikes || 0;
    const myVote = Store.getMyVote(photo.id);

    const stats = el('div', 'card-stats');
    if (likes > 0 || dislikes > 0) {
        const likeBadge = el('div', 'card-badge card-badge-like' + (myVote === 1 ? ' active' : ''),
            `<svg class="icon" data-i="heart"></svg><span>${likes}</span>`);
        const dislikeBadge = el('div', 'card-badge card-badge-dislike' + (myVote === -1 ? ' active' : ''),
            `<svg class="icon" data-i="x-circle"></svg><span>${dislikes}</span>`);
        stats.appendChild(likeBadge);
        stats.appendChild(dislikeBadge);
        renderIcons(stats);
        card.appendChild(stats);
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
    renderedCount = 0;
    // 首屏只渲染前 loadedCount 张，其余由无限滚动按需 append
    appendVisible();
}

// 把尚未渲染的前 loadedCount 张追加到最短列（不重建已有 DOM，避免滚动跳动 / 图片重载）
function appendVisible() {
    const list = getSorted();
    const visible = list.slice(0, state.loadedCount);
    if (visible.length <= renderedCount) {
        if (state.multiMode) applySelectUI();
        return;
    }
    const heights = cols.map(c => c._h || 0);
    for (let i = renderedCount; i < visible.length; i++) {
        const photo = visible[i];
        const card = makeCard(photo, i);
        let minCol = 0;
        for (let j = 1; j < cols.length; j++) if (heights[j] < heights[minCol]) minCol = j;
        cols[minCol].appendChild(card);
        const ratio = (photo.height && photo.width) ? photo.height / photo.width : 1;
        heights[minCol] += ratio * 100 + 12;
        cols[minCol]._h = heights[minCol];
    }
    renderedCount = visible.length;
    if (state.multiMode) applySelectUI();
}

// 无限滚动：底部哨兵进入视口时多加载一批
function installInfiniteScroll() {
    const sentinel = el('div', 'scroll-sentinel');
    sentinel.id = 'scrollSentinel';
    $('#masonry').after(sentinel);
    const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
            if (en.isIntersecting && state.loadedCount < getSorted().length) {
                state.loadedCount = Math.min(getSorted().length, state.loadedCount + state.batchSize);
                appendVisible();
            }
        });
    }, { rootMargin: '1200px' });
    io.observe(sentinel);
}

// 只更新每张卡片的投票数/高亮（轻量 DOM patch），不重建整列瀑布流。
// 投票、异步 load 收尾时调用，避免图片重新加载、滚动跳动、框选状态丢失。
function updateMasonryStatsOnly() {
    $$('.photo-card').forEach(card => {
        const id = card.dataset.id;
        const p = Store.photos.find(x => x.id === id);
        if (!p) return;
        const myVote = Store.getMyVote(id);
        const likes = p.likes || 0, dislikes = p.dislikes || 0;
        const stats = card.querySelector('.card-stats');
        const haveVotes = likes > 0 || dislikes > 0;
        if (!stats && !haveVotes) return;
        const html = haveVotes
            ? `${likes > 0 ? `<div class="card-badge card-badge-like${myVote === 1 ? ' active' : ''}"><svg class="icon" data-i="heart"></svg><span>${likes}</span></div>` : ''}`
            + `${dislikes > 0 ? `<div class="card-badge card-badge-dislike${myVote === -1 ? ' active' : ''}"><svg class="icon" data-i="x-circle"></svg><span>${dislikes}</span></div>` : ''}`
            : '';
        if (!stats) {
            if (html === '') return;
            const s = el('div', 'card-stats', html);
            card.appendChild(s);
            renderIcons(s);
        } else if (html === '') {
            stats.remove();
        } else {
            stats.innerHTML = html;
            renderIcons(stats);
        }
    });
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
// JSZip 用动态 import（项目零 npm 依赖），首次用到才加载
let _jszip = null;
async function getZipLib() {
    if (_jszip) return _jszip;
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    _jszip = JSZip;
    return _jszip;
}
$('#batchDownloadBtn').addEventListener('click', async () => {
    const list = getSorted().filter(p => state.selected.has(p.id));
    if (list.length === 0) { toast('请先选择照片'); return; }
    // 单张直接下（不打包）
    if (list.length === 1) {
        return downloadUrl(list[0].url + '?dl=1', list[0].filename || 'image.jpg');
    }
    // 多张打包成单个 zip：只触发 1 次浏览器下载框，不被并发限制拦截
    const JSZip = await getZipLib();
    const zip = new JSZip();
    const total = list.length;
    const runId = Date.now().toString(36);
    _uploadTotal = total;
    toast(`正在打包 ${total} 张图片…`, 'download');
    let done = 0;
    for (let i = 0; i < total; i++) {
        const p = list[i];
        try {
            const r = await fetch(p.url, { cache: 'force-cache' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const blob = await r.blob();
            done++;
            const idx = String(done).padStart(3, '0');
            const base = String(p.originalName || p.filename || 'image').replace(/[\\/:*?"<>|]/g, '_');
            zip.file(`${idx}_${base}`, blob, { binary: true });
            setUploadProgress(done / total, base, '打包 zip…');
        } catch (e) {
            toast(`下载失败: ${p.filename || '?'}`, 'alert');
        }
    }
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        setUploadProgress(meta.percent / 100, `生成 zip ${meta.percent.toFixed(0)}%`, '打包 zip…');
    });
    const url = URL.createObjectURL(zipBlob);
    downloadUrl(url, `infoto_${total}张_${runId}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`下载完成：共 ${total} 张 → zip`, 'success');
    setUploadProgress(1, null, '完成');
    setTimeout(resetUploadUI, 2500);
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
let _uploadTotal = 0;
let _uploadDoneLike = 0;
function resetUploadUI() {
    const ind = $('#upIndicator');
    ind.classList.add('hidden');
    $('#upRing').style.strokeDashoffset = '94.25';
    $('#upPct').textContent = '0';
    $('#upDone').textContent = '0';
    $('#upSkipped').textContent = '0';
    $('#upFailed').textContent = '0';
    $('#upTipFile').textContent = '待上传';
    $('#upTipStep').textContent = '准备中';
    _uploadTotal = 0;
    _uploadDoneLike = 0;
}
function setUploadProgress(p, file, step) {
    const ind = $('#upIndicator');
    ind.classList.remove('hidden');
    $('#upRing').style.strokeDashoffset = String(94.25 * (1 - p));
    const finishedExact = _uploadDoneLike + p;
    const remaining = Math.max(0, Math.ceil(_uploadTotal - finishedExact));
    $('#upPct').textContent = String(remaining);
    if (file) $('#upTipFile').textContent = file;
    if (step) $('#upTipStep').textContent = step;
}

async function uploadFiles(files) {
    resetUploadUI();
    const total = files.length;
    _uploadTotal = total;
    let done = 0, failed = 0, skipped = 0;
    _uploadDoneLike = 0;

    // 阶段 1：并发 3 路做【压缩 + SHA】（纯 CPU/哈希，无副作用，可安全并发）
    setUploadProgress(0.01, null, '预处理中…');
    const prepTasks = files.map((file, idx) => async () => {
        const base = { idx, file, err: null, blob: null, ext: extFromNameFn(file.name) || 'bin', sha: null };
        if (file.type === 'image/svg+xml') { base.err = new Error('SVG 暂不支持'); return base; }
        try {
            const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name);
            const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
            const isPic = file.type.startsWith('image/') && !isGif;
            let blob = file;
            if (isPic && file.type !== 'image/webp') {
                const webp = await compressToWebp(file, WEBP_QUALITY);
                // 压缩后只要不增大就采用（包括等大）
                if (webp && webp.size <= file.size) {
                    blob = webp;
                    base.ext = 'webp';
                }
            } else if (isGif || isVideo) {
                // GIF/视频统一标注为 webm（实际转码在前端转换后再写入 blob，这里先占位 ext）
                base.ext = 'webm';
            } else if (!base.ext) {
                base.ext = 'webp';
            }
            base.blob = blob;
            base.sha = await sha256Hex(await blob.arrayBuffer());
        } catch (e) { base.err = e; }
        return base;
    });
    const prepared = await runWithConcurrency(prepTasks, CONFIG.CONCURRENCY);
    prepared.sort((a, b) => a.idx - b.idx);

    // 阶段 2：逐张顺序查重 + 上传（保证进度条意义与上传顺序）
    const refresh = async () => {
        try { await Store.load(true); } catch (_) { }
        renderMasonry();
        if (state.lightboxOpen) { updateLightbox(); renderDots(); }
    };
    for (let i = 0; i < total; i++) {
        const pr = prepared[i];
        const file = pr.file;
        if (pr.err) {
            failed++;
            _uploadDoneLike = i + 1;
            $('#upFailed').textContent = String(failed);
            toast(`「${file.name}」${pr.err.message}`, 'alert');
            await refresh();
            continue;
        }
        const base = i / total;
        const span = 1 / total;
        setUploadProgress(base, file.name, '查重…');
        try {
            const dup = await checkHashExists(pr.sha);
            if (dup) {
                skipped++;
                _uploadDoneLike = i + 1;
                $('#upSkipped').textContent = String(skipped);
                setUploadProgress(base + span, file.name, '已存在，跳过');
                toast(`「${file.name}」已存在，跳过`, 'info');
            } else {
                const parts = await uploadToBed(pr.blob, pr.name, p => {
                    setUploadProgress(base + p * span, file.name, p < 1 ? '直链上传' : '获取直链');
                });
                setUploadProgress(base + span * 0.95, file.name, '获取尺寸…');
                const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                const photo = {
                    id, url: fileUrl(id), parts, sha256: pr.sha,
                    width: 0, height: 0, createdAt: Date.now(),
                    filename: pr.name, originalName: file.name
                };
                await loadDims(photo);
                await Store.add(photo);
                done++;
                _uploadDoneLike = i + 1;
                $('#upDone').textContent = String(done);
            }
        } catch (err) {
            console.error('upload failed:', file.name, err);
            failed++;
            _uploadDoneLike = i + 1;
            $('#upFailed').textContent = String(failed);
            toast(`「${file.name}」上传失败: ${err.message}`, 'alert');
        }
        await refresh();
    }
    setUploadProgress(1, null, '完成');
    try { await Store.load(true); } catch (_) { }
    renderMasonry();
    if (state.lightboxOpen) { updateLightbox(); renderDots(); }
    const summary = [];
    if (done > 0) summary.push(`成功 ${done}`);
    if (skipped > 0) summary.push(`跳过重复 ${skipped}`);
    if (failed > 0) summary.push(`失败 ${failed}`);
    if (summary.length) toast(`上传完成：${summary.join('，')}`, done > 0 || skipped > 0 ? 'success' : 'alert');
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
    const img = $('#lbImg');
    state.zoom = { s: 1, x: 0, y: 0 };
    state.panning = false;
    img.style.transition = 'none';
    img.style.transform = 'translate(0,0) scale(1)';
    img.style.opacity = 1;
    img.src = p.url;
    img.alt = p.filename || 'photo';
    img.onerror = () => { };
    $('#lbCounter').textContent = `${state.currentIndex + 1} / ${getSorted().length}`;
    updateLightboxVotes(p);
    renderDots();
}
function renderDots() {
    const d = $('#lbDots');
    const list = getSorted();
    const max = Math.min(list.length, 20);
    // 1) 保证 dot 数量正确（不够补、多了删），不重建已有 dot
    while (d.children.length < max) d.appendChild(el('span', 'dot'));
    while (d.children.length > max) d.removeChild(d.lastChild);
    // 2) 只切换 active class
    for (let i = 0; i < max; i++) {
        d.children[i].classList.toggle('active', i === state.currentIndex);
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

/* ---- Lightbox 缩放 / 平移 ---- */
function applyZoomTransform() {
    const img = $('#lbImg');
    img.style.transform = `translate(${state.zoom.x}px, ${state.zoom.y}px) scale(${state.zoom.s})`;
}
function clampPan() {
    const img = $('#lbImg');
    const sr = stage.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    if (r.left > sr.left + 1) state.zoom.x += (sr.left + 1 - r.left);
    if (r.right < sr.right - 1) state.zoom.x += (sr.right - 1 - r.right);
    if (r.top > sr.top + 1) state.zoom.y += (sr.top + 1 - r.top);
    if (r.bottom < sr.bottom - 1) state.zoom.y += (sr.bottom - 1 - r.bottom);
}
// 以 stage 内坐标 (sx,sy) 为锚点缩放到 ns（图片由 flex 居中，transform-origin 默认 center）
function zoomTo(ns, sx, sy) {
    ns = Math.min(5, Math.max(1, ns));
    const sr = stage.getBoundingClientRect();
    const Sx = sr.width / 2, Sy = sr.height / 2;
    const s = state.zoom.s, x = state.zoom.x, y = state.zoom.y;
    state.zoom.s = ns;
    // 保持锚点在原内容位置不变：P = S + t + s*q  →  t' = (P-S) - ns*(P-S - t)/s
    state.zoom.x = (sx - Sx) - ns * (sx - Sx - x) / s;
    state.zoom.y = (sy - Sy) - ns * (sy - Sy - y) / s;
    applyZoomTransform();
    clampPan();
}
function resetZoom() {
    state.zoom = { s: 1, x: 0, y: 0 };
    const img = $('#lbImg');
    img.style.transition = 'transform .2s ease';
    applyZoomTransform();
    setTimeout(() => { img.style.transition = 'none'; }, 200);
}
let pinch = null;
function startPinch(e) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const sr = stage.getBoundingClientRect();
    pinch = {
        dist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY) || 1,
        s: state.zoom.s,
        cx: (t0.clientX + t1.clientX) / 2 - sr.left,
        cy: (t0.clientY + t1.clientY) / 2 - sr.top,
    };
}

function onGs(e) {
    if (!state.lightboxOpen || state.menuOpen) return;
    if (e.target.closest('#lbMoreBtn,#lbCloseBtn')) return;
    // 双指捏合缩放
    if (e.touches && e.touches.length === 2) { startPinch(e); state.dragging = true; return; }
    // 已放大：单指/鼠标拖动 = 平移看图（不做投票手势）
    if (state.zoom.s > 1.01) {
        state.dragging = true; state.panning = true;
        const pt = e.touches ? e.touches[0] : e;
        state.dragStart = { x: pt.clientX, y: pt.clientY };
        state.dragCurrent = { x: pt.clientX, y: pt.clientY };
        $('#lbImg').style.transition = 'none';
        return;
    }
    state.dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    state.dragStart = { x: pt.clientX, y: pt.clientY };
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    $('#lbImg').style.transition = 'none';
    resetGestures();
}
function onGm(e) {
    if (!state.dragging) return;
    // 捏合缩放
    if (e.touches && e.touches.length === 2) {
        if (!pinch) startPinch(e);
        const t0 = e.touches[0], t1 = e.touches[1];
        const sr = stage.getBoundingClientRect();
        const d = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const cx = (t0.clientX + t1.clientX) / 2 - sr.left;
        const cy = (t0.clientY + t1.clientY) / 2 - sr.top;
        zoomTo(pinch.s * (d / pinch.dist), pinch.cx, pinch.cy);
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
        applyZoomTransform();
        if (e.cancelable) e.preventDefault();
        return;
    }
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
function onGe(e) {
    if (!state.dragging) return;
    // 捏合结束
    if (pinch) { pinch = null; state.dragging = false; return; }
    // 平移结束
    if (state.panning) {
        state.dragging = false; state.panning = false;
        clampPan();
        return;
    }
    // 触摸双击：放大 / 复位
    if (e && e.changedTouches && e.changedTouches.length) {
        const t = e.changedTouches[0];
        const moved = Math.hypot(state.dragCurrent.x - state.dragStart.x, state.dragCurrent.y - state.dragStart.y);
        if (moved < 12) {
            const now = Date.now();
            if (state._lastTap && (now - state._lastTap.t) < 300 && Math.hypot(t.clientX - state._lastTap.x, t.clientY - state._lastTap.y) < 40) {
                const sr = stage.getBoundingClientRect();
                if (state.zoom.s > 1.01) resetZoom();
                else zoomTo(2.5, t.clientX - sr.left, t.clientY - sr.top);
                state._lastTap = null;
                state.dragging = false;
                return;
            }
            state._lastTap = { t: now, x: t.clientX, y: t.clientY };
        }
    }
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

function triggerGesture(dir) {
    if (!state.lightboxOpen || state.menuOpen) return;
    const p = curPhoto();
    if (!p) return;
    const img = $('#lbImg');
    img.style.transition = 'transform .2s ease';
    img.style.transform = 'translate(0,0)';

    if (dir === 'left' || dir === 'right') {
        const delta = dir === 'left' ? +1 : -1;
        const giId = dir === 'left' ? '#giLeft' : '#giRight';
        const gi = $(giId); gi.style.opacity = 1; gi.style.transform = 'translateY(-50%) scale(1.2)';

        // 先读本地是否已投过，再进行乐观更新（避免本地判断被新状态影响）
        const alreadyLocal = Store.getMyVote(p.id) === delta;
        const dirLabel = delta === 1 ? '喜欢' : '不喜欢';

        // 本地乐观更新后立刻刷新 UI（不阻塞，不等服务器）
        const rPromise = Store.setLike(p.id, delta);

        toast(alreadyLocal ? `你已标记过${dirLabel}这张` : `已标记为${dirLabel}`,
            delta === 1 ? 'heart' : 'alert');

        updateLightboxVotes(p);
        updateMasonryStatsOnly();

        // 异步收尾：服务器回来后 → 刷新全局数据（更新其他图的最新投票、新增图等）
        rPromise.then(() => {
            try { return Store.load(); } catch (_) { return Store.photos; }
        }).then(() => {
            const cp = curPhoto();
            if (cp) updateLightboxVotes(cp);
            updateMasonryStatsOnly();
            if (state.lightboxOpen) renderDots();
        }).catch(() => { });

        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'down') {
        const gi = $('#giDown'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        downloadUrl(p.url + '?dl=1', p.filename || 'image.jpg');
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
    installInfiniteScroll();
})();