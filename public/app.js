/* =========================================================
 * Infoto 入口：后台任务恢复 + 页面初始化
 * 依赖（加载顺序见 index.html）：
 *   shared.js → icons.js → shared-refs.js → task-worker.js → store.js
 *   → ui.js → masonry.js → multiselect.js → download.js → upload.js
 *   → lightbox.js → app.js（本文件最后）
 * ========================================================= */

/* ---- 刷新后恢复后台任务进度（SharedWorker 跨页面推进） ---- */
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
    // 每个进行中的任务恢复其独立进度环（applyTaskUpdate 按 task.type 路由到对应环）
    for (const ty of activeTypes) {
        const t = TaskWorker.getTask(ty);
        if (t) applyTaskUpdate(t);
    }
    var resumedType = activeTypes[0];
    if (_resumeWorkerListener) _resumeWorkerListener();
    _resumeWorkerListener = TaskWorker.onMessage(function (msg) {
        if (msg.type === 'task-update' && msg.task && activeTypes.indexOf(msg.task.type) >= 0) {
            var mt = msg.task;
            if (mt.type === resumedType || !TaskWorker.getTask(resumedType) || TaskWorker.getTask(resumedType).status !== 'running') {
                applyTaskUpdate(mt);
            }
        }
        if (msg.type === 'task-clear' && activeTypes.indexOf(msg.taskType) >= 0) {
            var i2 = activeTypes.indexOf(msg.taskType);
            if (i2 >= 0) activeTypes.splice(i2, 1);
            if (activeTypes.length === 0) {
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
        }
        if (msg.type === 'upload-complete') {
            (async function () {
                await Store.load(true);
                renderMasonry();
            })();
        }
    });
}

/* ---- 初始化 ---- */
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
