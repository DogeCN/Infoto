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
    g.picMediaType = function (p) { return g.hasAnimatedMedia(p) ? 'video' : 'image'; };

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
            while ((n >= (1 << (7 * length))) && length < 8) length++;
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
                inner.push(_ebml(0xe1, _concat([
                    new Uint8Array(_ebmlFloat(0xb5, sampleRate).slice(1)),
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
            const durationUs = Math.round(this.maxDurationSec * 1e6);
            const clusterParts = [];
            for (const c of this.clusters) {
                const inner = _concat([_ebmlU(0xe7, c.timecode), ...c.blocks]);
                clusterParts.push(_ebml(0x1f43b675, inner));
            }
            const segmentInner = [];
            const infoInner = _concat([
                _ebmlU(0x2ad7b1, 1e6),
                _ebmlFloat(0x4489, this.maxDurationSec),
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
    g.SimpleWebMMuxer = SimpleWebMMuxer;

    /* ---- GIF / 视频 → AV1 WebM（WebCodecs VideoEncoder） ---- */
    const AV1_BITRATE_PER_PIXEL = 0.35;
    const OPUS_BITRATE_PER_CHANNEL = 64000;
    const FPS_CAP = 30;
    g.FPS_CAP = FPS_CAP;

    function _av1Codec(w, h) {
        // AV1 codec string: av01.P.LLL.DD（profile 0/1，level，8-bit）
        let level = '04';
        if (h > 2304) level = '05';
        return `av01.00.${level}M.08`;
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

    async function _decodeAudioOnly(file) {
        const AC = (typeof AudioContext !== 'undefined') ? AudioContext : (typeof OfflineAudioContext !== 'undefined') ? OfflineAudioContext : null;
        if (!AC) return { hasAudio: false, audio: null };
        let audioCtx = null;
        try {
            audioCtx = (AC === AudioContext) ? new AC({ sampleRate: 48000 }) : new AC(1, 1, 48000);
            const ab = await file.arrayBuffer();
            const decoded = await audioCtx.decodeAudioData(ab.slice(0));
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
        const mod = await import('https://cdn.jsdelivr.net/npm/mp4box@0.5.2/+esm');
        _mp4boxMod = mod.MP4Box || (mod.default && (mod.default.MP4Box || mod.default)) || (typeof globalThis !== 'undefined' ? globalThis.MP4Box : null);
        if (!_mp4boxMod) throw new Error('mp4box load fail');
        return _mp4boxMod;
    }

    async function _mp4VideoMeta(file) {
        const MP4Box = await _loadMp4Box();
        const buf = await file.arrayBuffer();
        return await new Promise((resolve, reject) => {
            const mp4 = MP4Box.createFile(buf);
            mp4.onError = (e) => reject(new Error('mp4 parse error: ' + e));
            mp4.onReady = (info) => {
                const track = info.videoTracks && info.videoTracks[0];
                if (!track) return reject(new Error('mp4 无视频轨道'));
                const w = track.video.width, h = track.video.height;
                const fps = track.video.frameRate || 30;
                let description = null;
                const codec = (track.codec || '').toLowerCase();
                if (codec.startsWith('avc') || codec.startsWith('hvc') || codec.startsWith('hev')) {
                    try { description = MP4Box.getTrackSpecificInfo(mp4, track.id); } catch (e) { console.warn('[infoto] mp4 codec info fail', e); }
                }
                resolve({
                    width: w, height: h,
                    durationSec: info.timescale ? info.duration / info.timescale : (track.track_duration / track.timescale),
                    codec: track.codec, description,
                    trackId: track.id, timescale: track.timescale,
                    nbSamples: track.nb_samples || 0,
                    fps: fps || 30,
                });
            };
        });
    }

    async function _decodeEncodeMp4(file, meta, sink, report) {
        const MP4Box = await _loadMp4Box();
        const buf = await file.arrayBuffer();
        const mp4 = MP4Box.createFile(buf);
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
        const cfg = { codec: meta.codec, codedWidth: meta.width, codedHeight: meta.height };
        if (meta.description) cfg.description = meta.description;
        decoder.configure(cfg);

        await new Promise((resolve, reject) => {
            let done = false;
            const finish = () => { if (done) return; done = true; decoder.flush().then(() => resolve()).catch(reject); };
            mp4.onError = (e) => { if (!done) { done = true; reject(new Error('mp4 demux error: ' + e)); } };
            mp4.onSamples = (id, user, samples) => {
                for (const s of samples) {
                    const timestampUs = Math.round((s.cts / meta.timescale) * 1e6);
                    const durationUs = s.duration ? Math.round((s.duration / meta.timescale) * 1e6) : Math.round(avgStep * 1e6);
                    decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: timestampUs, duration: durationUs, data: s.data }));
                    fed++;
                }
                if (meta.nbSamples && fed >= meta.nbSamples) finish();
            };
            mp4.setExtractionOptions(meta.trackId, null, { nbSamples: Infinity });
            mp4.start();
            if (!meta.nbSamples) setTimeout(finish, 200);
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

        const audioInfo = isGif ? { hasAudio: false, audio: null } : await _decodeAudioOnly(file);
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

        function makeEncoder(ew, eh) {
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
                    sink(avgStepSec) {
                        const dUs = Math.max(1, Math.round(avgStepSec * 1e6));
                        return {
                            push(src) {
                                cx.drawImage(src, 0, 0, ew, eh);
                                if (src.close) src.close();
                                const vf = new VideoFrame(cv, { timestamp: Math.round(outTs * 1e6), duration: dUs });
                                enc.encode(vf); vf.close();
                                outTs += avgStepSec;
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
            const { enc, sink } = await makeEncoder(ew, eh);
            muxer.w = ew; muxer.h = eh;
            const avgStepSec = decoded.frames.length > 1 ? decoded.durationSec / (decoded.frames.length - 1) : 1 / 30;
            const s = sink(avgStepSec);
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
                    const ew = (meta.width + 1) & ~1, eh = (meta.height + 1) & ~1;
                    const { enc, sink } = await makeEncoder(ew, eh);
                    muxer.w = ew; muxer.h = eh;
                    const targetFps = Math.min(meta.fps || FPS_CAP, FPS_CAP);
                    const s = sink(1 / targetFps);
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
                    if (meta && meta.decoderConfig && meta.decoderConfig.description && !audioCodecPrivate) {
                        const d = meta.decoderConfig.description;
                        audioCodecPrivate = (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) ? new Uint8Array(d) : null;
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
