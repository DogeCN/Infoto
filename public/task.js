/* =========================================================
 * Infoto Shared Task Worker
 * 跨页面保持下载/删除任务推进，页面切换不丢失进度
 * 通过 onconnect 接收多个页面的 port，任务进度广播给所有页面
 * ========================================================= */

importScripts('./shared.js'); // 加载 CONFIG / formatSize / sha256Hex / withRetry / runWithConcurrency / uploadViaXhr / uploadPartToTcProgressive / uploadToBed

/* ============ 状态管理 ============ */
const clients = new Set();
const tasks = {
    upload: null,
    download: null,
    delete: null,
};

let bc = null;
try {
    bc = new BroadcastChannel('infoto-task-bc');
    bc.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'bc-ping') return;
        handleIncomingMessage(msg, null);
    };
} catch (e) { bc = null; }

let keepAliveTimer = null;
let _seq = 0;

function broadcast(msg) {
    // 每条广播带递增 _seq：页面同时经 port 与 BroadcastChannel 收到同一条消息，用 _seq 去重（防终态消息触发两次下载/toast）
    const m = { ...msg, _seq: ++_seq };
    for (const port of clients) {
        try { port.postMessage(m); } catch (e) { console.warn('[task-worker] broadcast fail:', e && e.message); }
    }
    if (bc) {
        try { bc.postMessage(m); } catch (e) { }
    }
}

function hasActiveTask() {
    return !!(tasks.upload || tasks.download || tasks.delete);
}

function getCurrentStatus() {
    return {
        type: 'status',
        tasks: {
            upload: tasks.upload ? tasks.upload.snapshot() : null,
            download: tasks.download ? tasks.download.snapshot() : null,
            delete: tasks.delete ? tasks.delete.snapshot() : null,
        }
    };
}

/* ============ 删除任务 ============ */
class DeleteTask {
    constructor(jobId, ids, apiBase) {
        this.id = jobId;
        this.type = 'delete';
        this.ids = ids;
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '删除中…';
        this.curFile = `${ids.length} 张照片`;
        this.done = 0; this.failed = 0; this.total = ids.length;
        this.skipped = 0;
        this.extraStat = '';
        this._promise = this._run();
    }

    snapshot() {
        return {
            id: this.id,
            type: this.type,
            status: this.status,
            progress: this.progress,
            step: this.step,
            curFile: this.curFile,
            done: this.done, skipped: this.skipped, failed: this.failed, total: this.total,
            extraStat: `成功 ${this.done} · 失败 ${this.failed}`,
            startedAt: this.startedAt,
        };
    }

    _emitUpdate() {
        broadcast({ type: 'task-update', task: this.snapshot() });
    }

    async _run() {
        const ids = this.ids;
        const total = ids.length;
        this._emitUpdate();

        const tasksArr = ids.map(id => async () => {
            try {
                const r = await fetch(this.apiBase + '/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
                if (r.ok) this.done++; else this.failed++;
            } catch (e) { console.warn('[task-worker] delete fail:', e && e.message); this.failed++; }
            const finished = this.done + this.failed;
            this.progress = total ? finished / total : 1;
            this.curFile = `${finished} / ${total} 张`;
            this._emitUpdate();
        });

        await runWithConcurrency(tasksArr, CONFIG.CONCURRENCY);

        this.progress = 1;
        this.status = 'done';
        this.step = this.failed === 0 ? '完成' : '部分失败';
        this.curFile = `${this.done} 成功 / ${this.failed} 失败`;
        this._emitUpdate();

        broadcast({
            type: 'delete-complete',
            taskId: this.id,
            deletedIds: ids,
            summary: { done: this.done, failed: this.failed, total }
        });

        tasks.delete = null;
        setTimeout(() => broadcast({ type: 'task-clear', taskType: 'delete' }), 3000);
    }
}

/* ============ 下载任务 ============ */
class DownloadTask {
    constructor(jobId, list, apiBase) {
        this.id = jobId;
        this.type = 'download';
        this.list = list;
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '准备下载';
        this.curFile = `${list.length} 张照片`;
        this.done = 0; this.failed = 0; this.total = list.length;
        this.skipped = 0;
        this.extraStat = '';
        this.zipBlobUrl = null;
        this.finalName = 'download.zip';
        this._promise = this._run();
    }

    snapshot() {
        return {
            id: this.id,
            type: this.type,
            status: this.status,
            progress: this.progress,
            step: this.step,
            curFile: this.curFile,
            done: this.done, skipped: this.skipped, failed: this.failed, total: this.total,
            extraStat: this.extraStat,
            startedAt: this.startedAt,
            zipReady: !!this.zipBlobUrl,
        };
    }

    _emitUpdate() {
        broadcast({ type: 'task-update', task: this.snapshot() });
    }

    _fetchWithProgress(url, onProgress) {
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

    async _run() {
        const list = this.list;
        const total = list.length;

        if (total === 1) {
            const p = list[0];
            const url = (this.apiBase || '') + '/api/file/' + p.id + '?dl=1';
            try {
                const r = await fetch(url, { cache: 'force-cache' });
                if (r.ok) {
                    const blob = await r.blob();
                    this.zipBlobUrl = URL.createObjectURL(blob);
                    this.finalName = p.id + '.' + String(p.ext || 'webp').toLowerCase();
                }
            } catch (e) { console.warn('[task-worker] single dl fail:', e && e.message); }
            this.progress = 1;
            this.status = 'done';
            this.step = '完成';
            this.done = this.zipBlobUrl ? 1 : 0;
            this.failed = this.zipBlobUrl ? 0 : 1;
            this._emitUpdate();
            broadcast({ type: 'download-complete', taskId: this.id, zipUrl: this.zipBlobUrl, fileName: this.finalName });
            tasks.download = null;
            return;
        }

        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();

        const perItemProgress = new Array(total).fill(0);
        const perItemTotal = new Array(total).fill(0);
        const perItemDone = new Array(total).fill(false);
        let zipProgress = 0;
        const ZIP_WEIGHT = 0.12;
        const FETCH_WEIGHT = 1 - ZIP_WEIGHT;

        const recomputeOverall = () => {
            let sumCur = 0, sumTot = 0, finishedItems = 0;
            for (let i = 0; i < total; i++) {
                const t = perItemTotal[i] || 1;
                sumCur += perItemProgress[i];
                sumTot += t;
                if (perItemDone[i]) finishedItems++;
            }
            const fetchPart = sumTot > 0 ? (sumCur / sumTot) * FETCH_WEIGHT : 0;
            const zipPart = zipProgress * ZIP_WEIGHT;
            this.progress = Math.min(1, fetchPart + zipPart);
            this.done = finishedItems;
            this.curFile = `${finishedItems} / ${total} 张`;
            this.step = zipProgress > 0 ? '打包 zip 中' : '下载中…';
            this.extraStat = `下载 ${finishedItems}/${total} 张`;
            this._emitUpdate();
        };

        const dlTasks = list.map((p, i) => async () => {
            try {
                const base = p.id + '.' + String(p.ext || 'webp').toLowerCase();
                const url = (this.apiBase || '') + '/api/file/' + p.id;
                const { blob, total: t } = await this._fetchWithProgress(
                    url,
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
                console.warn('[task-worker] dl item fail:', e && e.message);
                perItemDone[i] = true;
                this.failed++;
                return { ok: false, err: e };
            }
        });

        const results = await runWithConcurrency(dlTasks, CONFIG.CONCURRENCY);
        const successCount = results.filter(r => r.ok).length;

        if (successCount === 0) {
            this.progress = 1;
            this.status = 'done';
            this.step = '失败';
            this._emitUpdate();
            tasks.download = null;
            setTimeout(() => broadcast({ type: 'task-clear', taskType: 'download' }), 2500);
            return;
        }

        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
            zipProgress = meta.percent / 100;
            recomputeOverall();
            const failedCount = total - successCount;
            this.extraStat = `${successCount}/${total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`;
        });
        zipProgress = 1;
        recomputeOverall();

        this.zipBlobUrl = URL.createObjectURL(zipBlob);
        this.progress = 1;
        this.status = 'done';
        this.step = '完成';
        const finalFailed = total - successCount;
        this.extraStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
        this._emitUpdate();

        broadcast({ type: 'download-complete', taskId: this.id, zipUrl: this.zipBlobUrl, fileName: this.finalName });

        tasks.download = null;
        setTimeout(() => broadcast({ type: 'task-clear', taskType: 'download' }), 3000);
    }
}

/* ============ 连接管理 ============ */
function handleIncomingMessage(msg, replyPort) {
    const reply = (obj) => {
        if (replyPort) {
            try { replyPort.postMessage(obj); } catch (_) { }
        } else if (bc) {
            try { bc.postMessage({ ...obj, _replyId: msg._replyId }); } catch (_) { }
        }
    };
    switch (msg.type) {
        case 'ping':
            reply({ type: 'pong' });
            break;

        case 'get-status':
            reply(getCurrentStatus());
            break;

        case 'start-delete':
            if (tasks.delete) {
                reply({ type: 'error', error: '已有删除任务进行中' });
                return;
            }
            try {
                tasks.delete = new DeleteTask(
                    'del_' + Date.now().toString(36),
                    msg.ids || [],
                    msg.apiBase || ''
                );
                reply({ type: 'task-started', taskType: 'delete', taskId: tasks.delete.id });
            } catch (err) {
                console.warn('[task-worker] start-delete err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;

        case 'start-download':
            if (tasks.download) {
                reply({ type: 'error', error: '已有下载任务进行中' });
                return;
            }
            try {
                tasks.download = new DownloadTask(
                    'dl_' + Date.now().toString(36),
                    msg.list || [],
                    msg.apiBase || ''
                );
                reply({ type: 'task-started', taskType: 'download', taskId: tasks.download.id });
            } catch (err) {
                console.warn('[task-worker] start-download err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;

        case 'disconnect':
            if (replyPort) clients.delete(replyPort);
            break;
    }
}

self.onconnect = (e) => {
    const port = e.ports[0];
    clients.add(port);
    if (keepAliveTimer) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }

    port.onmessage = (ev) => {
        const msg = ev.data || {};
        handleIncomingMessage(msg, port);
    };

    port.start();

    try { port.postMessage(getCurrentStatus()); } catch (e) { console.warn('[task-worker] init status fail:', e && e.message); }
};

setInterval(() => {
    if (hasActiveTask() && bc) {
        try { bc.postMessage({ type: 'bc-keepalive', ts: Date.now() }); } catch (_) { }
    }
}, 5000);