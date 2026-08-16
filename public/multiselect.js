/* =========================================================
 * 多选模式：进出/选择/清除标记/批量删除 + 卡片长按按压 + 拖动框选
 * 依赖：icons.js、store.js、ui.js、masonry.js、task-worker.js、shared.js
 * ========================================================= */
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
    $('#batchClearBtn').classList.remove('hidden');
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
    $('#batchClearBtn').classList.add('hidden');
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
    // 清除标记可用态：选中照片中有任一我投过票的才可点（同菜单「取消标记」逻辑）
    const anyVoted = [...state.selected].some(id => Store.getMyVote(id) !== 0);
    $('#batchClearBtn').classList.toggle('disabled', !anyVoted);
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
// 批量清除标记：对选中的、我已投过票的照片逐张撤销赞/踩（delta=0，同菜单「取消标记」语义）
$('#batchClearBtn').addEventListener('click', async () => {
    const ids = [...state.selected];
    if (ids.length === 0) { toast('请先选择照片'); return; }
    const voted = ids.filter(id => Store.getMyVote(id) !== 0);
    if (voted.length === 0) { toast('所选照片均未标记', 'info'); return; }
    const results = await Promise.all(voted.map(id => Store.setLike(id, 0)));
    const ok = results.filter(r => r && r.ok).length;
    const fail = voted.length - ok;
    toast(ok ? (fail ? `已清除 ${ok} 张标记 · ${fail} 张失败` : `已清除 ${ok} 张标记`) : '清除标记失败', ok ? 'success' : 'alert');
    if (ok) {
        try { await Store.load(); } catch (_) { }
        updateMasonryStatsOnly();
        updateCount();
    }
});

let _deleting = false;
let _deleteWorkerListener = null;
let _deleteMainRunner = null; // 页面级：进行中的主线程删除批次（再触发删除 → append 合并）
async function deleteSelected() {
    if (!state.isAdmin) return;
    if (_deleting) return;
    const ids = [...state.selected];
    if (ids.length === 0) { toast('请先选择照片'); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 张照片吗？此操作不可撤销。`)) return;

    _deleting = true;

    if (TaskWorker.isSupported()) {
        // 已有删除任务进行中 → 动态追加（不再新开任务竞争进度环）
        const cur = TaskWorker.getTask('delete');
        if (cur && cur.status === 'running') {
            TaskWorker.appendDelete(ids, apiBase());
            _deleting = false;
            return;
        }
        if (TaskWorker.startDelete(ids, apiBase())) {
            resetProgressUI('delete');
            if (_deleteWorkerListener) _deleteWorkerListener();
            _deleteWorkerListener = TaskWorker.onMessage((msg) => {
                if (msg.type === 'error') {
                    toast(msg.error || '删除启动失败', 'alert');
                    _deleting = false;
                    resetProgressUI('delete');
                    if (_deleteWorkerListener) { _deleteWorkerListener(); _deleteWorkerListener = null; }
                    return;
                }
                if (msg.type === 'task-update' && msg.task && msg.task.type === 'delete') {
                    applyTaskUpdate(msg.task);
                }
                if (msg.type === 'delete-complete') {
                    const s = msg.summary || {};
                    setProgress(1, null, s.failed === 0 ? '完成' : '部分失败', { stat: `成功 ${s.done || 0} · 失败 ${s.failed || 0}` }, 'delete');
                    (async () => {
                        await Store.load(true);
                        exitMulti();
                        renderMasonry();
                    })();
                    scheduleProgressFade('delete');
                    if (_deleteWorkerListener) { _deleteWorkerListener(); _deleteWorkerListener = null; }
                    _deleting = false;
                }
            });
            return;
        }
    }

    // 主线程删除回退：合并到进行中的批次
    if (_deleteMainRunner) {
        _deleteMainRunner.append(ids);
        _deleting = false;
        return;
    }
    const runner = createDeleteRunner(apiBase(), (st) => {
        setProgress(st.progress, st.curFile, '删除中…', { stat: `成功 ${st.done} · 失败 ${st.failed}`, remaining: st.total - st.finished }, 'delete');
    });
    _deleteMainRunner = runner;
    runner.append(ids);
    const { done, failed } = await runner.done;

    setProgress(1, null, failed === 0 ? '完成' : '部分失败', { stat: `成功 ${done} · 失败 ${failed}` }, 'delete');

    await Store.load(true);
    exitMulti();
    renderMasonry();
    scheduleProgressFade('delete');
    _deleteMainRunner = null;
    _deleting = false;
}

/* ---- 卡片长按进多选 / 单击开 Lightbox ---- */
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

/* ---- 拖动框选（仅桌面多选态） ---- */
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
