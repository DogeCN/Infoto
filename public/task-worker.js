/* =========================================================
 * TaskWorker 适配层：跨页面保持上传/下载/删除推进
 * - 支持 SharedWorker 的浏览器：任务在 Worker 中执行，页面切换不中断
 * - 不支持的浏览器：降级为页面内执行（原有逻辑）
 * 依赖：无（仅 window/SharedWorker）
 * ========================================================= */
// 页面级唯一标识：多标签页下，下载任务完成广播只有发起页弹下载，其他页只提示
const TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const TaskWorker = (() => {
    let sw = null;
    let supported = typeof SharedWorker !== 'undefined';
    let listeners = new Set();
    let currentTasks = { upload: null, download: null, delete: null };
    let reconnectTimer = null;
    let bc = null;
    let _bcInstalled = false;
    // 双通道（SharedWorker port + BroadcastChannel）同一条广播会各投递一次，用 _seq 去重。
    // worker 端 _seq 为时间戳基座（跨 worker 重启单调递增），此处只需简单单调去重：
    // 同一 _seq 的第一个副本放行并推进基线，乱序/延迟到达的副本必 <= _lastSeq 被丢弃。
    // 注：早期版本有"seq 回退 >128 即重置基线"逻辑，会在任务广播量大（并发上传几十张，
    // _seq 跨度数百）且双通道乱序/延迟（页面后台、BC 积压）时，把已处理过的消息副本
    // 当作新 worker 的消息重新放行 → 同一 photo-result 处理两次 → 重复插卡/重复 unshift。
    let _lastSeq = 0;
    function _dedupeMsg(msg) {
        if (typeof msg._seq !== 'number') return true; // reply 类消息无 seq，幂等无需去重
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

    // 运行中追加（worker 端 append-* 消息：上传/下载/删除 任务进行中再触发同类操作 → 合并进同一任务）
    function appendUpload(files, apiBase) {
        if (!connect()) return false;
        try { sw.port.postMessage({ type: 'append-upload', files, apiBase }); return true; }
        catch (e) { return false; }
    }
    function appendDelete(ids, apiBase) {
        if (!connect()) return false;
        try { sw.port.postMessage({ type: 'append-delete', ids, apiBase }); return true; }
        catch (e) { return false; }
    }
    function appendDownload(list, apiBase, tabId) {
        if (!connect()) return false;
        try { sw.port.postMessage({ type: 'append-download', list, apiBase, tabId }); return true; }
        catch (e) { return false; }
    }

    try {
        connect();
        window.addEventListener('beforeunload', () => {
            try { if (sw) sw.port.postMessage({ type: 'disconnect' }); } catch (_) { }
        }, { once: true });
    } catch (e) { console.warn('[TaskWorker] init connect fail:', e && e.message); }

    return { connect, isSupported, onMessage, getTask, hasAnyTask, startDelete, startDownload, startUpload, appendUpload, appendDelete, appendDownload };
})();
