/* =========================================================
 * Infoto 共享工具模块（页面脚本 + SharedWorker 双环境通用）
 *  - 页面：<script src="shared.js"></script> → 挂载到 window
 *  - Worker：importScripts('./shared.js') → 挂载到 WorkerGlobalScope
 *  - 不包含任何 DOM 依赖，纯工具函数 + 常量
 * ========================================================= */
(function (g) {
    if (g.__INFOTO_SHARED_LOADED__) return;
    g.__INFOTO_SHARED_LOADED__ = true;

    g.CONFIG = {
        API_BASE: '',
        SINGLE_PART_LIMIT: 600 * 1024,
        CHUNK_SIZE: 1024 * 1024,
        CONCURRENCY: 3,
        MAX_RETRY: 3,
    };

    g.formatSize = function (bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0, v = bytes;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
    };

    // 输入：Uint8Array / ArrayBuffer / String（支持 String 让页面环境直接 hash 字符串用）
    g.sha256Hex = async function (bufOrStr) {
        let buf;
        if (typeof bufOrStr === 'string') {
            buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bufOrStr));
        } else {
            buf = await crypto.subtle.digest('SHA-256', bufOrStr);
        }
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    g.withRetry = async function (fn, retries) {
        let lastErr;
        for (let i = 0; i < retries; i++) {
            try { return await fn(); }
            catch (e) {
                lastErr = e;
                if (i < retries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
            }
        }
        throw lastErr;
    };

    g.runWithConcurrency = async function (tasks, concurrency) {
        const results = new Array(tasks.length);
        let next = 0;
        const workers = [];
        const n = Math.min(concurrency, tasks.length);
        for (let w = 0; w < n; w++) {
            workers.push((async () => {
                while (next < tasks.length) {
                    const i = next++;
                    try { results[i] = await tasks[i](); }
                    catch (e) { results[i] = Promise.reject(e); throw e; }
                }
            })());
        }
        await Promise.all(workers);
        return results;
    };

    // 动态任务队列：运行时可 push 追加任务（上传/下载/删除任务进行中再触发同类操作时，
    // 追加到同一任务而不是新开任务竞争进度环）。任务自身的错误被吞并计数（调用方各自 try/catch）。
    g.createTaskQueue = function (concurrency) {
        const queue = [];
        let running = 0;
        const idleWaiters = [];
        function flushIdle() {
            if (!running && queue.length === 0 && idleWaiters.length) idleWaiters.splice(0).forEach(r => r());
        }
        function pump() {
            while (running < concurrency && queue.length) {
                const task = queue.shift();
                running++;
                (async () => {
                    try { await task(); }
                    catch (e) { console.warn('[task-queue] task error:', e && e.message); }
                    finally { running--; pump(); flushIdle(); }
                })();
            }
        }
        return {
            push(task) { queue.push(task); pump(); },
            get size() { return queue.length; },
            get busy() { return running > 0 || queue.length > 0; },
            idle() {
                if (!running && queue.length === 0) return Promise.resolve();
                return new Promise(r => idleWaiters.push(r));
            },
        };
    };

    // XHR 上传（兼容浏览器主页面 + SharedWorker，都有 XMLHttpRequest）
    g.uploadViaXhr = function (url, fd, headers, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            for (const k in headers) xhr.setRequestHeader(k, headers[k]);
            xhr.timeout = 30000;
            xhr.ontimeout = () => reject(new Error('上传超时（30s）'));
            xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
            xhr.onload = () => { xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status)); };
            xhr.onerror = () => reject(new Error('网络错误'));
            xhr.send(fd);
        });
    };

    g.uploadPartToTcProgressive = async function (blob, name, onProgress, apiBase) {
        return g.withRetry(async () => {
            const ab = await blob.arrayBuffer();
            const sha = await g.sha256Hex(ab);
            const fd = new FormData();
            fd.append('file', blob, name);
            const base = apiBase || g.CONFIG.API_BASE || '';
            const txt = await g.uploadViaXhr(base + '/api/upload-proxy', fd, { 'X-File-Sha256': sha }, onProgress);
            const json = JSON.parse(txt);
            if (!json.data) throw new Error('上传响应缺少 data');
            return json.data;
        }, g.CONFIG.MAX_RETRY);
    };

    // XHR GET 带字节级进度下载（页面主线程 + SharedWorker 共用；无 content-length 时降级为整文件完成）
    g.fetchWithProgress = function (url, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            let knownTotal = 0;
            xhr.onprogress = (e) => {
                if (e.lengthComputable) { knownTotal = e.total; onProgress?.(e.loaded, e.total); }
                else if (knownTotal) onProgress?.(e.loaded, knownTotal);
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (!knownTotal && xhr.response?.size) onProgress?.(xhr.response.size, xhr.response.size);
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
    };

    // 逐张删除 + 进度回调（页面主线程回退 与 SharedWorker DeleteTask 共用，消除两套相同实现）。
    // createDeleteRunner 支持运行中追加 id（删除任务进行中再触发删除 → 合并到同一任务）。
    g.createDeleteRunner = function (apiBase, onUpdate) {
        const q = g.createTaskQueue(g.CONFIG.CONCURRENCY);
        let done = 0, failed = 0;
        const state = { total: 0, finished: 0 };
        const emit = () => {
            const f = state.finished;
            onUpdate({ progress: state.total ? f / state.total : 1, curFile: `${f} / ${state.total} 张`, done, failed, total: state.total, finished: f });
        };
        const delOne = (id) => async () => {
            try {
                const r = await fetch((apiBase || '') + '/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
                if (r.ok) done++; else failed++;
            } catch (e) { console.warn('[infoto] delete fail:', e && e.message); failed++; }
            state.finished++; emit();
        };
        return {
            append(ids) { for (const id of ids || []) { state.total++; q.push(delOne(id)); } emit(); return state.total; },
            done: q.idle().then(() => ({ done, failed, total: state.total })),
        };
    };

    // 批量下载进度汇总器：按字节加权合并「每项下载进度 + zip 打包进度」。
    // 页面主线程 zip 分支 与 SharedWorker DownloadTask 共用，消除两套 recomputeOverall。
    // 支持 append(n) 动态扩项（下载任务进行中再触发下载 → 追加到同一任务）。
    // onUpdate(snapshot) 同步回调；snapshot = {progress, done, failed, total, curFile, step, extraStat}
    g.createDownloadProgress = function (total, onUpdate) {
        const perItemProgress = [];
        const perItemTotal = [];
        const perItemDone = [];
        const perItemFail = [];
        let n = 0;
        const ZIP_WEIGHT = 0.12, FETCH_WEIGHT = 1 - ZIP_WEIGHT;
        let zipProgress = 0;
        let zipStat = null;

        const snapshot = () => {
            let sumCur = 0, sumTot = 0, finishedItems = 0, failed = 0;
            for (let i = 0; i < n; i++) {
                if (perItemFail[i]) { failed++; continue; } // 失败项不占进度分母（否则永远到不了 0.88）
                const t = perItemTotal[i] || 1;             // 大小未知项按 1 字节占位，防首项完成即满进度
                sumCur += perItemProgress[i] || 0;
                sumTot += t;
                if (perItemDone[i]) finishedItems++;
            }
            const fetchPart = sumTot > 0 ? (sumCur / sumTot) * FETCH_WEIGHT : 0;
            return {
                progress: Math.min(1, fetchPart + zipProgress * ZIP_WEIGHT),
                done: finishedItems + failed,
                failed,
                total: n,
                curFile: `${finishedItems + failed} / ${n} 张`,
                step: zipProgress > 0 ? '打包 zip 中' : '下载中…',
                extraStat: zipStat || `下载 ${finishedItems + failed}/${n} 张`,
            };
        };
        const emit = () => onUpdate(snapshot());
        const extend = (count) => {
            for (let i = 0; i < count; i++) { perItemProgress.push(0); perItemTotal.push(0); perItemDone.push(false); perItemFail.push(false); }
            n += count;
            emit();
            return n;
        };
        extend(total);

        return {
            onItemProgress(i, loaded, tot) { perItemProgress[i] = loaded; if (tot > perItemTotal[i]) perItemTotal[i] = tot; emit(); },
            onItemDone(i, size) { perItemProgress[i] = perItemTotal[i] = size || 1; perItemDone[i] = true; emit(); },
            onItemFail(i) { perItemDone[i] = true; perItemFail[i] = true; emit(); },
            // zip 打包阶段：更新权重进度；stat 为 zip 阶段统计文案（成功/跳过/百分比），设置后持续生效。返回最新 snapshot
            setZip(p, stat) {
                zipProgress = p;
                if (stat !== undefined && stat !== null) zipStat = stat;
                emit();
                return snapshot();
            },
            // 动态追加 count 项，返回追加后的总项数（新项索引 = 返回值 - count .. 返回值 - 1）
            append(count) { return extend(count); },
            snapshot,
        };
    };

    g.uploadToBed = async function (blob, name, onProgress, apiBase) {
        onProgress(0.05);
        const parts = [];
        if (blob.size <= g.CONFIG.SINGLE_PART_LIMIT) {
            const link = await g.uploadPartToTcProgressive(blob, name, p => onProgress(0.05 + p * 0.9), apiBase);
            onProgress(1);
            return [link];
        }
        const total = Math.ceil(blob.size / g.CONFIG.CHUNK_SIZE);
        const chunkProgress = new Array(total).fill(0);
        function updateOverall() {
            const avg = chunkProgress.reduce((a, b) => a + b, 0) / total;
            onProgress(0.05 + avg * 0.9);
        }
        const tasks = [];
        for (let i = 0; i < total; i++) {
            const idx = i;
            const chunk = blob.slice(idx * g.CONFIG.CHUNK_SIZE, Math.min((idx + 1) * g.CONFIG.CHUNK_SIZE, blob.size));
            const chunkName = `${name}.part${idx + 1}`;
            tasks.push(async () => {
                const link = await g.uploadPartToTcProgressive(chunk, chunkName, p => {
                    chunkProgress[idx] = p;
                    updateOverall();
                }, apiBase);
                chunkProgress[idx] = 1;
                updateOverall();
                return { idx, link };
            });
        }
        const results = await g.runWithConcurrency(tasks, g.CONFIG.CONCURRENCY);
        results.sort((a, b) => a.idx - b.idx);
        for (const r of results) parts.push(r.link);
        onProgress(1);
        return parts;
    };

    /* =========================================================
       媒体类型判定 & AV1 编码能力探测（页面 + SharedWorker 双环境）
       ========================================================= */
    const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|wmv|ogv|ogg)$/i;
    const GIF_EXT_RE = /\.gif$/i;
    const PIC_EXT_RE = /\.(png|jpe?g|webp|bmp|avif|jxl|heic|heif|tiff?|ico)$/i;
    g.isVideoFile = function (f) { return !!(f && (f.type?.startsWith?.('video/') || VIDEO_EXT_RE.test(f.name || ''))); };
    g.isGifFile = function (f) { return !!(f && (f.type === 'image/gif' || GIF_EXT_RE.test(f.name || ''))); };
    g.isPicFile = function (f) { return !!(f && (f.type?.startsWith?.('image/') || PIC_EXT_RE.test(f.name || ''))) && !g.isGifFile(f); };
    g.isMp4File = function (f) { return /\.(mp4|m4v|mov|3gp|f4v)$/i.test(f.name || ''); };
    g.hasAnimatedMedia = function (p) { const e = String(p && p.ext || '').toLowerCase(); return e === 'webm'; };

    // 照片 id 唯一生成（页面主线程 / SharedWorker / Store.add 三处共用，统一格式防碰撞）
    g.genPhotoId = function () {
        return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    };

    // AV1 编码能力探测（简化版）：仅用 isConfigSupported 按典型分辨率探测。
    // 只在页面主线程调用——SharedWorker 无 WebCodecs（VideoEncoder 不存在），
    // 视频/GIF 上传已统一降级主线程，Worker 不再探测。
    // 640x480 / av01.0.05M.08 为常见软编配置（Chrome/Edge/Firefox 均支持）。
    g._av1Support = null;
    g.supportsAv1WebCodecs = async function () {
        if (g._av1Support !== null) return g._av1Support;
        if (typeof VideoEncoder !== 'function') { g._av1Support = false; return false; }
        try {
            const r = await VideoEncoder.isConfigSupported({ codec: 'av01.0.05M.08', width: 640, height: 480, hardwareAcceleration: 'no-preference' });
            g._av1Support = !!(r && r.supported);
        } catch (e) { console.warn('[infoto] AV1 probe fail', e && e.message); g._av1Support = false; }
        return g._av1Support;
    };

    /* =========================================================
       图片压缩（OffscreenCanvas 优先；老页面环境回退 <canvas>）
       ========================================================= */
    g.WEBP_QUALITY = 0.8;
    g.compressToWebp = async function (file, quality = g.WEBP_QUALITY) {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const w = bmp.width, h = bmp.height;
        let blob = null;
        try {
            if (typeof OffscreenCanvas !== 'undefined') {
                const c = new OffscreenCanvas(w, h);
                const cx = c.getContext('2d');
                cx.drawImage(bmp, 0, 0);
                blob = await c.convertToBlob({ type: 'image/webp', quality });
            } else if (typeof document !== 'undefined') {
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(bmp, 0, 0);
                blob = await new Promise(res => c.toBlob(res, 'image/webp', quality));
            }
        } finally {
            bmp.close();
        }
        // 返回尺寸：压缩时 createImageBitmap 已拿到方向修正后的位图尺寸，
        // 直接带回，避免上传后二次加载图片取尺寸（SharedWorker 无 DOM 更必须）
        return { blob, width: w, height: h };
    };

    /* =========================================================
       轻量 WebM muxer（EBML + SimpleBlock，V_AV1 + A_OPUS 双 track）
       ========================================================= */
    function _vint(n, length = 0) {
        if (n < 0 || !isFinite(n)) throw new Error('bad vint');
        if (!length) {
            length = 1;
            // EBML vint 数据位全 1 保留给 "unknown size"（1 字节 vint 的 0xFF、2 字节的 0x7FFF...），
            // 不能编码为数据值！否则 127/16383/2097151... 字节的 body 会写出 unknown-size 块，
            // 播放器解析 "Unknown-sized element inside parent with finite size" 报错、整个文件损坏。
            // 长度 L 的 vint 最大合法值 = (1 << (7*L)) - 2；n >= (1 << (7*L)) - 1 时必须加长。
            while ((n >= ((1 << (7 * length)) - 1)) && length < 8) length++;
        }
        const b = new Uint8Array(length);
        let v = n;
        for (let i = length - 1; i >= 0; i--) { b[i] = v & 0xff; v >>>= 8; }
        b[0] |= (0x80 >>> (length - 1));
        return b;
    }
    function _concat(arrays) {
        let t = 0; for (const a of arrays) t += a.byteLength || a.length || 0;
        const out = new Uint8Array(t); let o = 0;
        for (const a of arrays) { const u = (a instanceof Uint8Array) ? a : new Uint8Array(a); out.set(u, o); o += u.length; }
        return out;
    }
    function _ebml(id, body) {
        const idBytes = (typeof id === 'number') ? (() => {
            const a = []; let v = id;
            while (v) { a.unshift(v & 0xff); v >>>= 8; }
            // EBML ID 本身即 1-4 字节、首字节自带长度标记（0x1F43B675 等 4 字节 ID 首字节 0x1F 无 bit7 是合法的）。
            // 不能补零到 bit7=1：对 0x1F 开头的 ID 会永远补不够 → 死循环（原实现 bug，视频/GIF 转码合成 WebM 时卡死）。
            return new Uint8Array(a);
        })() : id;
        const bodyLen = (body instanceof Uint8Array) ? body.byteLength : 0;
        return _concat([idBytes, _vint(bodyLen), body]);
    }
    function _ebmlU(id, value, bytes = 0) {
        let b;
        if (!bytes) {
            if (value === 0) bytes = 1;
            else { bytes = 0; let v = value; do { bytes++; v >>>= 8; } while (v); }
        }
        b = new Uint8Array(bytes);
        let v = value;
        for (let i = bytes - 1; i >= 0; i--) { b[i] = v & 0xff; v >>>= 8; }
        return _ebml(id, b);
    }
    function _ebmlFloat(id, value) {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, value, false);
        return _ebml(id, new Uint8Array(dv.buffer));
    }
    function _ebmlStr(id, s) {
        const enc = new TextEncoder();
        return _ebml(id, enc.encode(String(s)));
    }

    class SimpleWebMMuxer {
        constructor({ width, height, timeDen = 1000, videoCodec = 'V_AV1', audio = null }) {
            this.w = width; this.h = height;
            this.tDen = timeDen;
            this.videoCodec = videoCodec;
            this.audio = audio ? { sampleRate: 48000, channels: 2, codecId: 'A_OPUS', codecPrivate: null, ...audio } : null;
            this.clusters = [];
            this._curCluster = null;
            this.maxDurationSec = 0;
        }
        _openCluster(timecode) {
            this._curCluster = { timecode, blocks: [] };
            this.clusters.push(this._curCluster);
        }
        _closeCluster() { this._curCluster = null; }
        _trackNumVint(trackNum) {
            const b = new Uint8Array(1);
            b[0] = (0x80) | (trackNum & 0x7f);
            return b;
        }
        addChunk(data, { timestampSec, trackNum = 1, keyframe = false }) {
            const tc = Math.max(0, Math.round(timestampSec * this.tDen));
            if (!this._curCluster) this._openCluster(tc);
            else if (tc - this._curCluster.timecode > 30000) { this._closeCluster(); this._openCluster(tc); }
            const relTc = tc - this._curCluster.timecode;
            const tcBytes = new Uint8Array(2);
            new DataView(tcBytes.buffer).setInt16(0, Math.max(-32768, Math.min(32767, relTc)), false);
            const flags = (keyframe && trackNum === 1) ? 0x80 : 0x00;
            const body = _concat([this._trackNumVint(trackNum), tcBytes, new Uint8Array([flags]), new Uint8Array(data)]);
            this._curCluster.blocks.push(_ebml(0xa3, body));
            this.maxDurationSec = Math.max(this.maxDurationSec, timestampSec);
        }
        _trackEntry(num, uid, type, codecId, opts = {}) {
            const inner = [_ebmlU(0xd7, num), _ebmlU(0x73c5, uid), _ebmlU(0x83, type), _ebmlStr(0x86, codecId)];
            if (opts.video) {
                const { width, height } = opts.video;
                inner.push(_ebml(0xe0, _concat([_ebmlU(0xb0, width), _ebmlU(0xba, height)])));
            }
            if (opts.audio) {
                const { sampleRate, channels } = opts.audio;
                // 注意：SamplingFrequency(0xB5) 必须带 ID 完整写出。旧实现 _ebmlFloat(0xb5, sr).slice(1)
                // 砍掉 ID 只剩 size+裸 double → Audio 元素内部错乱，播放器/ffprobe 解析越界
                // （"Element at 0xa0 exceeds containing master element"、Duration 误读 0.002s、音轨结构损坏）。
                inner.push(_ebml(0xe1, _concat([
                    _ebmlFloat(0xb5, sampleRate),
                    _ebmlU(0x9f, channels),
                ])));
                if (opts.codecPrivate) inner.push(_ebml(0x63a2, opts.codecPrivate));
            } else if (opts.codecPrivate) {
                inner.push(_ebml(0x63a2, opts.codecPrivate));
            }
            return _ebml(0xae, _concat(inner));
        }
        finalize() {
            if (this._curCluster) this._closeCluster();
            const clusterParts = [];
            for (const c of this.clusters) {
                const inner = _concat([_ebmlU(0xe7, c.timecode), ...c.blocks]);
                clusterParts.push(_ebml(0x1f43b675, inner));
            }
            const segmentInner = [];
            const infoInner = _concat([
                _ebmlU(0x2ad7b1, 1e6),
                // Duration 元素单位 = TimecodeScale 刻度（1e6 ns/刻度），不是秒！
                // 旧实现直接写 maxDurationSec（秒）→ ffprobe 读成 秒*1e6/1e9 = 千分之一，2s 视频变 0.002s。
                _ebmlFloat(0x4489, this.maxDurationSec * this.tDen),
                _ebmlStr(0x4d80, 'Infoto WebCodecs'),
                _ebmlStr(0x5741, 'Infoto WebCodecs'),
            ]);
            segmentInner.push(_ebml(0x1549a966, infoInner));
            const tracks = [
                this._trackEntry(1, 1, 1, this.videoCodec, { video: { width: this.w, height: this.h } })
            ];
            if (this.audio) {
                const cp = this.audio.codecPrivate ? new Uint8Array(this.audio.codecPrivate) : null;
                tracks.push(this._trackEntry(2, 2, 2, this.audio.codecId, {
                    audio: { sampleRate: this.audio.sampleRate, channels: this.audio.channels },
                    codecPrivate: cp
                }));
            }
            segmentInner.push(_ebml(0x1654ae6b, _concat(tracks)));
            for (const cp of clusterParts) segmentInner.push(cp);

            const segment = _ebml(0x18538067, _concat(segmentInner));
            const ebmlHeader = _ebml(0x1a45dfa3, _concat([
                _ebmlU(0x4286, 1), _ebmlU(0x42f7, 1),
                _ebmlU(0x42f2, 4), _ebmlU(0x42f3, 8),
                _ebmlStr(0x4282, 'webm'),
                _ebmlU(0x4287, 4), _ebmlU(0x4285, 2),
            ]));
            return new Blob([_concat([ebmlHeader, segment])], { type: 'video/webm' });
        }
    }
    // 注意：SimpleWebMMuxer 仅为 transcodeToAv1Webm 内部使用，不导出到全局（此前导出无任何消费方）

    /* ---- GIF / 视频 → AV1 WebM（WebCodecs VideoEncoder） ---- */
    const AV1_BITRATE_PER_PIXEL = 0.35;
    const OPUS_BITRATE_PER_CHANNEL = 64000;
    const FPS_CAP = 30;
    g.FPS_CAP = FPS_CAP;

    function _av1Codec(w, h) {
        // AV1 codec string 必须与探测串格式一致：av01.P.LL.M.DD（profile 一位、level 两位、tier、bitdepth）。
        // 旧实现写成 av01.00.xxM.08（profile 两位 "00"）——Chrome/Edge 的 AV1 编码器解析不了，
        // isConfigSupported 恒 false → 视频转码必走 <video> 兜底。
        let level = '05';
        if (h > 1080) level = '06';   // 1080p+ → L6
        if (h > 2160) level = '07';   // 4K+ → L7
        return `av01.0.${level}M.08`;
    }

    async function _decodeGifFrames(file) {
        const { default: GifReader } = await import('https://cdn.jsdelivr.net/npm/omggif@1.0.10/+esm');
        const buf = new Uint8Array(await file.arrayBuffer());
        const reader = new GifReader(buf);
        const w = reader.width, h = reader.height;
        const frames = [];
        let t = 0;
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        // 按 GIF89a disposal 规范合成帧：
        //   - prevShot：上一帧"绘制前"的画布快照（disposal=3 的恢复目标）
        //   - prevDisposal：上一帧的 disposal，决定本帧开始前画布状态
        // 旧实现把 disposal 0/1/2 一律整屏覆盖，透明帧会黑底/错位；disposal 2（恢复背景）完全未处理。
        let prevShot = ctx.createImageData(w, h);
        let prevDisposal = 0;
        for (let i = 0; i < reader.numFrames(); i++) {
            const info = reader.frameInfo(i);
            const delayMs = Math.max(20, (info.delay || 10) * 10);
            const img = ctx.createImageData(w, h);
            reader.decodeAndBlitFrameRGBA(i, img.data);
            // 1) 应用上一帧的 disposal，把画布恢复到本帧的正确基底
            if (i > 0 && prevDisposal === 2) ctx.clearRect(0, 0, w, h);              // 恢复背景（透明）
            else if (i > 0 && prevDisposal === 3) ctx.putImageData(prevShot, 0, 0);  // 恢复上一帧绘制前
            // 2) 记录本帧绘制前内容（若本帧 disposal=3，下一帧需恢复到这里）
            const before = ctx.getImageData(0, 0, w, h);
            // 3) 本帧叠加到基底（帧透明区域透出基底），而非整屏覆盖
            const tmpC = new OffscreenCanvas(w, h);
            tmpC.getContext('2d').putImageData(img, 0, 0);
            ctx.drawImage(tmpC, info.x, info.y, info.width, info.height);
            const bitmap = await createImageBitmap(canvas);
            frames.push({ bitmap, delayMs, ts: t / 1000 });
            t += delayMs;
            prevDisposal = info.disposal;
            prevShot = before;
        }
        return { width: w, height: h, frames, durationSec: t / 1000, hasAudio: false };
    }

    function resamplePCM(buf, dstSr) {
        if (!buf) return null;
        const srcSr = buf.sr;
        if (Math.abs(srcSr - dstSr) < 1) {
            const n = buf.length, ch = buf.channels.length;
            const out = new Float32Array(n * ch);
            for (let s = 0, o = 0; s < n; s++) for (let c = 0; c < ch; c++, o++) out[o] = buf.channels[c][s];
            return { interleaved: out, samples: n, sr: dstSr, channels: ch };
        }
        const ratio = srcSr / dstSr;
        const dstN = Math.max(1, Math.round(buf.length * dstSr / srcSr));
        const ch = buf.channels.length;
        const out = new Float32Array(dstN * ch);
        const src = buf.channels;
        for (let i = 0; i < dstN; i++) {
            const s = i * ratio;
            const s0 = Math.floor(s); const s1 = Math.min(buf.length - 1, s0 + 1);
            const f = s - s0;
            for (let c = 0; c < ch; c++) out[i * ch + c] = src[c][s0] * (1 - f) + src[c][s1] * f;
        }
        return { interleaved: out, samples: dstN, sr: dstSr, channels: ch };
    }

    /* 抽 mp4 内的 AAC：mp4box 解出音频 sample + 给每帧前补 7 字节 ADTS 头 → WebCodecs AudioDecoder 解码。
       比 _decodeAudioOnly 用 AudioContext.decodeAudioData 更可靠：
       - SharedWorker 没有 AudioContext，原来直接 false → worker 转码永远没声音（这就是用户痛点的根因）
       - 即使在主线程，Chrome 对部分 mp4 容器的 decodeAudioData 也会 reject
   ADTS 7 字节格式参见 W3C webcodecs-aac-codec-registration §2/§3：
   比特流不传 description 时按 ADTS 解，sampleRate/numberOfChannels 被忽略（从 ADTS 头读） */
    const _AAC_FREQ_TABLE = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
    function _adtsHeader(profileIdx, sampleRate, channels, frameBytesLen) {
        const fIdx = _AAC_FREQ_TABLE.indexOf(sampleRate);
        if (fIdx < 0 || profileIdx !== 1) return null; // 仅支持 AAC LC（profile=1），其它 profile/采样率回退老路径
        const adts = new Uint8Array(7);
        adts[0] = 0xFF;
        adts[1] = 0xF1; // syncword 高4位 + MPEG4 + layer00 + protection_absent
        adts[2] = (profileIdx << 6) | (fIdx << 2) | (channels >> 2);
        adts[3] = ((channels & 3) << 6) | ((frameBytesLen >> 11) & 3);
        adts[4] = (frameBytesLen >> 3) & 0xFF;
        adts[5] = ((frameBytesLen & 7) << 5) | 0x1F; // buffer_fullness 高5位
        adts[6] = 0xFC; // buffer_fullness 低6位(=0x3F<<2) + raw_blocks_minus_one=0
        return adts;
    }

    async function _decodeAudioMp4(file, videoDurationSec) {
        if (typeof AudioDecoder === 'undefined') return null;
        const { createFile } = await _loadMp4Box();
        const buf = await file.arrayBuffer();
        let track = null, sampleRate = 0, channels = 0, timescale = 0;
        // 先一轮 onReady 拿到 audio track 信息；接着二轮 onSamples 持续 decode
        let decoder = null;
        const chunkChunks = []; // 每通道 float32 片段累积，结束时 concat
        let totalFrames = 0;
        let fedSamples = 0, nbSamples = 0;
        let firstSampleSeen = false;
        let rejected = null;
        let finishedFlag = false;
        // resolve/reject 提升到 Promise 外层供 finishAudio 使用（finishAudio 定义在 executor 外，
        // 直接引用 executor 参数会 ReferenceError）
        let resolveOuter = null, rejectOuter = null;
        const finishAudio = async () => {
            if (finishedFlag || rejected) return;
            finishedFlag = true;
            try { if (decoder) await decoder.flush(); } catch (_) { }
            try { if (decoder) decoder.close(); } catch (_) { }
            if (totalFrames === 0) { resolveOuter && resolveOuter(null); return; }
            const ch = Math.min(channels, chunkChunks.length);
            const merged = [];
            for (let c = 0; c < ch; c++) {
                const parts = chunkChunks[c];
                let len = 0; for (const p of parts) len += p.length;
                const buf2 = new Float32Array(len);
                let o = 0; for (const p of parts) { buf2.set(p, o); o += p.length; }
                merged.push(buf2);
            }
            // 与 _decodeAudioOnly 输出格式对齐（resamplePCM 返回 {interleaved, samples, sr, channels}，opus 编码段依赖）
            resolveOuter && resolveOuter(resamplePCM({ sr: sampleRate, length: totalFrames, channels: merged }, 48000));
        };
        return await new Promise((resolve, reject) => {
            resolveOuter = resolve; rejectOuter = reject;
            const mp4 = createFile();
            mp4.onError = (e) => { if (!rejected) { rejected = true; rejectOuter && rejectOuter(new Error('audio mp4 parse: ' + e)); } };
            mp4.onReady = (info) => {
                const a = info.audioTracks && info.audioTracks[0];
                if (!a) { if (!rejected) { rejected = true; resolveOuter && resolveOuter(null); } return; }
                track = a;
                sampleRate = (a.audio && (a.audio.sample_rate || a.sample_rate)) || 48000;
                channels = Math.min(8, (a.audio && (a.audio.channel_count || a.nb_channels)) || 2);
                timescale = a.timescale || sampleRate;
                nbSamples = a.nb_samples || 0;
                try {
                    decoder = new AudioDecoder({
                        output: (ad) => {
                            // AudioData 没有 getChannelData（AudioBuffer 才有）；用 copyTo 按 plane 抽每声道 PCM
                            // format 强制 'f32-planar'：每个 plane 即一个声道，Float32Array(numberOfFrames) 大小恰好
                            const n = ad.numberOfFrames;
                            const ch = ad.numberOfChannels;
                            for (let c = 0; c < ch; c++) {
                                const plane = new Float32Array(n);
                                try { ad.copyTo(plane, { planeIndex: c, format: 'f32-planar' }); }
                                catch (e) { console.warn('[infoto] AudioData copyTo fail', e); continue; }
                                chunkChunks[c] = chunkChunks[c] || [];
                                chunkChunks[c].push(plane);
                            }
                            totalFrames += n;
                            ad.close();
                        },
                        error: (e) => { if (!rejected) { rejected = true; rejectOuter && rejectOuter(new Error('AudioDecoder error: ' + (e && e.message || e))); } },
                    });
                    decoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels });
                    mp4.setExtractionOptions(track.id, null, { nbSamples: 4096 });
                    mp4.start();
                } catch (e) { if (!rejected) { rejected = true; rejectOuter && rejectOuter(e); } }
            };
            mp4.onSamples = (id, _user, samples) => {
                if (!decoder || decoder.state !== 'configured') return;
                for (const s of samples) {
                    const data = s.data;
                    if (!data || !data.byteLength) continue;
                    const adts = _adtsHeader(1, sampleRate, channels, data.byteLength + 7);
                    if (!adts) continue; // 采样率/格式不支持（仅 AAC LC 走此路径）
                    const wrapped = new Uint8Array(adts.length + data.byteLength);
                    wrapped.set(adts, 0);
                    wrapped.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), adts.length);
                    const ts = Math.round(1e6 * s.cts / (s.timescale || timescale));
                    const dur = s.duration ? Math.round(1e6 * s.duration / (s.timescale || timescale)) : Math.round(1e6 * 1024 / sampleRate);
                    try { decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, duration: dur, data: wrapped })); }
                    catch (e) { console.warn('[infoto] AudioDecoder decode fail', e); }
                    firstSampleSeen = true;
                    fedSamples++;
                }
                if (nbSamples > 0 && fedSamples >= nbSamples) finishAudio();
            };
            try { buf.fileStart = 0; mp4.appendBuffer(buf); mp4.flush(); }
            catch (e) { if (!rejected) { rejected = true; rejectOuter && rejectOuter(e); } }
            // 兜底：nbSamples 未知或文件异常时不能无限等（30s 内若正常会提前 finishAudio）
            setTimeout(() => { if (!finishedFlag && !rejected) finishAudio(); }, 30000);
        });
    }

    /* 音频解码统一入口：MP4 优先 WebCodecs AudioDecoder（Worker/主线程都可用，成功率远高于
       AudioContext.decodeAudioData——后者在 SharedWorker 里根本不存在，且对 mp4 容器部分浏览器会 reject）。
       失败回退 _decodeAudioOnly（AudioContext，仅主线程可用）。 */
    async function _decodeAudioFor(file) {
        if (g.isMp4File(file) && typeof AudioDecoder !== 'undefined') {
            try {
                const r = await _decodeAudioMp4(file);
                // resamplePCM 输出结构：{interleaved, samples, sr, channels(数字)}
                if (r && r.interleaved && r.interleaved.length > 0 && r.samples > 0) {
                    return { hasAudio: true, audio: r };
                }
            } catch (e) { console.warn('[infoto] audio mp4 decode fail, fallback AudioContext', e); }
        }
        return _decodeAudioOnly(file);
    }

    async function _decodeAudioOnly(file) {
        const AC = (typeof AudioContext !== 'undefined') ? AudioContext : (typeof OfflineAudioContext !== 'undefined') ? OfflineAudioContext : null;
        if (!AC) return { hasAudio: false, audio: null };
        let audioCtx = null;
        try {
            audioCtx = (AC === AudioContext) ? new AC({ sampleRate: 48000 }) : new AC(1, 1, 48000);
            // decodeAudioData 对视频容器（非纯音频文件）行为不可靠：部分浏览器可解析 MP4 音轨、
            // 部分直接 reject，极少数场景可能长时间不返回 —— 必须限时，防止视频转码整体挂起。
            const ab = await withTimeout(Promise.resolve(file.arrayBuffer()), 30000);
            const decoded = await withTimeout(audioCtx.decodeAudioData(ab.slice(0)), 20000);
            const hasAudio = decoded.numberOfChannels > 0 && decoded.length > 0;
            let audioResampled = null;
            if (hasAudio) {
                const ch = Math.min(2, decoded.numberOfChannels);
                const stereo = { sr: decoded.sampleRate, length: decoded.length, channels: Array.from({ length: ch }, (_, c) => decoded.getChannelData(c).slice()) };
                audioResampled = resamplePCM(stereo, 48000);
            }
            return { hasAudio: !!audioResampled, audio: audioResampled };
        } catch (err) {
            console.warn('[infoto] audio decode fail', err);
            return { hasAudio: false, audio: null };
        } finally {
            if (audioCtx) try { audioCtx.close(); } catch (e) { console.warn('[infoto] audioCtx close fail', e); }
        }
    }

    let _mp4boxMod = null;
    async function _loadMp4Box() {
        if (_mp4boxMod) return _mp4boxMod;
        // 优先本地 vendor（随站部署，无 CDN 依赖、离线可用）；CDN 仅作兜底。
        // 实测 jsdelivr 高峰期 import 会持续 503（多标签页/新会话首次加载尤其明显），
        // 依赖 CDN 会让 MP4 转码静默降级或直接失败——本地化后根治。
        const CDNS = ['https://cdn.jsdelivr.net/npm/mp4box@0.5.2/+esm', 'https://unpkg.com/mp4box@0.5.2/dist/mp4box.all.min.js'];
        let lastErr = null;
        const tryImport = (spec) => import(spec).then(m => ({
            createFile: m.createFile || (m.default && m.default.createFile),
            ISOFile: m.ISOFile || (m.default && m.default.ISOFile),
            DataStream: m.DataStream || (m.default && m.default.DataStream),
        })).then(mod => {
            if (typeof mod.createFile !== 'function' || typeof mod.ISOFile !== 'function') throw new Error('mp4box export missing');
            return mod;
        });
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // 本地 + CDN 依次尝试；本地文件存在时 import 相对路径（相对本 worker/页面 script）
                let mod = null;
                try { mod = await tryImport('./vendor/mp4box.esm.js'); }
                catch (e) { lastErr = e; }
                if (!mod) {
                    for (const cdn of CDNS) {
                        try { mod = await tryImport(cdn); break; } catch (e) { lastErr = e; }
                    }
                }
                if (mod) { _mp4boxMod = mod; return mod; }
            } catch (e) { lastErr = e; }
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
        throw lastErr || new Error('mp4box load fail');
    }

    /* 从 mp4box tkhd.matrix 提取旋转角度（0/90/180/270）。MP4 把传感器/拍摄方向存在 tkhd matrix
       矩阵 [a,b,u, c,d,v, x,y,w]，顺时针旋转 = atan2(b, a) 弧度；
       track.video.width/height 是物理宽高（不应用 rotation），需要按 rotation 算出显示宽高。
       若 rotation != 0，需要在转码 drawImage 时旋转画布，否则输出 WebM 会按物理宽高播——
       用户看到的是"竖屏被逆时针转 90°、横屏被转 180°"。 */
    function _matrixToRotation(m) {
        if (!m || m.length < 2) return 0;
        // 角度向 0/90/180/270 四舍五入；负角模 360 归正
        let deg = Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI / 90) * 90;
        deg %= 360; if (deg < 0) deg += 360;
        return deg;
    }

    async function _mp4VideoMeta(file) {
        const { createFile, DataStream } = await _loadMp4Box();
        const buf = await file.arrayBuffer();
        return await new Promise((resolve, reject) => {
            const mp4 = createFile(); // keepMdatData 默认 true（保留 mdat 供 sample.data 读取）
            mp4.onError = (e) => reject(new Error('mp4 parse error: ' + e));
            mp4.onReady = (info) => {
                const track = info.videoTracks && info.videoTracks[0];
                if (!track) return reject(new Error('mp4 无视频轨道'));
                const physW = track.video.width, physH = track.video.height;
                const codecRaw = (track.codec || '').toLowerCase();
                let description = null, rotation = 0;
                try {
                    const trak = mp4.getTrackById(track.id);
                    if (trak) {
                        // rotation
                        if (trak.tkhd && trak.tkhd.matrix) {
                            rotation = _matrixToRotation(trak.tkhd.matrix);
                        }
                        // decoder description
                        const entries = trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl && trak.mdia.minf.stbl.stsd ? trak.mdia.minf.stbl.stsd.entries : [];
                        for (const entry of entries) {
                            const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
                            if (box) {
                                const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
                                box.write(stream);
                                description = new Uint8Array(stream.buffer, 8);
                                break;
                            }
                        }
                    }
                } catch (e) { console.warn('[infoto] mp4 trak parse fail', e); }
                // 显示宽高（应用 rotation 后，用于 VideoEncoder 输出尺寸）
                const rotated = (rotation === 90 || rotation === 270);
                const displayW = rotated ? physH : physW;
                const displayH = rotated ? physW : physH;
                const fps = track.video.frameRate || 30;
                resolve({
                    width: displayW, height: displayH,
                    physWidth: physW, physHeight: physH, // 物理宽高（用于 drawImage dst 尺寸对照）
                    rotation, // 0/90/180/270
                    durationSec: info.timescale ? info.duration / info.timescale : (track.track_duration / track.timescale),
                    codec: codecRaw.startsWith('vp08') ? 'vp8' : track.codec, // 浏览器不认 vp08.xx 全串，只认 vp8
                    description,
                    trackId: track.id, timescale: track.timescale,
                    nbSamples: track.nb_samples || 0,
                    fps: fps || 30,
                });
            };
            try {
                buf.fileStart = 0; // mp4box 0.5.2 要求 buffer.fileStart（官方 MP4FileSink 也设置）；缺失会解析错位/抛错
                mp4.appendBuffer(buf); // 数据必须 appendBuffer 喂入（createFile 只建实例）
                mp4.flush();
            } catch (e) { reject(e); }
        });
    }

    async function _decodeEncodeMp4(file, meta, sink, report) {
        const { createFile } = await _loadMp4Box();
        const buf = await file.arrayBuffer();
        const mp4 = createFile();
        const targetFps = Math.min(meta.fps || FPS_CAP, FPS_CAP);
        const avgStep = 1 / targetFps;
        const totalApprox = Math.max(1, Math.round((meta.durationSec || 1) * targetFps));
        let nextOut = 0, outIndex = 0, fed = 0;
        const decoder = new VideoDecoder({
            output: (frame) => {
                const tSec = (frame.timestamp || 0) / 1e6;
                if (tSec + 1e-3 >= nextOut) { sink.push(frame); outIndex++; nextOut += avgStep; }
                else frame.close();
                if ((outIndex & 7) === 0) report(0.01 + 0.49 * Math.min(1, outIndex / totalApprox));
            },
            error: (e) => console.error('[infoto] VideoDecoder error', e),
        });
        // codedWidth/Height 必须是**物理尺寸**（码流里实际编码尺寸）——meta.width/height 已应用 rotation 是显示尺寸，
        // 用它 configure 会让解码器按错误尺寸输出（90/270 旋转视频尺寸错乱）。
        const cfg = { codec: meta.codec, codedWidth: meta.physWidth || meta.width, codedHeight: meta.physHeight || meta.height };
        if (meta.description) cfg.description = meta.description;
        decoder.configure(cfg);

        await new Promise((resolve, reject) => {
            let done = false;
            let guard = null;
            const finish = () => { if (done) return; done = true; clearTimeout(guard); decoder.flush().then(() => resolve()).catch(reject); };
            mp4.onError = (e) => { if (!done) { done = true; clearTimeout(guard); reject(new Error('mp4 demux error: ' + e)); } };
            // 官方时序：onReady 里 setExtractionOptions + start。mp4box 在 appendBuffer 解析时同步触发
            // onReady；若在 appendBuffer 之后再配置提取，onSamples 永远不会被调用（旧实现即如此，恒拿不到样本）。
            mp4.onReady = (info) => {
                const track = info.videoTracks && info.videoTracks[0];
                if (!track) { if (!done) { done = true; clearTimeout(guard); reject(new Error('mp4 无视频轨道')); } return; }
                mp4.setExtractionOptions(track.id, null, { nbSamples: 1000 });
                mp4.start();
            };
            mp4.onSamples = (id, user, samples) => {
                for (const s of samples) {
                    // 官方公式：timestamp/duration 除以 sample.timescale（sample 自带，勿用 track timescale）
                    const timestampUs = Math.round(1e6 * s.cts / s.timescale);
                    const durationUs = s.duration ? Math.round(1e6 * s.duration / s.timescale) : Math.round(avgStep * 1e6);
                    decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: timestampUs, duration: durationUs, data: s.data }));
                    fed++;
                }
                if (meta.nbSamples && fed >= meta.nbSamples) finish();
            };
            try {
                buf.fileStart = 0; // mp4box 0.5.2 要求 buffer.fileStart（官方 MP4FileSink 也设置）；缺失解析错位/抛错
                mp4.appendBuffer(buf);
                mp4.flush();
            } catch (e) { if (!done) { done = true; clearTimeout(guard); reject(e); } }
            // 兜底：样本数未知或不完整文件时不能无限挂起；30s 足够解码完（nbSamples 已知时通常同步期已 finish）
            guard = setTimeout(finish, 30000);
        });
        try { decoder.close(); } catch (e) { console.warn('[infoto] decoder close fail', e); }
    }

    function withTimeout(p, ms) {
        return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('mp4 pipeline timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
    }

    /* 统一入口：GIF / MP4 视频 → AV1 WebM（强制转码，不管体积）
     * opts.videoFallback: (file, {makeEncoder, muxer, report}) => Promise —— 非 MP4 / MP4 解码失败的兜底；
     *   页面环境传 <video> seek 版；SharedWorker 无 DOM 不传（非 MP4 直接抛错，由调用方降级主线程）。 */
    g.transcodeToAv1Webm = async function (file, progressCb, opts = {}) {
        const report = (p, label) => { if (progressCb) progressCb(p, label); };
        const isGif = g.isGifFile(file);

        const audioInfo = isGif ? { hasAudio: false, audio: null } : await _decodeAudioFor(file);
        const srcAudio = audioInfo ? audioInfo.audio : null;
        const hasAudioSrc = !!srcAudio;

        let opusConfig = hasAudioSrc && (typeof AudioEncoder === 'function') ? {
            codec: 'opus', sampleRate: srcAudio.sr, numberOfChannels: srcAudio.channels,
            bitrate: Math.max(32000, srcAudio.channels * OPUS_BITRATE_PER_CHANNEL),
        } : null;
        let opusSupported = false, audioCodecPrivate = null;
        if (opusConfig) try { opusSupported = (await AudioEncoder.isConfigSupported(opusConfig)).supported; } catch (e) { console.warn('[infoto] opus probe fail', e); opusSupported = false; }
        if (!opusSupported) opusConfig = null;

        const muxer = new SimpleWebMMuxer({
            width: 0, height: 0, timeDen: 1000, videoCodec: 'V_AV1',
            audio: opusSupported ? { sampleRate: opusConfig.sampleRate, channels: opusConfig.numberOfChannels, codecId: 'A_OPUS', codecPrivate: audioCodecPrivate } : null,
        });

        // 按 mp4 tkhd rotation 旋转绘制。src（VideoFrame）保持物理宽高 physW×physH；
        // 画布/编码器输出尺寸 = 显示宽高（ew×eh，应用 rotation 后）。
        // drawImage 的目标矩形必须用**物理尺寸**（旋转后坐标系中画满画布）：
        //   rotate(90) 后绘制坐标 (x,y)→画布 (eh-y, x)，dst 宽=physW(横向长边)、高=physH 恰好覆盖 ew×eh
        function _drawRotated(cx, src, ew, eh, rotation, physW, physH) {
            const dw = physW || ew, dh = physH || eh;
            if (!rotation) { cx.drawImage(src, 0, 0, ew, eh); return; }
            cx.save();
            if (rotation === 90) {
                // 顺时针 90°：原点移到画布右上角 (ew, 0)。注意用 **显示宽 ew** 不是 eh！
                // 用 eh 会把原点推出画布（240x320 画布 translate(320,0) 超出 80px）→ 内容错位/裁剪
                cx.translate(ew, 0); cx.rotate(Math.PI / 2);
                cx.drawImage(src, 0, 0, dw, dh);
            } else if (rotation === 180) {
                cx.translate(ew, eh); cx.rotate(Math.PI);
                cx.drawImage(src, 0, 0, dw, dh);
            } else if (rotation === 270) {
                // 逆时针 90°：原点移到画布左下角 (0, eh)。用 **显示高 eh** 不是 ew！
                cx.translate(0, eh); cx.rotate(-Math.PI / 2);
                cx.drawImage(src, 0, 0, dw, dh);
            }
            cx.restore();
        }

        function makeEncoder(ew, eh, rotation, physW, physH) {
            const codec = _av1Codec(ew, eh);
            return VideoEncoder.isConfigSupported({ codec, width: ew, height: eh }).then(support => {
                if (!support.supported) throw new Error('AV1 not supported: ' + codec);
                const cv = new OffscreenCanvas(ew, eh);
                const cx = cv.getContext('2d');
                let outTs = 0;
                const enc = new VideoEncoder({
                    output: (chunk) => {
                        const buf = new Uint8Array(chunk.byteLength); chunk.copyTo(buf);
                        muxer.addChunk(buf, { timestampSec: chunk.timestamp / 1e6, trackNum: 1, keyframe: chunk.type === 'key' });
                    },
                    error: e => console.error(e),
                });
                enc.configure({ codec, width: ew, height: eh, bitrate: Math.max(250_000, ew * eh * AV1_BITRATE_PER_PIXEL), latencyMode: 'quality' });
                return {
                    enc,
                    sink(avgStepSec, totalFrames) {
                        const dUs = Math.max(1, Math.round(avgStepSec * 1e6));
                        let frameIdx = 0;
                        return {
                            push(src) {
                                cx.clearRect(0, 0, ew, eh);
                                _drawRotated(cx, src, ew, eh, rotation || 0, physW, physH);
                                if (src.close) src.close();
                                const vf = new VideoFrame(cv, { timestamp: Math.round(outTs * 1e6), duration: dUs });
                                enc.encode(vf); vf.close();
                                outTs += avgStepSec;
                                frameIdx++;
                                // 按帧进度（让 task.js 按帧而非按份数算时间预算）
                                if (totalFrames && (frameIdx % 4 === 0 || frameIdx === totalFrames)) {
                                    report(0.01 + 0.49 * Math.min(1, frameIdx / totalFrames));
                                }
                            }
                        };
                    }
                };
            });
        }

        if (isGif) {
            const decoded = await _decodeGifFrames(file);
            if (!decoded.frames.length) throw new Error('no frames decoded');
            const ew = (decoded.width + 1) & ~1, eh = (decoded.height + 1) & ~1;
            const { enc, sink } = await makeEncoder(ew, eh, 0);
            muxer.w = ew; muxer.h = eh;
            const avgStepSec = decoded.frames.length > 1 ? decoded.durationSec / (decoded.frames.length - 1) : 1 / 30;
            const s = sink(avgStepSec, decoded.frames.length);
            for (let i = 0; i < decoded.frames.length; i++) {
                s.push(decoded.frames[i].bitmap);
                if ((i & 3) === 0) report(0.01 + 0.49 * Math.min(1, (i + 1) / decoded.frames.length));
            }
            await enc.flush(); enc.close();
        } else {
            let meta = null;
            if (g.isMp4File(file)) {
                try { meta = await _mp4VideoMeta(file); } catch (e) { console.warn('[infoto] mp4 open fail', e); meta = null; }
            }
            if (meta) {
                try {
                    // meta.width/height 已应用 rotation（显示宽高）；rotation 传进 makeEncoder 决定 drawImage 是否旋转画布
                    const ew = (meta.width + 1) & ~1, eh = (meta.height + 1) & ~1;
                    const totalFrames = meta.nbSamples || Math.max(1, Math.round((meta.durationSec || 1) * Math.min(meta.fps || FPS_CAP, FPS_CAP)));
                    // 必须传 physW/physH：_drawRotated 的 drawImage 目标矩形要用**物理尺寸**（旋转坐标变换后画满显示画布），
                    // 不传会退回显示尺寸 → 90/270 旋转时画不满/错位（v90 尺寸 pass 是假阳性，像素级对比才暴露）
                    const { enc, sink } = await makeEncoder(ew, eh, meta.rotation || 0, meta.physWidth, meta.physHeight);
                    muxer.w = ew; muxer.h = eh;
                    const targetFps = Math.min(meta.fps || FPS_CAP, FPS_CAP);
                    const s = sink(1 / targetFps, totalFrames);
                    await withTimeout(_decodeEncodeMp4(file, meta, s, report), 180000);
                    await enc.flush(); enc.close();
                } catch (e) {
                    console.warn('[infoto] mp4 pipeline fail' + (opts.videoFallback ? ', fallback <video>' : ''), e);
                    meta = null;
                }
            }
            if (!meta) {
                if (!opts.videoFallback) throw new Error('视频容器不支持：后台转码仅支持 MP4（其它容器请在支持的环境中上传）');
                await opts.videoFallback(file, { makeEncoder, muxer, report });
            }
        }

        report(0.52, opusSupported ? '音频 Opus 编码中…' : '合成 WebM…');
        if (opusSupported && srcAudio) {
            const frameSamples = 960;
            const enc2 = new AudioEncoder({
                output: (chunk, meta) => {
                    const buf = new Uint8Array(chunk.byteLength); chunk.copyTo(buf);
                    // Opus 的 CodecPrivate（OpusHead）必须在 finalize 前写进 muxer，否则 WebM 音轨无法解码（没声音）。
                    // muxer 构造时 codecPrivate 还是 null（那时还没编码），必须在这里回写 muxer.audio.codecPrivate。
                    if (meta && meta.decoderConfig && meta.decoderConfig.description) {
                        const d = meta.decoderConfig.description;
                        const cp = (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) ? new Uint8Array(d) : null;
                        if (cp && cp.byteLength) {
                            audioCodecPrivate = cp;
                            if (muxer.audio) muxer.audio.codecPrivate = cp;
                        }
                    }
                    muxer.addChunk(buf, { timestampSec: chunk.timestamp / 1e6, trackNum: 2 });
                },
                error: e => console.error(e),
            });
            enc2.configure(opusConfig);
            const il = srcAudio.interleaved;
            const totalFrames = Math.ceil(srcAudio.samples / frameSamples);
            for (let fi = 0; fi < totalFrames; fi++) {
                const s0 = fi * frameSamples;
                const n = Math.min(frameSamples, srcAudio.samples - s0);
                const data = new Float32Array(frameSamples * srcAudio.channels);
                for (let c = 0, co = 0; c < srcAudio.channels; c++, co += frameSamples) {
                    for (let smp = 0; smp < n; smp++) data[co + smp] = il[(s0 + smp) * srcAudio.channels + c];
                }
                const ad = new AudioData({
                    format: 'f32-planar', sampleRate: srcAudio.sr, numberOfFrames: frameSamples,
                    numberOfChannels: srcAudio.channels, timestamp: Math.round((s0 / srcAudio.sr) * 1e6),
                    data,
                });
                enc2.encode(ad);
                ad.close();
                if ((fi & 31) === 0) report(0.52 + 0.48 * Math.min(1, (fi + 1) / totalFrames));
            }
            await enc2.flush();
            enc2.close();
        }
        report(1, '完成');
        const blob = muxer.finalize();
        // 尺寸取编码后的 muxer 尺寸（GIF/MP4/fallback 三分支都设置过 muxer.w/h）
        return { blob, ext: 'webm', hasAudio: opusSupported && !!srcAudio, width: muxer.w, height: muxer.h };
    };

    /* 查重（页面 + Worker 通用） */
    g.checkHashExists = async function (sha, apiBase) {
        try {
            const r = await fetch((apiBase || '') + '/api/photos/hash/' + sha, { cache: 'no-store' });
            if (r.ok) {
                const j = await r.json();
                if (j && j.exists) return j.photo || true;
            }
        } catch (e) { }
        return false;
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self));
