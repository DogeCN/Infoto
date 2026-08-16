/* =========================================================
 * Lightbox 卡片预览 + 四向手势 + 缩放/平移/旋转 + 更多菜单 + 下载工具
 * 依赖：icons.js、shared-refs.js、store.js、ui.js、masonry.js
 * ========================================================= */
const THRESHOLD = 80;

function openLightbox(idx) {
    const list = getSorted();
    if (idx < 0 || idx >= list.length) return;
    state.currentIndex = idx;
    state.lightboxOpen = true;
    $('#lightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
    updateLightbox();
    /* renderDots removed */;
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
    /* renderDots removed */;
    preloadLightboxNeighbors(state.currentIndex);
    _setAudioBtnsVisible(true);
}
function nextPhoto() { state.currentIndex = (state.currentIndex + 1) % getSorted().length; updateLightbox(); }

$('#lbCloseBtn').addEventListener('click', closeLightbox);
// 点击空白（媒体/顶栏/圆点之外）关闭；菜单开着时不关
$('#lightbox').addEventListener('click', e => {
    if (state.menuOpen) return;
    if (e.target.closest && e.target.closest('.lb-media-wrap,.lb-top,,.audio-toggle,#lbMoreBtn,#lbCloseBtn')) return;
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
    // 关键：state 被 clamp 修正后必须同步视觉 transform。否则视觉停留在拖动结束位、
    // state 已被拉回边界 → 下次拖动按 state 起算，图片瞬间跳变（"下一次拖动被重置到原点"）
    applyZoomTransform();
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
function resetZoom(keepRotate) {
    // 双击缩小只复位缩放/平移，保留用户显式旋转的角度（与 clampPan 语义一致）
    state.zoom = { s: 1, x: 0, y: 0, r: keepRotate ? (state.zoom.r || 0) : 0 };
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
    // e.target 可能是文本节点等非 Element，closest 需先判存在（防 TypeError 打断手势链）
    const tgt = e.target;
    if (!tgt || typeof tgt.closest !== 'function' || tgt.closest('#lbMoreBtn,#lbCloseBtn,.audio-toggle')) return;
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
    } else {
        state.dragging = true;
        resetGestures();
    }
    const pt = e.touches ? e.touches[0] : e;
    state.dragStart = { x: pt.clientX, y: pt.clientY };
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const w = lbWrap(); if (w) w.style.transition = 'none';
    _setAudioBtnsVisible(false);
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
                if (state.zoom.s > 1.01) resetZoom(true);
                else zoomTo(2.5, t.clientX - sr.left, t.clientY - sr.top);
                state._lastTap = null;
                state.dragging = false; state.panning = false;
                _setAudioBtnsVisible(true);
                return;
            }
            state._lastTap = { t: now, x: t.clientX, y: t.clientY };
            // 单击且落在媒体/顶栏/圆点之外（触摸下合成 click 已被 preventDefault 掐断，须在此处理）
            const tg = e.target;
            if (tg && tg.closest && !tg.closest('.lb-media-wrap,.lb-top,,.audio-toggle,#lbMoreBtn,#lbCloseBtn')) {
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
            if (state.lightboxOpen) /* renderDots removed */;
        }).catch(() => { });

        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'down') {
        const gi = $('#giDown'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        downloadUrl(p.url + '?dl=1', dlName(p));
        toast('开始下载', 'download');
        setTimeout(() => { resetGestures(); }, 250);
    } else if (dir === 'up') {
        const gi = $('#giUp'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        setTimeout(() => {
            resetGestures();
            // 防御：手势触发到延时打开之间的窗口内 lightbox 可能已被关闭（如快速点关闭），
            // 此时不再打开菜单，避免菜单残留在主页底部（"滑动时菜单一直有"）
            if (state.lightboxOpen) openMenu();
        }, 200);
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
    if (state.zoom.s > 1.01) resetZoom(true);
    else zoomTo(2.5, e.clientX - sr.left, e.clientY - sr.top);
});

/* =========================================================
   更多菜单
   ========================================================= */
// 打开菜单时同步「取消标记」可用态：当前照片已投过票才可点（否则置灰）
function updateMenuState() {
    const unmark = $('#menuUnmark');
    if (!unmark) return;
    const p = curPhoto();
    const hasVote = !!p && !!Store.getMyVote(p.id);
    unmark.classList.toggle('disabled', !hasVote);
    unmark.setAttribute('aria-disabled', hasVote ? 'false' : 'true');
}
function openMenu() {
    if (!state.lightboxOpen) return; // 菜单只在 lightbox 内有效，防异常路径残留在主页
    state.menuOpen = true; $('#menuMask').classList.add('show'); $('#menu').classList.add('show');
    updateMenuState();
}
function closeMenu() { state.menuOpen = false; $('#menuMask').classList.remove('show'); $('#menu').classList.remove('show'); }
$('#lbMoreBtn').addEventListener('click', e => { e.stopPropagation(); openMenu(); });
$('#menuMask').addEventListener('click', closeMenu);
$('#menuCancel').addEventListener('click', closeMenu);
// 取消标记：撤销当前照片的赞/踩（delta=0，服务端从投票集合移除本 IP）
$('#menuUnmark').addEventListener('click', async () => {
    const p = curPhoto();
    if (!p) return;
    if (!Store.getMyVote(p.id)) { toast('尚未标记', 'info'); closeMenu(); return; }
    closeMenu();
    const rPromise = Store.setLike(p.id, 0);
    updateLightboxVotes(p);
    updateCardStatsById(p.id);
    rPromise.then(r => {
        toast(r.ok ? '已取消标记' : '取消失败', r.ok ? 'success' : 'alert');
        if (!r.ok) return Store.photos;
        try { return Store.load(); } catch (_) { return Store.photos; }
    }).then(() => {
        const cp = curPhoto();
        if (cp) { updateLightboxVotes(cp); updateCardStatsById(cp.id); }
        if (state.lightboxOpen) /* renderDots removed */;
    }).catch(() => { });
});

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
