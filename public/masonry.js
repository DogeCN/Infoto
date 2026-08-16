/* =========================================================
 * 排序 + 瀑布流 + 卡片渲染 + 卡片视口播放
 * 依赖：icons.js、store.js、ui.js
 * ========================================================= */
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

/* ---- 投票 badges 公共渲染（renderCardStatsBadges 供 makeCard / _renderCardStats 共用）---- */
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
            // 音量按钮由下方 makeCard 同步创建（animated && photo.hasAudio），无需在此再建
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
    // DOM 幂等：该 id 的卡已在瀑布流中（重复 photo-result / 并发路径）则跳过，防重复插卡
    if (document.querySelector('.photo-card[data-id="' + photo.id + '"]')) return;
    const list = getSorted();
    const idxInSorted = list.findIndex(p => p.id === photo.id);
    if (idxInSorted < 0 || idxInSorted >= state.loadedCount) return;
    const card = makeCard(photo, idxInSorted);
    const targetCol = _shortestCol();
    if (!targetCol) return;
    if (targetCol.firstChild) targetCol.insertBefore(card, targetCol.firstChild);
    else targetCol.appendChild(card);
    // 新卡占 sorted 头部一个位置：必须同步推进已渲染计数，否则后续滚动增量渲染
    // （renderMasonry(false) 从旧 renderedCount 续 append sorted[i]）会因旧照片整体
    // 后移一位而把已在 DOM 的旧卡重复渲染（"上传后滚动出现重复图"）。
    renderedCount++;
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

// 单卡投票徽章渲染（updateCardStatsById / updateMasonryStatsOnly 共用）
function _renderCardStats(c, p) {
    const myVote = Store.getMyVote(p.id);
    const { html, haveVotes } = renderCardStatsBadges(p, myVote);
    const oldStats = c.querySelector('.card-stats');
    if (!haveVotes) { if (oldStats) oldStats.remove(); return; }
    if (oldStats) { oldStats.innerHTML = html; renderIcons(oldStats); }
    else { const s = el('div', 'card-stats', html); renderIcons(s); c.appendChild(s); }
}

function updateCardStatsById(id) {
    const p = Store.photos.find(x => x.id === id);
    if (!p) return;
    $$(`.photo-card[data-id="${id}"]`).forEach(c => _renderCardStats(c, p));
}

function updateMasonryStatsOnly() {
    $$('.photo-card').forEach(c => {
        const p = Store.photos.find(x => x.id === c.dataset.id);
        if (p) _renderCardStats(c, p);
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
