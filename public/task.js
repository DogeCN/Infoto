/* =========================================================
 * Infoto Shared Task Worker
 * 跨页面保持上传/下载/删除任务推进，页面切换不丢失进度
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
const KEEP_ALIVE_MS = 30000;

function scheduleGracePeriod() {
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(() => {
        if (clients.size === 0 && !hasActiveTask()) {
        }
    }, KEEP_ALIVE_MS);
}

function broadcast(msg) {
    for (const port of clients) {
        try { port.postMessage(msg); } catch (e) { console.warn('[task-worker] broadcast fail:', e && e.message); }
    }
    if (bc) {
        try { bc.postMessage(msg); } catch (e) { }
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
    constructor(jobId, input, apiBase, mode) {
        this.id = jobId;
        this.type = 'upload';
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '准备中';
        this.done = 0; this.skipped = 0; this.failed = 0;
        this.extraStat = '';
        this._prepBytes = { total: 0, done: 0 };
        this._uploadBytes = { total: 0, done: 0 };
        this._rawBytes = 0;
        this.PHASE_WEIGHT = { PREP: 0.20, UPLOAD: 0.75 };
        this.SUB = { CHECK: 0.05, UPLOAD: 0.90, DIMS: 0.05 };
        this.mode = mode || 'raw';
        if (this.mode === 'prepared') {
            this.prepared = input;
            this.files = input.map(p => ({ name: p.fileName || 'upload', size: p.blob?.size || 0 }));
        } else {
            this.files = input;
            this.prepared = null;
        }
        this.total = this.files.length;
        this.curFile = this.files.length > 1 ? `${this.files.length} 个文件` : (this.files[0]?.name || '');
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
        };
    }

    _emitUpdate() {
        broadcast({ type: 'task-update', task: this.snapshot() });
    }

    _buildStat(extraLabel) {
        const elapsed = (Date.now() - this.startedAt) / 1000 || 0.001;
        const phasePrep = this.PHASE_WEIGHT.PREP * (this._prepBytes.done / Math.max(1, this._prepBytes.total));
        const phaseUp = this.PHASE_WEIGHT.UPLOAD * (this._uploadBytes.done / Math.max(1, this._uploadBytes.total));
        const overallPct = Math.min(1, phasePrep + phaseUp);
        const processedEst = this._rawBytes * overallPct;
        const speed = processedEst / elapsed;
        const remain = overallPct > 0.02 ? (this._rawBytes - processedEst) / Math.max(0.0001, speed) : 0;
        const mm = Math.floor(remain / 60), ss = Math.round(remain % 60).toString().padStart(2, '0');
        const parts = [];
        parts.push(`${formatSize(processedEst)} / ${formatSize(this._rawBytes)}`);
        if (elapsed > 2) parts.push(`${formatSize(speed)}/s`);
        if (elapsed > 4 && remain > 0 && remain < 3600 * 6) parts.push(`剩 ${mm ? mm + '分' : ''}${ss}秒`);
        if (extraLabel) parts.push(extraLabel);
        return parts.join(' · ');
    }

    _setOverall(file, step, extraLabel) {
        const phasePrep = this.PHASE_WEIGHT.PREP * (this._prepBytes.done / Math.max(1, this._prepBytes.total));
        const phaseUp = this.PHASE_WEIGHT.UPLOAD * (this._uploadBytes.done / Math.max(1, this._uploadBytes.total));
        this.progress = Math.min(1, phasePrep + phaseUp);
        if (file !== null) this.curFile = file;
        if (step !== null) this.step = step;
        this.extraStat = this._buildStat(extraLabel);
        this._emitUpdate();
    }

    async _checkHashExists(sha) {
        try {
            const r = await fetch(this.apiBase + '/api/photos/hash/' + sha, { cache: 'no-store' });
            if (r.ok) {
                const j = await r.json();
                if (j && j.exists) return j.photo || true;
            }
        } catch (e) { console.warn('[task-worker] hash check fail:', e && e.message); }
        return false;
    }

    _compressToWebp(file, quality = 0.8) {
        return new Promise(async (resolve, reject) => {
            try {
                const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
                const canvas = new OffscreenCanvas(bmp.width, bmp.height);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bmp, 0, 0);
                bmp.close();
                const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
                resolve(blob);
            } catch (e) { console.warn('[task-worker] webp compress fail, fallback null:', e && e.message); resolve(null); }
        });
    }

    async _safeForWebp(file) {
        const PIC_EXT_RE = /\.(png|jpe?g|webp|bmp|avif|jxl|heic|heif|tiff?|ico)$/i;
        const GIF_EXT_RE = /\.gif$/i;
        return !!(file && (file.type?.startsWith?.('image/') || PIC_EXT_RE.test(file.name || ''))) && !GIF_EXT_RE.test(file.name || '');
    }

    async _run() {
        const t0 = this.startedAt;
        const total = this.total;
        const files = this.files;
        let prepared;

        if (this.mode === 'prepared' && this.prepared) {
            prepared = this.prepared.map((p, i) => ({
                idx: i,
                file: { name: p.fileName || 'upload', size: p.blob?.size || 0 },
                err: null,
                blob: p.blob,
                ext: p.ext || 'webp',
                sha: p.sha || null,
                hasAudio: !!p.hasAudio,
                width: p.width || 0,
                height: p.height || 0,
            }));
            const blobBytes = prepared.reduce((a, p) => a + (p.blob?.size || 0), 0) || 1;
            this._rawBytes = blobBytes;
            this._prepBytes.total = blobBytes;
            this._prepBytes.done = blobBytes;
            this._uploadBytes.total = blobBytes;
            this._setOverall(files.length > 1 ? `${files.length} 个文件` : files[0]?.name, '上传中…');
        } else {
            const rawBytes = files.reduce((a, f) => a + (f.size || 0), 0) || 1;
            this._rawBytes = rawBytes;
            this._prepBytes.total = rawBytes;
            this._uploadBytes.total = rawBytes;
            this._setOverall(files.length > 1 ? `${files.length} 个文件` : files[0].name, '预处理中…');
            prepared = [];
            for (let i = 0; i < total; i++) {
                const file = files[i];
                const base = { idx: i, file, err: null, blob: file, ext: file.name?.split('.').pop()?.toLowerCase() || 'webp', sha: null, hasAudio: false, width: 0, height: 0 };
                try {
                    base.sha = await sha256Hex(await file.arrayBuffer());
                } catch (e) { base.err = e; console.warn('[task-worker] sha256 fail:', e && e.message); }
                this._prepBytes.done = Math.min(this._prepBytes.total, this._prepBytes.done + (file.size || 0));
                prepared.push(base);
                this._setOverall(null, '预处理中…');
            }
            this._prepBytes.done = this._prepBytes.total;
        }

        const results = [];
        for (let i = 0; i < total; i++) {
            const pr = prepared[i];
            const file = pr.file;
            const fileWeightBytes = pr.blob?.size || file.size || 0;
            const uploadBaseBefore = this._uploadBytes.done;
            const addSubProgress = (subP) => {
                this._uploadBytes.done = Math.min(
                    this._uploadBytes.total,
                    uploadBaseBefore + fileWeightBytes * subP
                );
            };
            if (pr.err) {
                this.failed++;
                addSubProgress(1);
                this._setOverall(file.name, '失败', `错误: ${pr.err.message}`);
                results.push({ ok: false, err: pr.err.message, fileName: file.name });
                continue;
            }
            const upName = 'upload.' + pr.ext;

            addSubProgress(this.SUB.CHECK * 0.1);
            this._setOverall(file.name, '查重…');
            try {
                if (!pr.sha) pr.sha = await sha256Hex(await pr.blob.arrayBuffer());
                addSubProgress(this.SUB.CHECK);
                const dup = await this._checkHashExists(pr.sha);
                if (dup) {
                    this.skipped++;
                    addSubProgress(1);
                    this._setOverall(file.name, '已存在，跳过');
                    results.push({ ok: false, skipped: true, fileName: file.name, existingPhoto: dup });
                    continue;
                }
                const upStart = this.SUB.CHECK;
                const upSpan = this.SUB.UPLOAD;
                const parts = await uploadToBed(pr.blob, upName, p => {
                    addSubProgress(upStart + p * upSpan);
                    this._setOverall(file.name, p < 1 ? '上传到图床' : '上传完成');
                }, this.apiBase);
                addSubProgress(this.SUB.CHECK + this.SUB.UPLOAD + this.SUB.DIMS);
                const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                const photo = {
                    id,
                    parts,
                    sha256: pr.sha,
                    width: pr.width || 0,
                    height: pr.height || 0,
                    createdAt: Date.now(),
                    ext: pr.ext,
                    hasAudio: !!pr.hasAudio,
                };
                await fetch(this.apiBase + '/api/photos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(photo)
                });
                photo.url = (this.apiBase || '') + '/api/file/' + id;
                addSubProgress(1);
                this.done++;
                results.push({ ok: true, photo, fileName: file.name });
                this._setOverall(file.name, `已完成 ${this.done}/${total}`);
            } catch (err) {
                console.warn('[task-worker] upload item fail:', err && err.message);
                this.failed++;
                addSubProgress(1);
                this._setOverall(file.name, '失败', err.message);
                results.push({ ok: false, err: err.message, fileName: file.name });
            }
        }
        this._uploadBytes.done = this._uploadBytes.total;

        this.progress = 1;
        this.status = 'done';
        this.step = '完成';
        this.extraStat = `共 ${formatSize(rawBytes)} · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`;
        this._emitUpdate();

        broadcast({
            type: 'upload-complete',
            taskId: this.id,
            results,
            summary: { done: this.done, skipped: this.skipped, failed: this.failed, total: this.total }
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

        case 'start-upload':
        case 'start-upload-prepared': {
            if (tasks.upload) {
                reply({ type: 'error', error: '已有上传任务进行中' });
                return;
            }
            try {
                const mode = msg.type === 'start-upload-prepared' ? 'prepared' : 'raw';
                const input = mode === 'prepared' ? (msg.items || []) : (msg.files || []);
                tasks.upload = new UploadTask(
                    'up_' + Date.now().toString(36),
                    input,
                    msg.apiBase || '',
                    mode
                );
                reply({ type: 'task-started', taskType: 'upload', taskId: tasks.upload.id });
            } catch (err) {
                console.warn('[task-worker] start-upload err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;
        }

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