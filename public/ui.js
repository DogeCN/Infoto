/* =========================================================
 * UI 状态 + 轻量反馈（toast）+ 任务进度环（上传/下载/删除三套独立）
 * 依赖：icons.js（DOM 工具/renderIcons）
 * ========================================================= */
// 提前声明 stage：clampPan / zoomTo 等函数会引用，定义在 lightbox.js 事件绑定处赋值
let stage = null;
const state = {
    sortBy: 'latest', latestDir: 'desc', hotestDir: 'desc',
    multiMode: false, selected: new Set(),
    longPressTimer: null, longPressTriggered: false, longPressJustFired: false,
    lightboxOpen: false, currentIndex: 0,
    boxSelecting: false, boxStart: null, boxArm: false, suppressClick: false, boxBase: null,
    menuOpen: false,
    isAdmin: false,
    dragging: false, dragStart: null, dragCurrent: null,
    batchSize: 60, loadedCount: 60,
    zoom: { s: 1, x: 0, y: 0, r: 0 },
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

/* =========================================================
   任务进度 UI：上传/下载/删除 三个独立浮动进度环
   - TASK_UI 表映射类型 → DOM id；配色/定位由 .task-indicator.up/.dl/.del CSS 区分
   - 每类型独立的 fade 计时与展开状态（互不影响，不竞争）
   ========================================================= */
const TASK_UI = {
    upload:   { ind: 'upIndicator',  ring: 'upRing',  pct: 'upPct',  tip: 'upTip',  rows: 'upRows',  done: 'upDone',  skipped: 'upSkipped',  failed: 'upFailed' },
    download: { ind: 'dlIndicator',  ring: 'dlRing',  pct: 'dlPct',  tip: 'dlTip',  rows: 'dlRows',  done: 'dlDone',  skipped: 'dlSkipped',  failed: 'dlFailed' },
    delete:   { ind: 'delIndicator', ring: 'delRing', pct: 'delPct', tip: 'delTip', rows: 'delRows', done: 'delDone', skipped: 'delSkipped', failed: 'delFailed' },
};
const _taskFade = {
    upload: { timer: null, pending: false },
    download: { timer: null, pending: false },
    delete: { timer: null, pending: false },
};
const _ui = type => TASK_UI[type] || TASK_UI.upload;

/* 进度环完成淡出：任务完成后 5s 自动淡出，期间可被展开 / 新任务打断。
   - scheduleProgressFade(type, delay, after)：完成路径统一调用；after 为淡出完成后回调
   - 展开中到点不淡出，挂起 pending，收起后重新计时
   - 新任务 resetProgressUI 会清掉计时器与 fading，进度环继续为新任务服务 */
function scheduleProgressFade(type, delayMs = 5000, after) {
    const st = _taskFade[type] || _taskFade.upload;
    if (st.timer) clearTimeout(st.timer);
    st.pending = false;
    st.timer = setTimeout(() => {
        st.timer = null;
        const ind = $('#' + _ui(type).ind);
        if (ind.classList.contains('open')) { st.pending = true; return; } // 展开中：挂起，收起后重排
        ind.classList.add('fading');
        setTimeout(() => {
            ind.classList.remove('fading');
            if (ind.classList.contains('open')) { st.pending = true; return; } // 过渡中又被展开：取消淡出
            resetProgressUI(type);
            if (after) after();
        }, 380);
    }, delayMs);
}

/* 任务进度环堆叠：纯 CSS 布局（.task-stack flex column-reverse + display:none 让位），
   见 styles.css .task-stack；无 JS 参与。 */

function resetProgressUI(type) {
    const st = _taskFade[type] || _taskFade.upload;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    st.pending = false;
    const u = _ui(type);
    const ind = $('#' + u.ind);
    ind.classList.remove('fading');
    ind.classList.add('hidden');
    ind.classList.remove('open'); // 收起展开的详情
    $('#' + u.ring).style.strokeDashoffset = '94.25';
    // 重置：用数字 0，清空 check 图标
    $('#' + u.pct).innerHTML = '0';
    $('#' + u.pct).style.fontSize = '';
    $('#' + u.pct).style.color = '';
    $('#' + u.done).textContent = '0';
    $('#' + u.skipped).textContent = '0';
    $('#' + u.failed).textContent = '0';
    $('#' + u.rows).innerHTML = '';
}
function setProgress(p, file, step, extra, type) {
    const u = _ui(type);
    const ind = $('#' + u.ind);
    ind.classList.remove('hidden');
    const clampedP = Math.max(0, Math.min(1, p));
    $('#' + u.ring).style.strokeDashoffset = String(94.25 * (1 - clampedP));
    const pctEl = $('#' + u.pct);
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
    if (extra && extra.done !== undefined) $('#' + u.done).textContent = String(extra.done);
    if (extra && extra.skipped !== undefined) $('#' + u.skipped).textContent = String(extra.skipped);
    if (extra && extra.failed !== undefined) $('#' + u.failed).textContent = String(extra.failed);
    // 底部 stat 小字已移除：与上方成功/重复/失败三列重复；保留 extra.stat 形参兼容调用方
}
// 并发槽位行渲染：每行左端文件名、右端步骤图标（keyed diff，只更新变化的文本节点）。
// rows: [{ key, file, step }]，key 为文件在批次内的下标；结束后从列表移除即不再渲染
function renderUpRows(rows, type) {
    const box = $('#' + _ui(type).rows);
    if (!box) return;
    if (!rows || !rows.length) { box.innerHTML = ''; return; }
    const rowsByKey = new Map();
    for (const c of box.children) rowsByKey.set(c.dataset.key, c);
    for (const r of rows) {
        const k = String(r.key);
        let row = rowsByKey.get(k);
        if (!row) {
            row = document.createElement('div');
            row.className = 'up-row';
            row.dataset.key = k;
            row.innerHTML = '<span class="up-row-file"></span><span class="up-row-step"><svg class="step-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></svg></span>';
            box.appendChild(row);
        }
        const [f, s] = row.children;
        if (f.textContent !== r.file) f.textContent = r.file;
        // step 改成图标：data-step 记录旧图标名便于 keyed diff；图标 SVG path 通过 ICONS 表填充
        const iconName = stepIcon(r.step);
        if (row.dataset.step !== iconName) {
            row.dataset.step = iconName;
            const svg = s.querySelector('svg');
            svg.setAttribute('aria-label', r.step || '');
            svg.innerHTML = ICONS[iconName] || ICONS['step-wait'];
        }
        rowsByKey.delete(k);
    }
    for (const el of rowsByKey.values()) el.remove(); // 已结束/换批次的旧行
}
// Worker 任务快照 → 对应类型进度环（upload/delete/download 按 snapshot.type 路由到独立环）
function applyTaskUpdate(t) {
    if (!t) return;
    setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed, done: t.done, skipped: t.skipped, failed: t.failed }, t.type);
    renderUpRows(t.type === 'upload' ? t.rows : null, t.type);
}

/* ---- 进度环：点击展开/收起详情（桌面 hover 仍可用，移动端无 hover 靠点击） ---- */
['upload', 'download', 'delete'].forEach(type => {
    const ind = $('#' + TASK_UI[type].ind);
    if (!ind) return;
    ind.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = ind.classList.contains('open');
        ind.classList.toggle('open');
        if (wasOpen && _taskFade[type].pending) { // 收起且之前因展开挂起淡出：重新计时
            _taskFade[type].pending = false;
            scheduleProgressFade(type, 5000);
        }
    });
    document.addEventListener('click', (e) => {
        if (!ind.classList.contains('open')) return;
        if (!ind.contains(e.target)) ind.classList.remove('open');
    });
});
