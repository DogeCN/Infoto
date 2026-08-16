/* =========================================================
 * 上传：SharedWorker 后台（纯图片）/ 主线程（视频/GIF）双路径，可动态追加
 * 依赖：icons.js、shared-refs.js、store.js、ui.js、masonry.js、task-worker.js、shared.js
 * ========================================================= */
function applyFileInputAccept() {
    const inp = $('#fileInput');
    if (!inp) return;
    if (window._av1Support === true) inp.setAttribute('accept', 'image/*,video/*,.gif');
    else if (window._av1Support === false) inp.setAttribute('accept', 'image/png,image/jpeg,image/webp');
}
$('#fileInput')?.setAttribute('accept', 'image/*,video/*,.gif');
supportsAv1WebCodecs().then(applyFileInputAccept);

/* ---- 主线程专用：非 MP4 视频的 <video> 元素解码兜底（SharedWorker 无 DOM，走不到这里） ---- */
function _videoMetaViaVideoEl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
        v.onloadedmetadata = () => { const m = { width: v.videoWidth, height: v.videoHeight, durationSec: Math.max(0.001, isFinite(v.duration) ? v.duration : 1), fps: FPS_CAP }; URL.revokeObjectURL(url); resolve(m); };
        v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('video load fail')); };
        v.load();
    });
}
async function _decodeEncodeVideoElSeek(file, meta, sink, report) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try { await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video load fail')); v.load(); }); }
    catch (e) { URL.revokeObjectURL(url); throw e; }
    const targetFps = Math.min(meta.fps || FPS_CAP, FPS_CAP);
    const nOut = Math.max(1, Math.round((meta.durationSec || v.duration || 1) * targetFps));
    const seekTo = (t) => new Promise((res) => {
        const onSeeked = () => { v.removeEventListener('seeked', onSeeked); res(); };
        v.addEventListener('seeked', onSeeked);
        v.currentTime = Math.min(t, v.duration || t);
    });
    for (let i = 0; i < nOut; i++) {
        const target = i / targetFps;
        await seekTo(target);
        // <video> 元素 seek 对齐关键帧，实际落点可能偏离目标帧；偏差超过半帧间距说明
        // 取到了相邻重复帧，跳过避免转码后画面"卡帧重复"（video 兜底路径的已知缺陷）
        const actual = v.currentTime || target;
        if (Math.abs(actual - target) > 0.5 / targetFps) continue;
        await new Promise(r => requestAnimationFrame(r));
        const bmp = await createImageBitmap(v);
        // 进度由 sink 内部按 frameIdx/totalFrames 节流（每 4 帧一次），这里不再独立 report
        sink.push(bmp);
    }
    v.pause();
    try { v.currentTime = 0; } catch (e) { console.warn('[infoto] video reset fail', e); }
    URL.revokeObjectURL(url);
}
// 非 MP4 / MP4 解码失败兜底：注入 shared.js transcodeToAv1Webm 的 opts.videoFallback
async function _transcodeVideoFallback(file, { makeEncoder, muxer, report }) {
    const vmeta = await _videoMetaViaVideoEl(file);
    const ew = (vmeta.width + 1) & ~1, eh = (vmeta.height + 1) & ~1;
    const targetFps = Math.min(vmeta.fps || FPS_CAP, FPS_CAP);
    const totalFrames = Math.max(1, Math.round((vmeta.durationSec || 1) * targetFps));
    // 注意：<video> 无法直接读 tkhd matrix 拿 rotation（且 fallback 主要处理非 MP4 容器）。
    // MP4 路径已用 meta.rotation 旋转画布；非 MP4 极少触发，方向问题暂不修。
    const { enc, sink } = await makeEncoder(ew, eh, 0);
    muxer.w = ew; muxer.h = eh;
    const s = sink(1 / targetFps, totalFrames);
    await _decodeEncodeVideoElSeek(file, vmeta, s, report);
    await enc.flush(); enc.close();
}

/* ---- 文件选择 / 拖放入口 ---- */
// 视频"等效时间预算"估算：同 size 下视频转码+上传耗时比图片高数倍到数十倍，
// progress 用文件加权（视频项 ≫ 图片项），让同时混合上传时视频占据更大的进度份额。
// 8× size 起点 + 6 MiB 兜底（短视频文件即便 200KB 也至少有 6MiB 等效预算，避免被图压制）。
const VIDEO_UNIT_FACTOR = 8;
const VIDEO_MIN_UNITS = 6 * 1024 * 1024;
function estUnits(file) {
    if (isVideoFile(file) || isGifFile(file)) {
        return Math.max(VIDEO_MIN_UNITS, (file.size || 0) * VIDEO_UNIT_FACTOR);
    }
    return file.size || 1;
}
$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length === 0) return;
    await uploadFiles(files);
});
document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length === 0) return;
    e.preventDefault();
    await uploadFiles(files);
});
document.addEventListener('dragover', e => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault();
});

/* ---- 上传分派 ---- */
async function uploadFiles(files) {
    await supportsAv1WebCodecs();
    applyFileInputAccept();
    if (files.length === 0) return;
    // 后台任务路径（SharedWorker）：仅纯图片可后台转码/上传、跨页面推进。
    // 视频/GIF 必须走主线程：WebCodecs（VideoEncoder/VideoDecoder/VideoFrame）在
    // SharedWorker 环境中不可用（Chrome 仅 Window/DedicatedWorker 暴露），Worker 内
    // 探测 supportsAv1WebCodecs 恒 false、转码必然失败——此前"图片/GIF/MP4 均可后台"
    // 的假设是错的（实测 SharedWorker 无 VideoEncoder），含视频/GIF 一律降级主线程。
    const hasVideoOrGif = files.some(f => isVideoFile(f) || isGifFile(f));
    if (TaskWorker.isSupported() && !hasVideoOrGif) {
        // 已有上传任务进行中 → 动态追加到同一任务（不再新开任务竞争进度环）
        const cur = TaskWorker.getTask('upload');
        if (cur && cur.status === 'running') { uploadAppendViaTaskWorker(files); return; }
        uploadViaTaskWorker(files);
        return;
    }
    // 主线程路径：合并到进行中的主线程上传（同一页面只跑一个主线程上传批次）
    if (_mainUploadRunner && _mainUploadRunner.running) { _mainUploadRunner.append(files); return; }
    runMainThreadUpload(files);
}

// 上传监听器页面级单例：同一页面同时只挂一个（追加/启动复用），
// 保证 photo-result 只被处理一次（重复插卡/计数）——append 时复用同一闭包的保序缓冲
let _uploadListener = null;
function ensureUploadListener() {
    if (_uploadListener) return;
    const pendingPhotos = new Map();
    let _nextInsertIdx = 0;
    function flushCards() {
        const run = [];
        while (pendingPhotos.has(_nextInsertIdx)) {
            run.push(pendingPhotos.get(_nextInsertIdx));
            pendingPhotos.delete(_nextInsertIdx);
            _nextInsertIdx++;
        }
        for (let k = run.length - 1; k >= 0; k--) {
            if (run[k]) prependCardToMasonry(run[k]);
        }
    }
    function markReady(idx, photo) {
        pendingPhotos.set(idx, photo || null);
        flushCards();
    }

    const summary = { done: 0, skipped: 0, failed: 0 };
    const off = TaskWorker.onMessage((msg) => {
        if (msg.type === 'error') {
            toast(msg.error || '上传启动失败', 'alert');
            resetProgressUI('upload');
            off();
            _uploadListener = null;
            return;
        }
        if (msg.type === 'task-update' && msg.task && msg.task.type === 'upload') {
            applyTaskUpdate(msg.task);
        }
        if (msg.type === 'photo-result') {
            if (msg.photo) {
                const p = msg.photo;
                p.url = fileUrl(p.id);
                p.hasAudio = !!p.hasAudio;
                // 幂等：photo-result 若被重复处理（历史去重 bug / 残留监听器），数据层只保留一份，
                // 杜绝"刷新后消失的重复卡"（KV 写库按 id upsert 无重复，重复纯属 UI 层注入）
                if (!Store.photos.some(x => x.id === p.id)) Store.photos.unshift(p);
                summary.done++;
                markReady(msg.idx, p);
                // 尺寸已由 Worker 压缩/转码阶段带回并随写库保存；卡片 onload 另有 markDimsDirty
                // 兜底，此处不再重复 loadDims + PATCH（省一次 DOM 资源加载与多余写请求）
            } else if (msg.skipped) {
                summary.skipped++;
                markReady(msg.idx, null);
                toast(`${msg.name || ''} 已存在，跳过`, 'info');
            } else {
                summary.failed++;
                markReady(msg.idx, null);
                toast(`${msg.name || ''} 上传失败: ${msg.err || '未知错误'}`, 'alert');
            }
        }
        if (msg.type === 'upload-complete') {
            setProgress(1, null, summary.failed === 0 ? '完成' : '部分失败', { stat: `成功 ${summary.done} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`, done: summary.done, skipped: summary.skipped, failed: summary.failed }, 'upload');
            scheduleProgressFade('upload');
            off();
            _uploadListener = null;
        }
    });
    _uploadListener = off;
}

// 后台上传启动：任务在 SharedWorker 中执行（转码/查重/上传/写库），页面只收进度 + 按序插卡
function uploadViaTaskWorker(files) {
    resetProgressUI('upload');
    ensureUploadListener();
    if (!TaskWorker.startUpload(files, apiBase())) {
        // 罕见兜底：消息通道异常（worker 未收到任务）→ 安全回退主线程（不会重复上传）
        if (_uploadListener) { _uploadListener(); _uploadListener = null; }
        runMainThreadUpload(files);
        return;
    }
}

// 追加到进行中的后台上传任务（worker 端 UploadTask.appendFiles）
function uploadAppendViaTaskWorker(files) {
    ensureUploadListener(); // 复用已挂监听器（保序缓冲 idx 连续），不重复绑定
    if (!TaskWorker.appendUpload(files, apiBase())) {
        // 竞态：任务恰在此刻结束（毫秒级窗口）→ 回退为启动新任务
        if (!TaskWorker.startUpload(files, apiBase())) {
            if (_uploadListener) { _uploadListener(); _uploadListener = null; }
            runMainThreadUpload(files);
        }
    }
}

// 页面级：进行中的主线程上传批次（含视频/GIF 或 Worker 不可用路径）；再上传时 append 合并
let _mainUploadRunner = null;
async function runMainThreadUpload(files) {
    // 防御：理论上 uploadFiles 已分流，此处兜底合并（不新开批次）
    if (_mainUploadRunner && _mainUploadRunner.running) { _mainUploadRunner.append(files); return; }
    const runner = { running: true, append: null };
    _mainUploadRunner = runner;
    resetProgressUI('upload'); // 新批次开始前清掉残留进度（历史 bug：主线程路径漏重置，残留上次状态）

    const t0 = Date.now();
    const av1Ok = window._av1Support === true;
    let done = 0, failed = 0, skipped = 0;
    const PHASE = { PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05 };

    // 动态状态：allFiles / fileStates 随 append 扩展（idx 连续递增），队列运行中可追加
    const allFiles = [];
    const fileStates = [];
    let prepTotal = 1;
    const picQ = createTaskQueue(CONFIG.CONCURRENCY); // 图片并发
    const av1Q = createTaskQueue(1);                  // 视频/GIF 单线程（WebCodecs 内部已并行，多开极易 OOM）
    let finished = 0;
    let finishing = false;
    let pendingAppend = [];

    const activeRows = () => fileStates
        .filter(s => s.active)
        .map(s => ({ key: s.idx, file: allFiles[s.idx].name, step: s.stepLabel }));

    // 并发保序缓冲：按原始下标顺序 flush 卡片，避免乱序插入造成视觉抖动
    const pendingPhotos = new Map();
    let _nextInsertIdx = 0;
    function flushCards() {
        const run = [];
        while (pendingPhotos.has(_nextInsertIdx)) {
            run.push(pendingPhotos.get(_nextInsertIdx));
            pendingPhotos.delete(_nextInsertIdx);
            _nextInsertIdx++;
        }
        // 逆序 prepend：使本批次在阅读顺序上保持正向（0,1,2…）
        for (let k = run.length - 1; k >= 0; k--) {
            if (run[k]) prependCardToMasonry(run[k]);
        }
    }
    function markReady(idx, photo) {
        // photo 为 null 表示跳过/失败（无卡片），但仍占位以推进 _nextInsertIdx
        pendingPhotos.set(idx, photo || null);
        flushCards();
    }

    let uiTick = null;
    const startUiTick = () => {
        if (uiTick) return; uiTick = setInterval(() => {
            setProgress(curOverall(), null, null, { stat: buildStat(), remaining: Math.max(0, fileStates.length - done - skipped - failed), done, skipped, failed }, 'upload');
            renderUpRows(activeRows(), 'upload');
        }, 120);
    };
    function curOverall() {
        let prepSum = 0, upSum = 0, upDen = 0;
        for (const s of fileStates) {
            prepSum += s.prepP * s.units;
            const ub = s.uploadBytes || s.size || 1;
            upSum += s.upP * s.units; upDen += s.units;
        }
        const prepP = prepSum / (prepTotal || 1);
        const upP = upDen ? upSum / upDen : 0;
        return Math.min(1, PHASE.PREP * prepP + PHASE.UPLOAD * upP);
    }
    function buildStat() {
        const elapsed = (Date.now() - t0) / 1000 || 0.001;
        const overallPct = curOverall();
        const processedEst = prepTotal * overallPct;
        const speed = processedEst / elapsed;
        const remain = overallPct > 0.02 ? (prepTotal - processedEst) / Math.max(0.0001, speed) : 0;
        const mm = Math.floor(remain / 60), ss = Math.round(remain % 60).toString().padStart(2, '0');
        const parts = [`${formatSize(processedEst)} / ${formatSize(prepTotal)}`];
        if (elapsed > 2) parts.push(`${formatSize(speed)}/s`);
        if (elapsed > 4 && remain > 0 && remain < 3600 * 6) parts.push(`剩 ${mm ? mm + '分' : ''}${ss}秒`);
        return parts.join(' · ');
    }
    const stopUiTick = () => { if (uiTick) { clearInterval(uiTick); uiTick = null; } };

    async function processOne(file, idx) {
        const st = fileStates[idx];
        try {
            if (file.type === 'image/svg+xml') { st.err = 'SVG 暂不支持'; failed++; markReady(idx, null); toast(`${file.name} 不支持 SVG`, 'alert'); return; }
            let blob = file, ext = 'webp', hasAudio = false;
            // 尺寸直接来自压缩/转码阶段的位图元数据（异常缺失时由卡片 onload 的 markDimsDirty 补）
            let dimsW = 0, dimsH = 0;
            const isV = isVideoFile(file), isG = isGifFile(file), isP = isPicFile(file);
            if (isP) {
                st.active = true; st.stepLabel = '压缩';
                const webp = await compressToWebp(file, WEBP_QUALITY);
                if (!webp || !webp.blob) { st.err = '图片 WebP 压缩失败'; failed++; markReady(idx, null); toast(`${file.name} 压缩失败`, 'alert'); return; }
                blob = webp.blob; ext = 'webp'; dimsW = webp.width || 0; dimsH = webp.height || 0;
            } else if (isV || isG) {
                if (!av1Ok) {
                    const msg = (isG ? 'GIF' : '视频') + '需要支持 AV1 WebCodecs 的浏览器（Chrome/Edge/Firefox 等）';
                    st.err = msg; failed++; markReady(idx, null); toast(`${file.name}: 需 AV1 编码支持`, 'alert'); return;
                }
                st.active = true; st.stepLabel = '转码';
                const r = await transcodeToAv1Webm(file, (p) => { st.prepP = Math.max(0, Math.min(1, p || 0)); }, { videoFallback: _transcodeVideoFallback });
                blob = r.blob; ext = 'webm'; hasAudio = !!r.hasAudio; dimsW = r.width || 0; dimsH = r.height || 0;
            }
            st.prepP = 1;
            st.uploadBytes = blob.size || st.size || 1;
            const ab = await blob.arrayBuffer();
            const sha = await sha256Hex(ab);
            st.stepLabel = '查重'; st.upP = 0.02;
            const dup = await window.checkHashExists(sha, apiBase());
            if (dup) {
                skipped++; st.upP = 1; st.active = false;
                markReady(idx, null);
                toast(`${file.name} 已存在，跳过`, 'info');
                return;
            }
            st.stepLabel = '上传';
            const parts = await uploadToBed(blob, 'upload.' + ext, (p) => { st.upP = 0.02 + p * 0.93; }, apiBase());
            st.upP = 0.96; st.stepLabel = '取尺寸';
            const photo = {
                id: genPhotoId(),
                url: '', parts, sha256: sha,
                width: dimsW, height: dimsH, createdAt: Date.now(),
                ext, hasAudio
            };
            photo.url = fileUrl(photo.id);
            // 尺寸已由压缩/转码阶段带回并随写库保存；卡片 onload 的 markDimsDirty 兜底异常路径
            st.upP = 0.98;
            await Store.add(photo);
            st.upP = 1; done++; st.active = false;
            markReady(idx, photo);
            blob = null; // 立即释放字节，降低内存峰值
        } catch (e) {
            console.error('upload failed:', file.name, e);
            st.err = e && e.message ? e.message : String(e);
            failed++; st.active = false;
            markReady(idx, null);
            toast(`${file.name} 上传失败: ${st.err}`, 'alert');
        }
    }

    const enqueue = (file) => {
        const idx = allFiles.length;
        allFiles.push(file);
        // 视频权重远高于图片：上传/转码耗时通常比同 size 图片高 8~30 倍。
        // 用 size * VIDEO_UNIT_FACTOR(8) 起步，加最小 VIDEO_MIN_UNITS 兜底（短视频文件极小时不至于被图压制）。
        // 进度环按"时间预算分配"加权：批量里同时含视频+图片时，视频项应明显占据更大 progress 份额，
        // 否则视频长时间处理而图片早已完成，进度条视觉上"只剩视频"看着像是卡住了。
        const units = estUnits(file);
        fileStates.push({ idx, size: file.size || 0, units, prepP: 0, upP: 0, uploadBytes: file.size || 0, err: null, active: false, stepLabel: '等待' });
        prepTotal += units;
        const heavy = av1Ok && (isVideoFile(file) || isGifFile(file));
        (heavy ? av1Q : picQ).push(async () => {
            try { await processOne(file, idx); }
            finally { finished++; maybeFinish(); }
        });
    };
    // 动态追加：收尾动画期间来的文件先排队，收尾结束后续处理（避免收尾动画与新任务交错）
    runner.append = (more) => {
        if (finishing) { pendingAppend.push(...(more || [])); return; }
        for (const f of more || []) enqueue(f);
    };

    const finishAll = async () => {
        if (finishing) return;
        if (finished < fileStates.length || picQ.busy || av1Q.busy) return;
        finishing = true;
        stopUiTick();
        flushCards(); // 兜底 flush 剩余卡片

        // 阶段 3：最终同步对齐（占总进度最后 5%）
        const finalStart = Date.now();
        const finalDur = 500;
        const finalAnim = setInterval(() => {
            const t = Math.min(1, (Date.now() - finalStart) / finalDur);
            setProgress(PHASE.PREP + PHASE.UPLOAD + t * PHASE.SYNC, null, '同步服务器…', { remaining: Math.max(0, fileStates.length - done - skipped - failed), done, skipped, failed }, 'upload');
            renderUpRows([], 'upload');
        }, 30);
        try {
            updateMasonryStatsOnly();
            if (state.lightboxOpen) {
                const cp = curPhoto();
                if (cp) updateLightboxVotes(cp);
                renderDots();
            }
        } catch (_) { }
        // 让 5% 同步动画完整跑完再清理——原实现 clearInterval 在同步代码中立即执行，
        // setInterval 回调一次都没触发（同步动画/行清空从未生效，靠最终 setProgress(1) 兜底）
        await new Promise(r => setTimeout(r, finalDur + 30));
        clearInterval(finalAnim);
        finishing = false;

        if (pendingAppend.length) {
            // 收尾期间有追加：继续处理，不标记完成
            const re = pendingAppend; pendingAppend = [];
            for (const f of re) enqueue(f);
            maybeFinish();
            return;
        }
        setProgress(1, null, '完成', { stat: `共 ${formatSize(prepTotal)} · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`, done, skipped, failed }, 'upload');
        scheduleProgressFade('upload');
        runner.running = false;
        if (_mainUploadRunner === runner) _mainUploadRunner = null;
    };
    const maybeFinish = () => {
        if (finishing || finished < fileStates.length) return;
        // running 计数在 createTaskQueue 内部递减（task 完成后一层微任务），
        // 若在此同步判 busy 会误判"任务刚完成但 running 未递减"→ 永久卡住。
        // 改为等两队列真正空闲（idle resolve）再复核完成条件。
        Promise.all([picQ.idle(), av1Q.idle()]).then(() => {
            if (finished < fileStates.length || picQ.busy || av1Q.busy) return;
            finishAll();
        });
    };

    // 初始批次
    for (const f of files) enqueue(f);
    startUiTick();
}
