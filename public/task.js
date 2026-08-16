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
// 广播序号：时间戳基座 + 12 位计数器。跨 worker 重启单调递增（重启后时间戳必然更大），
// 页面仅凭 _seq 单调性即可去重（同一 _seq 的 port/BC 双通道副本只放行一次），
// 无需再猜测"seq 大幅回退 = 新 worker 重启"。此前 worker 重启后 _seq 从 1 重计，
// 页面靠"回退 >128 重置基线"判定新 worker——上传大批次时广播跨度常超 128，
// 双通道乱序/延迟（页面切后台、BC 积压）会把已处理过的消息副本误判为新 worker 消息
// 重新放行 → 同一照片重复插卡（KV 按 id upsert 无重复，表现为"刷新后重复卡消失"）。
let _seqBase = Date.now() * 4096;
let _seqCount = 0;
function nextSeq() {
    const t = Date.now() * 4096;
    if (t > _seqBase) { _seqBase = t; _seqCount = 0; }
    return _seqBase + _seqCount++; // base 每毫秒步进 4096，counter 同毫秒内自增；永不回卷
}

function broadcast(msg) {
    // 每条广播带递增 _seq：页面同时经 port 与 BroadcastChannel 收到同一条消息，用 _seq 去重（防终态消息触发两次下载/toast）
    const m = { ...msg, _seq: nextSeq() };
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
        this.files = files || []; // File[]（页面 structured clone 传入；运行中可 appendFiles 追加）
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '准备中…';
        this.curFile = files.length > 1 ? `${files.length} 个文件` : (files[0]?.name || '');
        this.done = 0; this.skipped = 0; this.failed = 0; this.total = files.length;
        this.extraStat = '';
        this.rows = []; // 并发槽位行：[{ key, file, step }]，随 emit 刷新
        this._append = null; // _run 内闭包赋值：真正执行追加的逻辑
        // _ready 只表示"闭包初始化完成"（appendFiles 可安全追加），
        // 不是任务完成——此前 `this._ready = this._run()` 会让 append 等到任务跑完才被放行（永远追加不上）
        this._ready = new Promise(res => { this._readyResolve = res; });
        this._run();
    }

    // 运行中动态追加文件（上传进行中再上传 → 合并进同一任务，不新开任务竞争进度环）
    async appendFiles(newFiles) {
        await this._ready;
        if (!newFiles || !newFiles.length) return;
        if (this.status !== 'running' || !this._append) throw new Error('上传任务已结束');
        this._append(newFiles);
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
            rows: this.rows,
            startedAt: this.startedAt,
        };
    }

    _emitUpdate() {
        broadcast({ type: 'task-update', task: this.snapshot() });
    }

    async _run() {
        const av1Ok = await supportsAv1WebCodecs();
        const PHASE = { PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05 };

        // 动态状态：运行中可通过 _append（appendFiles）追加文件，全部状态随追加扩展
        const fileStates = [];
        let prepTotal = 1;
        const picQ = createTaskQueue(CONFIG.CONCURRENCY); // 图片并发
        const av1Q = createTaskQueue(1);                  // 视频/GIF 单线程（WebCodecs 内部已并行，多开易 OOM）
        let finished = 0;

        const curOverall = () => {
            let prepSum = 0, upSum = 0, upDen = 0;
            for (const s of fileStates) {
                prepSum += s.prepP * s.units;
                const ub = s.uploadBytes || s.size || 1;
                upSum += s.upP * s.units; upDen += s.units;
            }
            const prepP = prepSum / (prepTotal || 1);
            const upP = upDen ? upSum / upDen : 0;
            return Math.min(1, PHASE.PREP * prepP + PHASE.UPLOAD * upP);
        };
        const emit = (fileName, step) => {
            this.curFile = fileName || (this.total > 1 ? `${this.total} 个文件` : (this.files[0]?.name || ''));
            if (step) this.step = step;
            this.progress = curOverall();
            this.extraStat = `成功 ${this.done} · 跳过 ${this.skipped} · 失败 ${this.failed}`;
            this.rows = fileStates.filter(s => s.active).map(s => ({ key: s.idx, file: this.files[s.idx].name, step: s.stepLabel }));
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
                    st.active = true; st.stepLabel = '压缩'; emit(file.name);
                    const webp = await compressToWebp(file, WEBP_QUALITY);
                    if (!webp || !webp.blob) { st.err = '图片 WebP 压缩失败'; this.failed++; result(idx, file.name, null, st.err); return; }
                    blob = webp.blob; ext = 'webp'; dimsW = webp.width || 0; dimsH = webp.height || 0;
                } else if (isV || isG) {
                    if (!av1Ok) {
                        const msg = (isG ? 'GIF' : '视频') + '需要支持 AV1 WebCodecs 的浏览器';
                        st.err = msg; this.failed++; result(idx, file.name, null, msg); return;
                    }
                    st.active = true; st.stepLabel = '转码'; emit(file.name);
                    // Worker 无 <video> 元素：非 MP4 容器由 transcodeToAv1Webm 抛错（页面已对含非 MP4 视频的批次降级主线程，正常到不了这里）
                    const r = await transcodeToAv1Webm(file, (p) => { st.prepP = Math.max(0, Math.min(1, p || 0)); emit(file.name); });
                    blob = r.blob; ext = 'webm'; hasAudio = !!r.hasAudio; dimsW = r.width || 0; dimsH = r.height || 0;
                }
                st.prepP = 1;
                st.uploadBytes = blob.size || st.size || 1;
                const ab = await blob.arrayBuffer();
                const sha = await sha256Hex(ab);
                st.stepLabel = '查重'; emit(file.name); st.upP = 0.02;
                const dup = await checkHashExists(sha, this.apiBase);
                if (dup) {
                    this.skipped++; st.upP = 1; result(idx, file.name, null, null, true); return;
                }
                st.stepLabel = '上传'; emit(file.name);
                const parts = await uploadToBed(blob, 'upload.' + ext, (p) => { st.upP = 0.02 + p * 0.93; emit(file.name); }, this.apiBase);
                st.upP = 0.96;
                const photo = {
                    id: genPhotoId(),
                    parts, sha256: sha,
                    width: dimsW, height: dimsH, createdAt: Date.now(),
                    ext, hasAudio
                };
                st.stepLabel = '写库'; emit(file.name);
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
                st.active = false; // 结束即移出并发槽位行
                emit(file.name);
            }
        };

        const maybeFinish = () => {
            // 全部文件已结束且两队列都空闲才算完成（追加的文件会 push 新任务，finished 追不上 total 前不会误判）
            if (finished < fileStates.length) return;
            if (picQ.busy || av1Q.busy) return;
            this.progress = 1;
            this.status = 'done';
            this.step = this.failed === 0 ? '完成' : '部分失败';
            this.extraStat = `成功 ${this.done} · 跳过 ${this.skipped} · 失败 ${this.failed}`;
            this._emitUpdate();

            broadcast({
                type: 'upload-complete',
                taskId: this.id,
                summary: { done: this.done, skipped: this.skipped, failed: this.failed, total: this.total }
            });

            tasks.upload = null;
            setTimeout(() => broadcast({ type: 'task-clear', taskType: 'upload' }), 3000);
        };

        const enqueue = (file) => {
            const idx = fileStates.length;
            // 视频/图片混合时视频应占远大于 size 的 progress 份额（转码+上传比图片慢得多）；
            // 用 units 加权（视频 = max(MIN, size*8)）让 progress 在并发队列里反映"时间预算"。
            const units = (isVideoFile(file) || isGifFile(file))
                ? Math.max(6 * 1024 * 1024, (file.size || 0) * 8)
                : (file.size || 1);
            fileStates.push({ idx, size: file.size || 0, units, prepP: 0, upP: 0, uploadBytes: file.size || 0, err: null, active: false, stepLabel: '等待' });
            prepTotal += units;
            this.total = fileStates.length;
            const heavy = av1Ok && (isVideoFile(file) || isGifFile(file));
            (heavy ? av1Q : picQ).push(async () => {
                try { await processOne(file, idx); }
                finally { finished++; maybeFinish(); }
            });
        };

        // 动态追加入口：页面 append-upload 消息调用（appendFiles 先 await _ready 保证闭包就绪）
        this._append = (newFiles) => {
            for (const f of newFiles || []) { this.files.push(f); enqueue(f); }
            emit();
        };

        // 初始批次
        for (const f of this.files) enqueue(f);
        emit();
        this._readyResolve && this._readyResolve(); // 闭包就绪：appendFiles 现在可安全追加

        await Promise.all([picQ.idle(), av1Q.idle()]);
        maybeFinish();
    }
}

/* ============ 删除任务 ============ */
class DeleteTask {
    constructor(jobId, ids, apiBase) {
        this.id = jobId;
        this.type = 'delete';
        this.ids = ids || [];
        this.apiBase = apiBase;
        this.startedAt = Date.now();
        this.status = 'running';
        this.progress = 0;
        this.step = '删除中…';
        this.curFile = `${ids.length} 张照片`;
        this.done = 0; this.failed = 0; this.total = ids.length;
        this.skipped = 0;
        this.extraStat = '';
        this._append = null;
        this._ready = new Promise(res => { this._readyResolve = res; });
        this._run();
    }

    // 运行中动态追加 id（删除进行中再选几张删 → 合并进同一任务）
    async appendIds(newIds) {
        await this._ready;
        if (!newIds || !newIds.length) return;
        if (this.status !== 'running' || !this._append) throw new Error('删除任务已结束');
        this._append(newIds);
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
        // 逐张删除 + 进度由 shared.js createDeleteRunner 统一驱动（与页面主线程回退同一实现），
        // runner 支持运行中 appendIds 追加
        const runner = createDeleteRunner(this.apiBase, (st) => {
            this.progress = st.progress;
            this.curFile = st.curFile;
            this.done = st.done; this.failed = st.failed;
            this.total = st.total;
            this.extraStat = `成功 ${this.done} · 失败 ${this.failed}`;
            this._emitUpdate();
        });
        this._append = (ids) => {
            for (const id of ids || []) this.ids.push(id);
            runner.append(ids);
            this.total = this.ids.length;
            this.curFile = `${this.ids.length} 张照片`;
            this._emitUpdate();
        };
        runner.append(this.ids); // 初始批次入队（不再重复 push this.ids）
        this._readyResolve && this._readyResolve(); // 闭包就绪：appendIds 现在可安全追加

        const r = await runner.done;
        this.progress = 1;
        this.status = 'done';
        this.step = r.failed === 0 ? '完成' : '部分失败';
        this.curFile = `${r.done} 成功 / ${r.failed} 失败`;
        this.total = r.total;
        this._emitUpdate();

        broadcast({
            type: 'delete-complete',
            taskId: this.id,
            deletedIds: this.ids,
            summary: { done: r.done, failed: r.failed, total: r.total }
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
        this._append = null;
        this._ready = new Promise(res => { this._readyResolve = res; });
        this._run();
    }

    // 运行中动态追加条目（下载进行中再选几张 → 合并进同一任务；打包阶段拒绝追加）
    async appendItems(newList) {
        await this._ready;
        if (!newList || !newList.length) return;
        if (this.status !== 'running' || !this._append) throw new Error('下载任务已结束');
        this._append(newList);
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
            this._readyResolve && this._readyResolve();
            tasks.download = null;
            return;
        }

        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();

        // 下载/打包进度由 shared.js createDownloadProgress 统一汇总（与页面主线程同一实现），
        // dlp 支持 append 动态扩项；fetch 用动态队列，运行中可追加条目
        const dlp = createDownloadProgress(total, (s) => {
            this.progress = s.progress;
            this.done = s.done;
            this.failed = s.failed;
            this.total = s.total;
            this.curFile = s.curFile;
            this.step = s.step;
            this.extraStat = s.extraStat;
            this._emitUpdate();
        });
        const q = createTaskQueue(CONFIG.CONCURRENCY);
        let successCount = 0;

        const fetchOne = (p, i) => async () => {
            try {
                const base = p.id + '.' + String(p.ext || 'webp').toLowerCase();
                const url = (this.apiBase || '') + '/api/file/' + p.id;
                const { blob, total: t } = await fetchWithProgress(
                    url,
                    (loaded, tot) => dlp.onItemProgress(i, loaded, tot)
                );
                dlp.onItemDone(i, t || blob.size || 1);
                zip.file(base, blob, { binary: true });
                successCount++;
            } catch (e) {
                console.warn('[task-worker] dl item fail:', e && e.message);
                dlp.onItemFail(i);
            }
        };
        const enqueue = (p, i) => q.push(() => fetchOne(p, i));

        // 初始批次
        list.forEach((p, i) => enqueue(p, i));
        this._readyResolve && this._readyResolve(); // 闭包就绪：appendItems 现在可安全追加

        // 动态追加入口：appendItems 调用；打包中（_zipping）拒绝追加
        this._append = (items) => {
            if (this._zipping) { console.warn('[task-worker] download zipping, append ignored'); return; }
            for (const p of items || []) {
                const i = dlp.append(1) - 1; // 新条目索引
                this.list.push(p);
                this.total = this.list.length;
                enqueue(p, i);
            }
            this.curFile = `${this.list.length} 张照片`;
            this._emitUpdate();
        };

        await q.idle();
        this._zipping = true;

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
            const failedCount = this.total - successCount;
            dlp.setZip(meta.percent / 100, `${successCount}/${this.total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`);
        });
        dlp.setZip(1);

        this.zipBlobUrl = URL.createObjectURL(zipBlob);
        this.progress = 1;
        this.status = 'done';
        this.step = '完成';
        const finalFailed = this.total - successCount;
        this.extraStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
        this._emitUpdate();

        broadcast({ type: 'download-complete', taskId: this.id, zipUrl: this.zipBlobUrl, fileName: this.finalName, tabId: this.tabId });

        tasks.download = null;
        setTimeout(() => broadcast({ type: 'task-clear', taskType: 'download' }), 3000);
    }
}

/* ============ 连接管理 ============ */
async function handleIncomingMessage(msg, replyPort) {
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

        /* ---- 运行中追加（上传/下载/删除 进行中再触发同类操作 → 合并进同一任务） ---- */
        case 'append-upload':
            if (!tasks.upload || tasks.upload.status !== 'running') {
                reply({ type: 'error', error: '无进行中的上传任务' });
                return;
            }
            try {
                await tasks.upload.appendFiles(msg.files || []);
                reply({ type: 'task-started', taskType: 'upload', taskId: tasks.upload.id, appended: true });
            } catch (err) {
                console.warn('[task-worker] append-upload err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;

        case 'append-delete':
            if (!tasks.delete || tasks.delete.status !== 'running') {
                reply({ type: 'error', error: '无进行中的删除任务' });
                return;
            }
            try {
                await tasks.delete.appendIds(msg.ids || []);
                reply({ type: 'task-started', taskType: 'delete', taskId: tasks.delete.id, appended: true });
            } catch (err) {
                console.warn('[task-worker] append-delete err:', err && err.message);
                reply({ type: 'error', error: err.message });
            }
            break;

        case 'append-download':
            if (!tasks.download || tasks.download.status !== 'running') {
                reply({ type: 'error', error: '无进行中的下载任务' });
                return;
            }
            try {
                await tasks.download.appendItems(msg.list || []);
                reply({ type: 'task-started', taskType: 'download', taskId: tasks.download.id, appended: true });
            } catch (err) {
                console.warn('[task-worker] append-download err:', err && err.message);
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