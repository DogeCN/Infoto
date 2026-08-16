/* =========================================================
 * Infoto Shared Task Worker
 * 跨页面保持上传/下载/删除任务推进，页面切换不丢失进度
 * 通过 onconnect 接收多个页面的 port，任务进度广播给所有页面
 * 上传：Worker 内完成 转码(OffscreenCanvas+WebCodecs)/查重/上图床/写库，
 *       每张完成广播 photo-result，页面负责插卡与尺寸回写
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

/* ============ 上传任务 ============ */
class UploadTask {
    constructor(jobId, files, apiBase) {
        this.id = jobId;
        this.type = 'upload';
        this.files = files;      // File[]（页面 structured clone 传入）
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '准备中…';
        this.curFile = files.length > 1 ? `${files.length} 个文件` : (files[0]?.name || '');
        this.done = 0; this.skipped = 0; this.failed = 0; this.total = files.length;
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
            extraStat: `成功 ${this.done} · 跳过 ${this.skipped} · 失败 ${this.failed}`,
            startedAt: this.startedAt,
        };
    }

    _emitUpdate() {
        broadcast({ type: 'task-update', task: this.snapshot() });
    }

    async _run() {
        const files = this.files;
        const total = files.length;
        const av1Ok = await supportsAv1WebCodecs();
        const PHASE = { PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05 };

        const fileStates = files.map((f, i) => ({ idx: i, size: f.size || 0, prepP: 0, upP: 0, uploadBytes: f.size || 0, err: null }));
        const prepTotal = fileStates.reduce((a, s) => a + s.size, 0) || 1;

        const curOverall = () => {
            let prepSum = 0, upSum = 0, upDen = 0;
            for (const s of fileStates) {
                prepSum += s.prepP * s.size;
                const ub = s.uploadBytes || s.size || 1;
                upSum += s.upP * ub; upDen += ub;
            }
            const prepP = prepSum / prepTotal;
            const upP = upDen ? upSum / upDen : 0;
            return Math.min(1, PHASE.PREP * prepP + PHASE.UPLOAD * upP);
        };
        const emit = (fileName, step) => {
            this.curFile = fileName || (total > 1 ? `${total} 个文件` : (files[0]?.name || ''));
            if (step) this.step = step;
            this.progress = curOverall();
            this.extraStat = `成功 ${this.done} · 跳过 ${this.skipped} · 失败 ${this.failed}`;
            this._emitUpdate();
        };
        const result = (idx, name, photo, err, skipped) => {
            broadcast({ type: 'photo-result', taskId: this.id, idx, name, photo: photo || null, err: err || null, skipped: !!skipped });
        };

        const processOne = async (file, idx) => {
            const st = fileStates[idx];
            let blob = null;
            try {
                if (file.type === 'image/svg+xml') {
                    st.err = 'SVG 暂不支持'; this.failed++; result(idx, file.name, null, 'SVG 暂不支持'); return;
                }
                let ext = 'webp', hasAudio = false;
                // 尺寸直接来自压缩/转码阶段的位图元数据（SharedWorker 无 DOM，不能二次加载取尺寸）
                let dimsW = 0, dimsH = 0;
                const isV = isVideoFile(file), isG = isGifFile(file), isP = isPicFile(file);
                if (isP) {
                    emit(file.name, '压缩中…');
                    const webp = await compressToWebp(file, WEBP_QUALITY);
                    if (!webp || !webp.blob) { st.err = '图片 WebP 压缩失败'; this.failed++; result(idx, file.name, null, st.err); return; }
                    blob = webp.blob; ext = 'webp'; dimsW = webp.width || 0; dimsH = webp.height || 0;
                } else if (isV || isG) {
                    if (!av1Ok) {
                        const msg = (isG ? 'GIF' : '视频') + '需要支持 AV1 WebCodecs 的浏览器';
                        st.err = msg; this.failed++; result(idx, file.name, null, msg); return;
                    }
                    emit(file.name, (isG ? 'GIF 转码' : '视频转码') + '中…');
                    // Worker 无 <video> 元素：非 MP4 容器由 transcodeToAv1Webm 抛错（页面已对含非 MP4 视频的批次降级主线程，正常到不了这里）
                    const r = await transcodeToAv1Webm(file, (p) => { st.prepP = Math.max(0, Math.min(1, p || 0)); emit(file.name); });
                    blob = r.blob; ext = 'webm'; hasAudio = !!r.hasAudio; dimsW = r.width || 0; dimsH = r.height || 0;
                }
                st.prepP = 1;
                st.uploadBytes = blob.size || st.size || 1;
                const ab = await blob.arrayBuffer();
                const sha = await sha256Hex(ab);
                emit(file.name, '查重…'); st.upP = 0.02;
                const dup = await checkHashExists(sha, this.apiBase);
                if (dup) {
                    this.skipped++; st.upP = 1; result(idx, file.name, null, null, true); return;
                }
                emit(file.name, '上传到图床');
                const parts = await uploadToBed(blob, 'upload.' + ext, (p) => { st.upP = 0.02 + p * 0.93; emit(file.name); }, this.apiBase);
                st.upP = 0.96;
                const photo = {
                    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                    parts, sha256: sha,
                    width: dimsW, height: dimsH, createdAt: Date.now(),
                    ext, hasAudio
                };
                emit(file.name, '写库…');
                const saveR = await fetch((this.apiBase || '') + '/api/photos', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(photo)
                });
                if (!saveR.ok) throw new Error('写库失败 HTTP ' + saveR.status);
                st.upP = 1; this.done++;
                result(idx, file.name, photo);
            } catch (e) {
                console.error('[task-worker] upload fail:', file.name, e);
                st.err = (e && e.message) ? e.message : String(e);
                this.failed++;
                result(idx, file.name, null, st.err);
            } finally {
                blob = null; // 转完即释放，内存只绑并发数
                emit(file.name);
            }
        };

        // 图片 CONCURRENCY 并发；视频/GIF 单线程（WebCodecs 内部已并行，多开易 OOM）
        const picTasks = [], av1Tasks = [];
        files.forEach((file, idx) => {
            const heavy = av1Ok && (isVideoFile(file) || isGifFile(file));
            (heavy ? av1Tasks : picTasks).push(() => processOne(file, idx));
        });

        emit();
        await Promise.all([
            runWithConcurrency(picTasks, CONFIG.CONCURRENCY),
            runWithConcurrency(av1Tasks, 1)
        ]);

        this.progress = 1;
        this.status = 'done';
        this.step = this.failed === 0 ? '完成' : '部分失败';
        this.extraStat = `成功 ${this.done} · 跳过 ${this.skipped} · 失败 ${this.failed}`;
        this._emitUpdate();

        broadcast({
            type: 'upload-complete',
            taskId: this.id,
            summary: { done: this.done, skipped: this.skipped, failed: this.failed, total }
        });

        tasks.upload = null;
        setTimeout(() => broadcast({ type: 'task-clear', taskType: 'upload' }), 3000);
    }
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
        this._emitUpdate();
        // 逐张删除 + 进度由 shared.js runDeletePhotos 统一驱动（与页面主线程回退同一实现）
        await runDeletePhotos(this.ids, this.apiBase, (st) => {
            this.progress = st.progress;
            this.curFile = st.curFile;
            this.done = st.done; this.failed = st.failed;
            this.extraStat = `成功 ${this.done} · 失败 ${this.failed}`;
            this._emitUpdate();
        });

        this.progress = 1;
        this.status = 'done';
        this.step = this.failed === 0 ? '完成' : '部分失败';
        this.curFile = `${this.done} 成功 / ${this.failed} 失败`;
        this._emitUpdate();

        broadcast({
            type: 'delete-complete',
            taskId: this.id,
            deletedIds: this.ids,
            summary: { done: this.done, failed: this.failed, total: this.total }
        });

        tasks.delete = null;
        setTimeout(() => broadcast({ type: 'task-clear', taskType: 'delete' }), 3000);
    }
}

/* ============ 下载任务 ============ */
class DownloadTask {
    constructor(jobId, list, apiBase, tabId) {
        this.id = jobId;
        this.type = 'download';
        this.list = list;
        this.apiBase = apiBase;
        this.tabId = tabId || null; // 发起页标识：download-complete 广播带上，各页自行判断是否弹下载
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
            broadcast({ type: 'download-complete', taskId: this.id, zipUrl: this.zipBlobUrl, fileName: this.finalName, tabId: this.tabId });
            tasks.download = null;
            return;
        }

        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();

        // 下载/打包进度由 shared.js createDownloadProgress 统一汇总（与页面主线程同一实现）
        const dlp = createDownloadProgress(total, (s) => {
            this.progress = s.progress;
            this.done = s.done;
            this.failed = s.failed;
            this.curFile = s.curFile;
            this.step = s.step;
            this.extraStat = s.extraStat;
            this._emitUpdate();
        });

        const dlTasks = list.map((p, i) => async () => {
            try {
                const base = p.id + '.' + String(p.ext || 'webp').toLowerCase();
                const url = (this.apiBase || '') + '/api/file/' + p.id;
                const { blob, total: t } = await fetchWithProgress(
                    url,
                    (loaded, tot) => dlp.onItemProgress(i, loaded, tot)
                );
                dlp.onItemDone(i, t || blob.size || 1);
                zip.file(base, blob, { binary: true });
                return { ok: true };
            } catch (e) {
                console.warn('[task-worker] dl item fail:', e && e.message);
                dlp.onItemFail(i);
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
            const failedCount = total - successCount;
            dlp.setZip(meta.percent / 100, `${successCount}/${total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`);
        });
        dlp.setZip(1);

        this.zipBlobUrl = URL.createObjectURL(zipBlob);
        this.progress = 1;
        this.status = 'done';
        this.step = '完成';
        const finalFailed = total - successCount;
        this.extraStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
        this._emitUpdate();

        broadcast({ type: 'download-complete', taskId: this.id, zipUrl: this.zipBlobUrl, fileName: this.finalName, tabId: this.tabId });

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

        case 'start-upload':
            if (tasks.upload) {
                reply({ type: 'error', error: '已有上传任务进行中' });
                return;
            }
            try {
                tasks.upload = new UploadTask(
                    'up_' + Date.now().toString(36),
                    msg.files || [],
                    msg.apiBase || ''
                );
                reply({ type: 'task-started', taskType: 'upload', taskId: tasks.upload.id });
            } catch (err) {
                console.warn('[task-worker] start-upload err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
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
                    msg.apiBase || '',
                    msg.tabId || null
                );
                reply({ type: 'task-started', taskType: 'download', taskId: tasks.download.id });
            } catch (err) {
                console.warn('[task-worker] start-download err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;

        case 'disconnect':
            if (replyPort) clients.delete(replyPort);
            if (clients.size === 0 && !keepAliveTimer) {
                keepAliveTimer = setTimeout(function () {
                    keepAliveTimer = null;
                    if (clients.size === 0 && typeof self.close === 'function') {
                        var dt = tasks['delete'], dl = tasks['download'];
                        var running = (dt && dt.status === 'running') || (dl && dl.status === 'running');
                        if (!running) { try { self.close(); } catch (_) { } }
                    }
                }, 120000);
            }
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