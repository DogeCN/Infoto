/* =========================================================
   图标库（内联 SVG，lucide 风格路径，无外部依赖）
   ========================================================= */
const ICONS = {
    'aperture': '<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>',
    'upload-cloud': '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/>',
    'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'clock-desc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'clock-asc': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'more': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'external': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    'check': '<polyline points="20 6 9 17 4 12"/>',
    'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    'alert': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'success': '<circle cx="12" cy="12" r="10"/><polyline points="20 6 9 17 4 12"/>',
};

function renderIcons(root) {
    (root || document).querySelectorAll('[data-i]').forEach(el => {
        const name = el.getAttribute('data-i');
        if (ICONS[name]) {
            el.setAttribute('viewBox', '0 0 24 24');
            el.setAttribute('fill', 'none');
            el.setAttribute('stroke', 'currentColor');
            el.setAttribute('stroke-width', '2');
            el.setAttribute('stroke-linecap', 'round');
            el.setAttribute('stroke-linejoin', 'round');
            el.innerHTML = ICONS[name];
        }
    });
}

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };

/* =========================================================
   TaskWorker 适配层：跨页面保持上传/下载/删除推进
   - 支持 SharedWorker 的浏览器：任务在 Worker 中执行，页面切换不中断
   - 不支持的浏览器：降级为页面内执行（原有逻辑）
   ========================================================= */
const TaskWorker = (() => {
    let sw = null;
    let supported = typeof SharedWorker !== 'undefined';
    let listeners = new Set();
    let currentTasks = { upload: null, download: null, delete: null };
    let reconnectTimer = null;
    let bc = null;
    let _bcInstalled = false;

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
                if (msg.type === 'task-clear') {
                    currentTasks[msg.taskType] = null;
                }
                if (msg.type === 'status' && msg.tasks) {
                    currentTasks = { ...currentTasks, ...msg.tasks };
                }
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
                if (msg.type === 'task-clear') {
                    currentTasks[msg.taskType] = null;
                }
                if (msg.type === 'status' && msg.tasks) {
                    currentTasks = { ...currentTasks, ...msg.tasks };
                }
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

    function startDownload(list, apiBase) {
        if (!connect()) return false;
        try {
            sw.port.postMessage({ type: 'start-download', list, apiBase });
            return true;
        } catch (e) { return false; }
    }

    try {
        connect();
        window.addEventListener('beforeunload', () => {
            try { if (sw) sw.port.postMessage({ type: 'disconnect' }); } catch (_) { }
        }, { once: true });
    } catch (e) { console.warn('[TaskWorker] init connect fail:', e && e.message); }

    return { connect, isSupported, onMessage, getTask, hasAnyTask, startDelete, startDownload };
})();

/* =========================================================
   WebCodecs VP9 支持探测 & 文件类型白名单
   ========================================================= */
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|wmv|ogv|ogg)$/i;
const GIF_EXT_RE = /\.gif$/i;
const PIC_EXT_RE = /\.(png|jpe?g|webp|bmp|avif|jxl|heic|heif|tiff?|ico)$/i;
function isVideoFile(f) { return !!(f && (f.type?.startsWith?.('video/') || VIDEO_EXT_RE.test(f.name || ''))); }
function isGifFile(f) { return !!(f && (f.type === 'image/gif' || GIF_EXT_RE.test(f.name || ''))); }
function isPicFile(f) { return !!(f && (f.type?.startsWith?.('image/') || PIC_EXT_RE.test(f.name || ''))) && !isGifFile(f); }
function hasAnimatedMedia(p) { const e = String(p && p.ext || '').toLowerCase(); return e === 'webm'; }
function picMediaType(p) { return hasAnimatedMedia(p) ? 'video' : 'image'; }

let _vp9Support = null;
async function supportsVp9WebCodecs() {
    if (_vp9Support !== null) return _vp9Support;
    if (typeof VideoEncoder !== 'function') { _vp9Support = false; return false; }
    try {
        const cfg = { codec: 'vp09.00.10.08', width: 64, height: 64, hardwareAcceleration: 'no-preference' };
        const r = await VideoEncoder.isConfigSupported(cfg);
        _vp9Support = !!(r && r.supported);
    } catch (e) { console.warn('[infoto] VP9 support probe fail', e); _vp9Support = false; }
    return _vp9Support;
}
function applyFileInputAccept() {
    const inp = $('#fileInput');
    if (!inp) return;
    if (_vp9Support === true) inp.setAttribute('accept', 'image/*,video/*,.gif');
    else if (_vp9Support === false) inp.setAttribute('accept', 'image/png,image/jpeg,image/webp');
}
$('#fileInput')?.setAttribute('accept', 'image/*,video/*,.gif');
supportsVp9WebCodecs().then(applyFileInputAccept);

/* ---- 客户端有损压缩为 WebP ---- */
const WEBP_QUALITY = 0.8;

async function compressToWebp(file, quality = WEBP_QUALITY) {
    try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', quality));
        return blob;
    } catch (e) {
        console.warn('[infoto] WebP 压缩失败，使用原文件', e);
        return null;
    }
}

/* =========================================================
   轻量 WebM muxer：EBML + SimpleBlock
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
        while (!a.length || !(a[0] & 0x80)) a.unshift(0);
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
    constructor({ width, height, timeDen = 1000, videoCodec = 'V_VP9', audio = null }) {
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
            const srBytes = new Uint8Array(8);
            new DataView(srBytes.buffer).setFloat64(0, sampleRate, false);
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

/* ---- GIF / 视频 → VP9 WebM ---- */
const VP9_BITRATE_PER_PIXEL = 0.35;
const OPUS_BITRATE_PER_CHANNEL = 64000;
function _vp9Codec(w, h) {
    let level = '10';
    if (h > 2160) level = '51';
    else if (h > 1440) level = '50';
    else if (h > 1080) level = '40';
    else if (h > 720) level = '31';
    else if (h > 576) level = '30';
    else if (h > 288) level = '20';
    return `vp09.00.${level}.08`;
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
    let prev = ctx.createImageData(w, h);
    for (let i = 0; i < reader.numFrames(); i++) {
        const info = reader.frameInfo(i);
        const delayMs = Math.max(20, (info.delay || 10) * 10);
        const img = ctx.createImageData(w, h);
        reader.decodeAndBlitFrameRGBA(i, img.data);
        if (info.disposal === 3 && prev) {
            ctx.putImageData(prev, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            const tmpC = new OffscreenCanvas(w, h);
            const tmpX = tmpC.getContext('2d');
            tmpX.putImageData(img, 0, 0);
            ctx.drawImage(tmpC, info.x, info.y, info.width, info.height);
        } else {
            ctx.putImageData(img, 0, 0);
        }
        if (info.disposal !== 3) prev = ctx.getImageData(0, 0, w, h);
        const bitmap = await createImageBitmap(canvas);
        frames.push({ bitmap, delayMs, ts: t / 1000 });
        t += delayMs;
    }
    return { width: w, height: h, frames, durationSec: t / 1000, hasAudio: false };
}

const FPS_CAP = 30;

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
    if (typeof AudioContext === 'undefined') return { hasAudio: false, audio: null };
    let audioCtx = null;
    try {
        audioCtx = new AudioContext({ sampleRate: 48000 });
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

function _isMp4(file) { return /\.(mp4|m4v|mov|3gp|f4v)$/i.test(file.name || ''); }

let _mp4boxMod = null;
async function _loadMp4Box() {
    if (_mp4boxMod) return _mp4boxMod;
    const mod = await import('https://cdn.jsdelivr.net/npm/mp4box@0.5.2/+esm');
    _mp4boxMod = mod.MP4Box || (mod.default && (mod.default.MP4Box || mod.default)) || (typeof window !== 'undefined' ? window.MP4Box : null);
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
        await seekTo(i / targetFps);
        await new Promise(r => requestAnimationFrame(r));
        const bmp = await createImageBitmap(v);
        sink.push(bmp);
        if ((i & 3) === 0) report(0.01 + 0.49 * Math.min(1, (i + 1) / nOut));
    }
    v.pause();
    try { v.currentTime = 0; } catch (e) { console.warn('[infoto] video reset fail', e); }
    URL.revokeObjectURL(url);
}

function withTimeout(p, ms) {
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('mp4 pipeline timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}

async function transcodeToVp9Webm(file, progressCb) {
    const report = (p, label) => { if (progressCb) progressCb(p, label); };
    const isGif = isGifFile(file);

    const audioInfo = isGif ? { hasAudio: false, audio: null } : await _decodeAudioOnly(file);
    const srcAudio = audioInfo ? audioInfo.audio : null;
    const hasAudioSrc = !!srcAudio;

    const opusConfig = hasAudioSrc && (typeof AudioEncoder === 'function') ? {
        codec: 'opus', sampleRate: srcAudio.sr, numberOfChannels: srcAudio.channels,
        bitrate: Math.max(32000, srcAudio.channels * OPUS_BITRATE_PER_CHANNEL),
    } : null;
    let opusSupported = false, audioCodecPrivate = null;
    if (opusConfig) try { opusSupported = (await AudioEncoder.isConfigSupported(opusConfig)).supported; } catch (e) { console.warn('[infoto] opus probe fail', e); opusSupported = false; }
    if (!opusSupported) opusConfig = null;

    const muxer = new SimpleWebMMuxer({
        width: 0, height: 0, timeDen: 1000, videoCodec: 'V_VP9',
        audio: opusSupported ? { sampleRate: opusConfig.sampleRate, channels: opusConfig.numberOfChannels, codecId: 'A_OPUS', codecPrivate: audioCodecPrivate } : null,
    });

    function makeEncoder(ew, eh) {
        const codec = _vp9Codec(ew, eh);
        return VideoEncoder.isConfigSupported({ codec, width: ew, height: eh }).then(support => {
            if (!support.supported) throw new Error('VP9 not supported: ' + codec);
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
            enc.configure({ codec, width: ew, height: eh, bitrate: Math.max(250_000, ew * eh * VP9_BITRATE_PER_PIXEL), latencyMode: 'quality' });
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
        if (_isMp4(file)) {
            try { meta = await _mp4VideoMeta(file); } catch (e) { console.warn('[infoto] mp4 open fail, fallback <video>', e); meta = null; }
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
            } catch (e) { console.warn('[infoto] mp4 pipeline fail, fallback <video>', e); meta = null; }
        }
        if (!meta) {
            const vmeta = await _videoMetaViaVideoEl(file);
            const ew = (vmeta.width + 1) & ~1, eh = (vmeta.height + 1) & ~1;
            const { enc, sink } = await makeEncoder(ew, eh);
            muxer.w = ew; muxer.h = eh;
            const targetFps = Math.min(vmeta.fps || FPS_CAP, FPS_CAP);
            const s = sink(1 / targetFps);
            await _decodeEncodeVideoElSeek(file, vmeta, s, report);
            await enc.flush(); enc.close();
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
    return { blob, ext: 'webm', hasAudio: opusSupported && !!srcAudio };
}

function _safeForWebp(file) { return isPicFile(file); }

function apiBase() { return CONFIG.API_BASE || ''; }

function fileUrl(id) {
    const base = apiBase() || location.origin;
    return base + '/api/file/' + id;
}

function dlName(p) {
    return p.id + '.' + String(p.ext).toLowerCase();
}
function extFromNameFn(name) {
    const i = String(name).lastIndexOf('.');
    return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

/* =========================================================
   数据层：Cloudflare Worker 同源 API
   ========================================================= */
const Store = {
    photos: [],
    _loaded: false,
    myVotes: Object.create(null),

    // 批量尺寸回写：防抖 + 聚合 PATCH（一次 HTTP 请求代替 N 次单独 POST 回写尺寸）
    _pendingDims: Object.create(null), // id -> {width, height}
    _dimsTimer: null,
    _dimFlushRunning: false,

    _hydrate(p) {
        if (!p) return p;
        if (!p.url) p.url = fileUrl(p.id);
        if (typeof p.hasAudio !== 'boolean') p.hasAudio = false;
        return p;
    },

    async load(force = false) {
        if (this._loaded && !force) return this.photos;
        this._loaded = true;
        if (force && this._loadPromise) return this._loadPromise;
        const doFetch = async () => {
            try {
                const r = await fetch(apiBase() + '/api/photos', { cache: 'no-store' });
                if (r.ok) {
                    const fresh = await r.json();
                    this.photos = fresh
                        .map(p => this._hydrate({ ...p, likes: p.likes ?? 0, dislikes: p.dislikes ?? 0 }));
                    return this.photos;
                }
            } catch (e) { console.warn('[infoto] 加载失败', e); }
            return this.photos;
        };
        this._loadPromise = doFetch().finally(() => { this._loadPromise = null; });
        return this._loadPromise;
    },

    getMyVote(id) { return this.myVotes[id] || 0; },

    // 标记一张照片的尺寸已拿到 → 推入待批队列
    markDimsDirty(photo, w, h) {
        if (!photo || !photo.id) return;
        if (!w || !h) return;
        if (photo.width === w && photo.height === h) return;
        photo.width = w;
        photo.height = h;
        this._pendingDims[photo.id] = { id: photo.id, width: w, height: h };
        this._scheduleDimsFlush();
    },

    _scheduleDimsFlush() {
        if (this._dimsTimer) return;
        this._dimsTimer = setTimeout(() => this._flushDims(), 500);
    },

    async _flushDims() {
        this._dimsTimer = null;
        if (this._dimFlushRunning) { this._scheduleDimsFlush(); return; }
        const pending = this._pendingDims;
        const ids = Object.keys(pending);
        if (ids.length === 0) return;
        this._pendingDims = Object.create(null);
        this._dimFlushRunning = true;
        const updates = ids.map(id => pending[id]);
        try {
            const r = await fetch(apiBase() + '/api/photos/dims', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
            if (!r.ok) console.warn('[infoto] dims batch patch non-2xx:', r.status);
        } catch (e) {
            console.warn('[infoto] dims flush fail:', e && e.message);
        } finally {
            this._dimFlushRunning = false;
            // flush 过程中可能又有新的 pending 进来
            if (Object.keys(this._pendingDims).length > 0) this._scheduleDimsFlush();
        }
    },

    async save(photo) {
        const { url, ...payload } = photo;
        void url;
        await fetch(apiBase() + '/api/photos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
    },

    async add(photo) {
        photo.id = photo.id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        if (!photo.url) photo.url = fileUrl(photo.id);
        this.photos.unshift(photo);
        await this.save(photo);
        return photo;
    },

    setLike(id, delta) {
        const p = this.photos.find(x => x.id === id);
        if (!p) return Promise.resolve({ ok: false, already: false, delta: 0 });
        const prevLikes = p.likes || 0;
        const prevDislikes = p.dislikes || 0;
        const prevMy = this.myVotes[id] || 0;
        if (prevMy !== delta) {
            if (prevMy === 1) p.likes = Math.max(0, prevLikes - 1);
            else if (prevMy === -1) p.dislikes = Math.max(0, prevDislikes - 1);
            if (delta === 1) p.likes = (p.likes || 0) + 1;
            else if (delta === -1) p.dislikes = (p.dislikes || 0) + 1;
            this.myVotes[id] = delta;
        }
        const rollback = () => {
            if (!p) return;
            p.likes = prevLikes; p.dislikes = prevDislikes;
            if (prevMy) this.myVotes[id] = prevMy; else delete this.myVotes[id];
        };
        return (async () => {
            try {
                const r = await fetch(apiBase() + '/api/vote', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, delta })
                });
                if (!r.ok) throw new Error('http ' + r.status);
                const j = await r.json();
                if (j.ok) {
                    if (p) { p.likes = j.likes; p.dislikes = j.dislikes; }
                    this.myVotes[id] = delta;
                    return { ok: true, already: false, delta };
                }
                if (j.already) {
                    const serverDelta = typeof j.delta === 'number' ? j.delta : delta;
                    if (p) {
                        p.likes = prevLikes;
                        p.dislikes = prevDislikes;
                        if (serverDelta === 1 && prevMy !== 1) p.likes++;
                        if (serverDelta === -1 && prevMy !== -1) p.dislikes++;
                    }
                    this.myVotes[id] = serverDelta;
                    return { ok: false, already: true, delta: serverDelta };
                }
                rollback();
                return { ok: false, already: false, delta: 0 };
            } catch (e) {
                console.warn('[infoto] 投票接口失败', e);
                rollback();
                return { ok: false, already: false, delta: 0 };
            }
        })();
    }
};

/* =========================================================
   UI 状态
   ========================================================= */
const state = {
    sortBy: 'latest', latestDir: 'desc', hotestDir: 'desc',
    multiMode: false, selected: new Set(),
    longPressTimer: null, longPressTriggered: false,
    lightboxOpen: false, currentIndex: 0,
    boxSelecting: false, boxStart: null, boxArm: false, suppressClick: false,
    menuOpen: false,
    isAdmin: false,
    dragging: false, dragStart: null, dragCurrent: null,
    batchSize: 60, loadedCount: 60,
    zoom: { s: 1, x: 0, y: 0 },
    panning: false,
    _lastTap: null
};

function toast(msg, icon = 'info') {
    if (!ICONS[icon]) icon = 'info';
    const t = el('div', 'toast', `<svg class="icon" data-i="${icon}"></svg><span></span>`);
    renderIcons(t);
    t.querySelector('span').textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---- 排序 ---- */
function getSorted() {
    const arr = [...Store.photos];
    if (state.sortBy === 'latest') {
        arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (state.latestDir === 'desc') arr.reverse();
    } else {
        const score = p => (p.likes || 0) - (p.dislikes || 0);
        arr.sort((a, b) => score(a) - score(b));
        if (state.hotestDir === 'desc') arr.reverse();
    }
    return arr;
}
function updateSortUI() {
    const latestActive = state.sortBy === 'latest';
    $('#sortLatest').classList.toggle('active', latestActive);
    $('#sortHotest').classList.toggle('active', !latestActive);
    $('#latestText').textContent = latestActive ? (state.latestDir === 'desc' ? '最新' : '最旧') : '最新';
    $('#hotestText').textContent = !latestActive ? (state.hotestDir === 'desc' ? '最热' : '最冷') : '最热';
    const ic = latestActive ? (state.latestDir === 'desc' ? 'clock-desc' : 'clock-asc') : 'flame';
    $('#sortLatest').querySelector('.icon').setAttribute('data-i', ic);
    renderIcons();
}
function safeResortAndKeepCurrent() {
    const oldSorted = getSorted();
    const curId = state.lightboxOpen && oldSorted[state.currentIndex] ? oldSorted[state.currentIndex].id : null;
    updateSortUI();
    if (state.lightboxOpen && curId) {
        const newIdx = getSorted().findIndex(p => p.id === curId);
        state.currentIndex = newIdx >= 0 ? newIdx : 0;
        updateLightbox();
    }
    renderMasonry();
}
$('#sortLatest').addEventListener('click', () => {
    if (state.sortBy === 'latest') state.latestDir = state.latestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'latest';
    safeResortAndKeepCurrent();
});
$('#sortHotest').addEventListener('click', () => {
    if (state.sortBy === 'hotest') state.hotestDir = state.hotestDir === 'desc' ? 'asc' : 'desc';
    else state.sortBy = 'hotest';
    safeResortAndKeepCurrent();
});

/* =========================================================
   瀑布流
   ========================================================= */
function colCount() {
    const w = window.innerWidth;
    if (w >= 1536) return 6; if (w >= 1280) return 5; if (w >= 1024) return 4; if (w >= 768) return 3; return 2;
}
let cols = [];
let renderedCount = 0;

function buildColumns() {
    const m = $('#masonry');
    m.innerHTML = '';
    cols = [];
    const need = Math.max(1, colCount());
    for (let i = 0; i < need; i++) {
        const c = el('div', 'masonry-col');
        m.appendChild(c); cols.push(c);
    }
}

function _shortestCol() {
    if (!cols || cols.length === 0) buildColumns();
    let best = cols[0], bestH = best.getBoundingClientRect().height || best.scrollHeight || 0;
    for (let i = 1; i < cols.length; i++) {
        const ch = cols[i].getBoundingClientRect().height || cols[i].scrollHeight || 0;
        if (ch < bestH) { best = cols[i]; bestH = ch; }
    }
    return best;
}

/* ---------- 音量按钮 ---------- */
function volumeSVG() {
    return `<svg class="icon" data-i="volume-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
}
function muteSVG() {
    return `<svg class="icon" data-i="volume-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
}
function makeVolumeBtn({ initiallyMuted = true } = {}) {
    const b = el('button', 'audio-toggle' + (initiallyMuted ? ' is-muted' : ''), volumeSVG() + muteSVG());
    b.type = 'button';
    b.title = initiallyMuted ? '点按取消静音' : '点按静音';
    b.style.pointerEvents = 'auto';
    b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const v = b.parentElement && b.parentElement.querySelector('video.ph-img,video.lb-img');
        if (!v) return;
        const nowMuted = v.muted ? false : true;
        v.muted = nowMuted;
        if (!nowMuted) { try { v.play().catch(e => console.warn('[infoto] volume play fail', e)); } catch (e) { console.warn('[infoto] volume play fail', e); } }
        b.classList.toggle('is-muted', nowMuted);
        b.title = nowMuted ? '点按取消静音' : '点按静音';
    });
    return b;
}

/* ---- 投票 badges 公共渲染（updateCardStatsById + updateMasonryStatsOnly 共用，去重）---- */
function renderCardStatsBadges(p, myVote) {
    const likes = p.likes || 0;
    const dislikes = p.dislikes || 0;
    const haveVotes = likes > 0 || dislikes > 0;
    if (!haveVotes) return { html: '', haveVotes: false };
    const html =
        `${likes > 0 ? `<div class="card-badge card-badge-like${myVote === 1 ? ' active' : ''}"><svg class="icon" data-i="heart"></svg><span>${likes}</span></div>` : ''}` +
        `${dislikes > 0 ? `<div class="card-badge card-badge-dislike${myVote === -1 ? ' active' : ''}"><svg class="icon" data-i="x-circle"></svg><span>${dislikes}</span></div>` : ''}`;
    return { html, haveVotes: true };
}

function makeCard(photo, index) {
    const card = el('div', 'photo-card');
    card.dataset.id = photo.id;

    const holder = el('div', 'ratio-holder');
    if (photo.width && photo.height) {
        holder.style.paddingBottom = (photo.height / photo.width * 100) + '%';
    } else {
        holder.style.paddingBottom = '100%';
    }
    const skel = el('div', 'skeleton');
    const animated = hasAnimatedMedia(photo);
    let media;
    if (animated) {
        media = el('video', 'ph-img');
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.autoplay = true;
        media.controls = false;
        media.preload = 'metadata';
        media.setAttribute('playsinline', '');
        media.draggable = false;
        media.onloadedmetadata = () => {
            const nw = media.videoWidth, nh = media.videoHeight;
            if (nw && nh) {
                if (photo.width !== nw || photo.height !== nh) {
                    photo.width = nw; photo.height = nh;
                    holder.style.paddingBottom = (nh / nw * 100) + '%';
                    Store.markDimsDirty(photo, nw, nh);
                }
            }
            if (photo.hasAudio && !card.querySelector('.audio-toggle')) {
                const vbtn = makeVolumeBtn({ initiallyMuted: true });
                holder.appendChild(vbtn);
            }
            media.classList.add('loaded');
            skel.remove();
            try { media.play().catch(e => console.warn('[infoto] card video autoplay fail', e)); } catch (e) { console.warn('[infoto] card video autoplay fail', e); }
        };
        media.onerror = () => {
            skel.remove(); media.classList.add('loaded'); media.style.opacity = '.4';
        };
        media.src = photo.url;
    } else {
        media = el('img', 'ph-img');
        media.loading = 'lazy';
        media.draggable = false;
        media.alt = dlName(photo);
        media.src = photo.url;
        media.onload = () => {
            const nw = media.naturalWidth, nh = media.naturalHeight;
            if (nw && nh) {
                if (photo.width !== nw || photo.height !== nh) {
                    photo.width = nw; photo.height = nh;
                    holder.style.paddingBottom = (nh / nw * 100) + '%';
                    Store.markDimsDirty(photo, nw, nh);
                }
            }
            media.classList.add('loaded');
            skel.remove();
        };
        media.onerror = () => {
            skel.remove(); media.classList.add('loaded'); media.style.opacity = '.4';
        };
    }
    holder.appendChild(skel);
    holder.appendChild(media);
    card.appendChild(holder);

    if (animated && photo.hasAudio) {
        const vbtn = makeVolumeBtn({ initiallyMuted: true });
        holder.appendChild(vbtn);
    }

    const myVote = Store.getMyVote(photo.id);
    const { html, haveVotes } = renderCardStatsBadges(photo, myVote);
    if (haveVotes) {
        const stats = el('div', 'card-stats', html);
        renderIcons(stats);
        card.appendChild(stats);
    }
    const check = el('div', 'multi-check', `<svg class="icon" data-i="check"></svg>`);
    renderIcons(check);
    card.appendChild(check);
    return card;
}

function applySelectUI() {
    $$('.photo-card').forEach(c => {
        const sel = state.selected.has(c.dataset.id);
        c.classList.toggle('selected', sel);
        const m = c.querySelector('.multi-check'); if (m) m.classList.toggle('on', sel);
    });
}

function renderMasonry(reset = true) {
    const expectedCols = colCount();
    const curColsDom = $('#masonry').querySelectorAll('.masonry-col').length;
    if (!cols || cols.length !== expectedCols || curColsDom !== expectedCols) {
        reset = true;
    }
    if (reset) { buildColumns(); renderedCount = 0; }
    const sorted = getSorted();
    const n = Math.min(sorted.length, state.loadedCount);
    for (let i = renderedCount; i < n; i++) _shortestCol().appendChild(makeCard(sorted[i], i));
    renderedCount = n;
    applySelectUI();
    updateMasonryStatsOnly();
    $('#emptyState').classList.toggle('hidden', sorted.length > 0);
    $('#masonry').classList.toggle('hidden', sorted.length === 0);
}

function prependCardToMasonry(photo) {
    const card = makeCard(photo, 0);
    const targetCol = _shortestCol();
    if (!targetCol) return;
    if (targetCol.firstChild) targetCol.insertBefore(card, targetCol.firstChild);
    else targetCol.appendChild(card);
    applySelectUI();
    updateCardStatsById(photo.id);
    $('#emptyState').classList.add('hidden');
    $('#masonry').classList.remove('hidden');
}

function installInfiniteScroll() {
    const handler = () => {
        const sorted = getSorted();
        if (state.loadedCount >= sorted.length) return;
        const scrolled = window.scrollY + window.innerHeight;
        const threshold = document.body.scrollHeight - 2.5 * window.innerHeight;
        if (scrolled >= threshold) {
            state.loadedCount = Math.min(sorted.length, state.loadedCount + state.batchSize);
            renderMasonry(false);
        }
    };
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    let safety = 0;
    const fill = () => {
        const sorted = getSorted();
        if (state.loadedCount >= sorted.length || safety++ > 10) return;
        if (document.body.scrollHeight <= window.innerHeight + 100) {
            state.loadedCount = Math.min(sorted.length, state.loadedCount + state.batchSize);
            renderMasonry(false);
            setTimeout(fill, 50);
        }
    };
    setTimeout(fill, 150);
}

function updateCardStatsById(id) {
    const p = Store.photos.find(x => x.id === id);
    if (!p) return;
    const myVote = Store.getMyVote(id);
    $$(`.photo-card[data-id="${id}"]`).forEach(c => {
        const oldStats = c.querySelector('.card-stats');
        const { html, haveVotes } = renderCardStatsBadges(p, myVote);
        if (!haveVotes) { if (oldStats) oldStats.remove(); return; }
        if (oldStats) { oldStats.innerHTML = html; renderIcons(oldStats); }
        else { const s = el('div', 'card-stats', html); renderIcons(s); c.appendChild(s); }
    });
    if (state.lightboxOpen) {
        const likes = p.likes || 0, dislikes = p.dislikes || 0;
        const lbLikes = document.querySelector('#lbLikes');
        const lbDislikes = document.querySelector('#lbDislikes');
        if (lbLikes) { lbLikes.classList.toggle('active', myVote === 1); lbLikes.querySelector('span').textContent = likes; lbLikes.style.display = likes > 0 ? '' : 'none'; }
        if (lbDislikes) { lbDislikes.classList.toggle('active', myVote === -1); lbDislikes.querySelector('span').textContent = dislikes; lbDislikes.style.display = dislikes > 0 ? '' : 'none'; }
    }
}

function updateMasonryStatsOnly() {
    $$('.photo-card').forEach(c => {
        const id = c.dataset.id;
        const p = Store.photos.find(x => x.id === id);
        if (!p) return;
        const myVote = Store.getMyVote(id);
        const { html, haveVotes } = renderCardStatsBadges(p, myVote);
        const oldStats = c.querySelector('.card-stats');
        if (!haveVotes) { if (oldStats) oldStats.remove(); return; }
        if (oldStats) { oldStats.innerHTML = html; renderIcons(oldStats); }
        else { const s = el('div', 'card-stats', html); renderIcons(s); c.appendChild(s); }
    });
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (colCount() !== cols.length && !state.lightboxOpen) renderMasonry();
    }, 200);
});

/* =========================================================
   多选模式
   ========================================================= */
function enterMulti(initialId) {
    state.multiMode = true;
    state.longPressTriggered = false; // 复位：避免历次长按残留阻断多选单击
    state.selected.clear();
    if (initialId) state.selected.add(initialId);
    $('#multiSelectBtn').querySelector('svg').setAttribute('data-i', 'x');
    $('#uploadBtn').classList.add('hidden');
    $('#multiBar').classList.add('show');
    $('#batchDeleteBtn').classList.toggle('hidden', !state.isAdmin);
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
let _deleting = false;
let _deleteWorkerListener = null;
async function deleteSelected() {
    if (!state.isAdmin) return;
    if (_deleting) return;
    const ids = [...state.selected];
    if (ids.length === 0) { toast('请先选择照片'); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 张照片吗？此操作不可撤销。`)) return;

    _deleting = true;
    _mode = 'delete';
    resetProgressUI();

    if (TaskWorker.isSupported() && TaskWorker.startDelete(ids, apiBase())) {
        toast('删除已在后台启动（切换页面不中断）', 'info');
        if (_deleteWorkerListener) _deleteWorkerListener();
        _deleteWorkerListener = TaskWorker.onMessage((msg) => {
            if (msg.type === 'task-update' && msg.task && msg.task.type === 'delete') {
                const t = msg.task;
                setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed });
            }
            if (msg.type === 'delete-complete') {
                const s = msg.summary || {};
                setProgress(1, null, s.failed === 0 ? '完成' : '部分失败', { stat: `成功 ${s.done || 0} · 失败 ${s.failed || 0}` });
                toast(s.failed === 0 ? `已删除 ${s.done || 0} 张照片` : `删除完成：${s.done || 0} 成功 / ${s.failed || 0} 失败`, s.failed === 0 ? 'success' : 'alert');
                (async () => {
                    await Store.load(true);
                    exitMulti();
                    renderMasonry();
                })();
                setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
                if (_deleteWorkerListener) { _deleteWorkerListener(); _deleteWorkerListener = null; }
                _deleting = false;
            }
        });
        return;
    }

    const total = ids.length;
    let done = 0, fail = 0;

    const tasks = ids.map(id => async () => {
        try {
            const r = await fetch(apiBase() + '/api/photos/' + encodeURIComponent(id), { method: 'DELETE' });
            if (r.ok) done++; else fail++;
        } catch (e) { fail++; }
        const finished = done + fail;
        setProgress(
            total ? finished / total : 1,
            `${finished} / ${total} 张`,
            '删除中…',
            { stat: `成功 ${done} · 失败 ${fail}`, remaining: total - finished }
        );
    });

    await runWithConcurrency(tasks, CONFIG.CONCURRENCY);

    setProgress(1, null, fail === 0 ? '完成' : '部分失败', { stat: `成功 ${done} · 失败 ${fail}` });
    toast(fail === 0 ? `已删除 ${done} 张照片` : `删除完成：${done} 成功 / ${fail} 失败`, fail === 0 ? 'success' : 'alert');

    await Store.load(true);
    exitMulti();
    renderMasonry();
    setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
    _deleting = false;
}

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
        state.longPressTriggered = true;
        if (!state.multiMode) enterMulti(card.dataset.id);
        else toggleSelect(card.dataset.id);
    }, 500);
}
['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => {
    $('#masonry').addEventListener(ev, () => {
        clearTimeout(state.longPressTimer);
        // 恢复 masonry 内所有音量按钮（mouseleave / touchend 都可能是用户已离开某张的状态）
        document.querySelectorAll('#masonry .audio-toggle.is-hidden').forEach(b => b.classList.remove('is-hidden'));
    });
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

/* ---- 拖动框选 ---- */
const BOX_DRAG_THRESHOLD = 5;
document.addEventListener('mousedown', e => {
    if (!state.multiMode) return;
    if (!e.target.closest('#masonry')) return;
    if (e.button !== 0) return;
    state.boxArm = true;
    state.boxSelecting = false;
    state.boxStart = { x: e.clientX, y: e.clientY };
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
    $$('.photo-card').forEach(c => {
        const r = c.getBoundingClientRect();
        const hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
        if (hit) state.selected.add(c.dataset.id);
    });
    applySelectUI(); updateCount();
});
document.addEventListener('mouseup', () => {
    state.boxArm = false;
    if (state.boxSelecting) {
        state.boxSelecting = false;
        $('#selectionBox').style.display = 'none';
    }
});

/* ---- 批量操作 ---- */
// JSZip 用动态 import（项目零 npm 依赖），首次用到才加载
let _jszip = null;
async function getZipLib() {
    if (_jszip) return _jszip;
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    _jszip = JSZip;
    return _jszip;
}

// 带字节级进度的 fetch（利用 XHR 读取 content-length，不支持则降级为整文件完成）
function fetchWithProgress(url, opts, onProgress) {
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
                if (!knownTotal && xhr.response?.size) {
                    onProgress?.(xhr.response.size, xhr.response.size);
                }
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

let _downloadWorkerListener = null;
$('#batchDownloadBtn').addEventListener('click', async () => {
    const list = getSorted().filter(p => state.selected.has(p.id));
    if (list.length === 0) { toast('请先选择照片'); return; }
    if (list.length === 1) {
        return downloadUrl(list[0].url + '?dl=1', dlName(list[0]));
    }

    _mode = 'download';
    resetProgressUI();

    if (TaskWorker.isSupported() && TaskWorker.startDownload(list, apiBase())) {
        toast('下载已在后台启动（切换页面不中断）', 'info');
        if (_downloadWorkerListener) _downloadWorkerListener();
        _downloadWorkerListener = TaskWorker.onMessage((msg) => {
            if (msg.type === 'task-update' && msg.task && msg.task.type === 'download') {
                const t = msg.task;
                setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed });
            }
            if (msg.type === 'download-complete' && msg.zipUrl) {
                downloadUrl(msg.zipUrl, msg.fileName || 'download.zip');
                setTimeout(() => URL.revokeObjectURL(msg.zipUrl), 60000);
                setProgress(1, msg.fileName || 'download.zip', '完成');
                toast('下载完成', 'success');
                setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 3000);
                if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
            }
        });
        return;
    }

    const JSZip = await getZipLib();
    const zip = new JSZip();
    const total = list.length;

    toast(`正在打包 ${total} 张图片…`, 'download');

    const perItemProgress = new Array(total).fill(0);
    const perItemTotal = new Array(total).fill(0);
    const perItemDone = new Array(total).fill(false);
    let downloadedBytes = 0;
    let estimatedTotalBytes = 0;
    let zipProgress = 0;
    const ZIP_WEIGHT = 0.12;
    const FETCH_WEIGHT = 1 - ZIP_WEIGHT;

    const recomputeOverall = () => {
        let sumCur = 0, sumTot = 0;
        let finishedItems = 0;
        for (let i = 0; i < total; i++) {
            const t = perItemTotal[i] || 1;
            sumCur += perItemProgress[i];
            sumTot += t;
            if (perItemDone[i]) finishedItems++;
        }
        const fetchPart = sumTot > 0 ? (sumCur / sumTot) * FETCH_WEIGHT : 0;
        const zipPart = zipProgress * ZIP_WEIGHT;
        const overall = Math.min(1, fetchPart + zipPart);
        downloadedBytes = sumCur;
        estimatedTotalBytes = sumTot;
        const stat = `下载 ${finishedItems}/${total} 张`;
        setProgress(overall, `${finishedItems} / ${total} 张`, zipProgress > 0 ? '打包 zip 中' : '下载中…', { stat, remaining: total - finishedItems });
    };

    const dlTasks = list.map((p, i) => async () => {
        try {
            const base = dlName(p);
            const { blob, total: t } = await fetchWithProgress(
                p.url,
                { cache: 'force-cache' },
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
            perItemDone[i] = true;
            toast(`下载失败: ${dlName(p)}`, 'alert');
            return { ok: false, err: e };
        }
    });

    const results = await runWithConcurrency(dlTasks, CONFIG.CONCURRENCY);
    const successCount = results.filter(r => r.ok).length;
    if (successCount === 0) {
        toast('所有图片下载失败', 'alert');
        setProgress(1, null, '失败', { stat: null });
        setTimeout(resetProgressUI, 2500);
        _mode = 'upload';
        return;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        zipProgress = meta.percent / 100;
        recomputeOverall();
        const failedCount = total - successCount;
        const stat = `${successCount}/${total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`;
        setProgress(
            Math.min(1, (1 - ZIP_WEIGHT) + zipProgress * ZIP_WEIGHT),
            `生成 zip ${meta.percent.toFixed(0)}%`,
            failedCount ? `打包中（${successCount}/${total} 张成功）` : '打包 zip…',
            { stat, remaining: total - successCount }
        );
    });
    zipProgress = 1;
    recomputeOverall();

    const url = URL.createObjectURL(zipBlob);
    const finalName = 'download.zip';
    downloadUrl(url, finalName);
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    const skipMsg = successCount < total ? `（${total - successCount} 张失败跳过）` : '';
    toast(`下载完成：共 ${successCount} 张${skipMsg} → zip`, 'success');
    const finalFailed = total - successCount;
    const finalStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
    setProgress(1, finalName, '完成', { stat: finalStat });
    setTimeout(() => {
        resetProgressUI();
        _mode = 'upload';
    }, 3000);
});

/* =========================================================
   上传
   ========================================================= */
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

/* 上传/下载 进度 UI：按钮右下角小圆圈 + 悬停详情 */
let _mode = 'upload';
// 上传精细化进度：各子阶段字节进度跟踪（按"实际字节工作量"加权，而非文件数）
let _prepBytes = { total: 0, done: 0 };
let _uploadBytes = { total: 0, done: 0 };
// 阶段权重（总和≈1）：预处理20% → 查重+上传75% → 收尾同步5%（收尾进度动画内联）
const PHASE_WEIGHT = { PREP: 0.20, UPLOAD: 0.75 };

function resetProgressUI() {
    const ind = $('#upIndicator');
    ind.classList.add('hidden');
    $('#upRing').style.strokeDashoffset = '94.25';
    // 重置：用数字 0，清空 check 图标
    $('#upPct').innerHTML = '0';
    $('#upPct').style.fontSize = '';
    $('#upPct').style.color = '';
    $('#upDone').textContent = '0';
    $('#upSkipped').textContent = '0';
    $('#upFailed').textContent = '0';
    $('#upTipFile').textContent = _mode === 'download' ? '等待下载' : _mode === 'delete' ? '等待删除' : '待上传';
    $('#upTipStep').textContent = _mode === 'download' ? '准备下载' : _mode === 'delete' ? '准备删除' : '准备中';
    _prepBytes = { total: 0, done: 0 };
    _uploadBytes = { total: 0, done: 0 };
    $('#upTipStatExtra')?.remove();
}
function setProgress(p, file, step, extra) {
    const ind = $('#upIndicator');
    ind.classList.remove('hidden');
    const clampedP = Math.max(0, Math.min(1, p));
    $('#upRing').style.strokeDashoffset = String(94.25 * (1 - clampedP));
    const pctEl = $('#upPct');
    if (clampedP >= 1) {
        // 完成：统一显示对勾图标（完整 svg，避免裸 <polyline> 不渲染）
        pctEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (extra && extra.remaining !== undefined && extra.remaining !== null) {
        // 未完成：统一显示剩余数目（不再百分比），上传/下载/删除一致
        pctEl.textContent = String(extra.remaining);
        pctEl.style.fontSize = '';
    } else {
        // 兜底：百分比
        pctEl.textContent = Math.round(clampedP * 100) + '%';
        pctEl.style.fontSize = '';
    }
    if (file) $('#upTipFile').textContent = file;
    if (step) $('#upTipStep').textContent = step;
    if (extra && extra.stat !== undefined && extra.stat !== null) {
        $('#upTipStatExtra')?.remove();
        const s = document.createElement('div');
        s.id = 'upTipStatExtra';
        s.style.cssText = 'margin-top:.6rem;padding-top:.6rem;border-top:1px solid rgba(123,133,160,.18);font-size:.72rem;color:var(--on-variant);letter-spacing:.03em';
        s.textContent = extra.stat;
        $('#upTip').appendChild(s);
    } else if (extra && extra.stat === null) {
        $('#upTipStatExtra')?.remove();
    }
}
const resetUploadUI = resetProgressUI;
const setUploadProgress = (p, file, step, extra) => setProgress(p, file, step, extra);

async function uploadFiles(files) {
    resetUploadUI();
    _mode = 'upload';
    const t0 = Date.now();
    await supportsVp9WebCodecs();
    applyFileInputAccept();
    const total = files.length;
    if (total === 0) return;
    const vp9Ok = _vp9Support === true;
    _prepBytes = { total: 0, done: 0 };
    _uploadBytes = { total: 0, done: 0 };

    let done = 0, failed = 0, skipped = 0;
    const PHASE = { PREP: 0.20, UPLOAD: 0.75, SYNC: 0.05 };

    // 每文件独立状态：各自写入自己的进度，整体进度统一汇总（并发写入互不干扰，不会互相覆盖）
    const fileStates = files.map((f, i) => ({ idx: i, size: f.size || 0, prepP: 0, upP: 0, uploadBytes: f.size || 0, err: null }));
    const prepTotal = fileStates.reduce((a, s) => a + s.size, 0) || 1;

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

    let currentFile = total > 1 ? `${total} 个文件` : (files[0] && files[0].name || '');
    let currentStep = '准备中…';

    function curOverall() {
        let prepSum = 0, upSum = 0, upDen = 0;
        for (const s of fileStates) {
            prepSum += s.prepP * s.size;
            const ub = s.uploadBytes || s.size || 1;
            upSum += s.upP * ub; upDen += ub;
        }
        const prepP = prepSum / prepTotal;
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
    let uiTick = null;
    const startUiTick = () => { if (uiTick) return; uiTick = setInterval(() => {
        setUploadProgress(curOverall(), currentFile, currentStep, { stat: buildStat(), remaining: Math.max(0, total - done - skipped - failed) });
    }, 120); };
    const stopUiTick = () => { if (uiTick) { clearInterval(uiTick); uiTick = null; } };

    async function processOne(file, idx) {
        const st = fileStates[idx];
        try {
            if (file.type === 'image/svg+xml') { st.err = 'SVG 暂不支持'; failed++; markReady(idx, null); toast(`「${file.name}」SVG 暂不支持`, 'alert'); return; }
            let blob = file, ext = 'webp', hasAudio = false;
            const isV = isVideoFile(file), isG = isGifFile(file), isP = _safeForWebp(file);
            if (isP) {
                currentFile = file.name; currentStep = '压缩中…';
                const webp = await compressToWebp(file, WEBP_QUALITY);
                if (!webp) { st.err = '图片 WebP 压缩失败'; failed++; markReady(idx, null); toast(`「${file.name}」图片 WebP 压缩失败`, 'alert'); return; }
                blob = webp; ext = 'webp';
            } else if (isV || isG) {
                if (!vp9Ok) {
                    const msg = (isG ? 'GIF' : '视频') + '需要支持 VP9 WebCodecs 的浏览器（Chrome/Edge/Firefox 等）';
                    st.err = msg; failed++; markReady(idx, null); toast(`「${file.name}」${msg}`, 'alert'); return;
                }
                const label = isG ? 'GIF 转码' : '视频转码';
                currentFile = file.name; currentStep = label + '中…';
                const r = await transcodeToVp9Webm(file, (p) => { st.prepP = Math.max(0, Math.min(1, p || 0)); });
                blob = r.blob; ext = 'webm'; hasAudio = !!r.hasAudio;
            }
            st.prepP = 1;
            st.uploadBytes = blob.size || st.size || 1;
            const ab = await blob.arrayBuffer();
            const sha = await sha256Hex(ab);
            currentStep = '查重…'; st.upP = 0.02;
            const dup = await checkHashExists(sha);
            if (dup) {
                skipped++; st.upP = 1;
                markReady(idx, null);
                toast(`「${file.name}」已存在，跳过`, 'info');
                return;
            }
            currentFile = file.name; currentStep = '上传到图床';
            const parts = await uploadToBed(blob, 'upload.' + ext, (p) => { st.upP = 0.02 + p * 0.93; }, apiBase());
            st.upP = 0.96; currentStep = '获取尺寸…';
            const photo = {
                id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                url: '', parts, sha256: sha,
                width: 0, height: 0, createdAt: Date.now(),
                ext, hasAudio
            };
            photo.url = fileUrl(photo.id);
            await loadDims(photo);
            st.upP = 0.98;
            await Store.add(photo);
            st.upP = 1; done++;
            markReady(idx, photo);
            if (photo.width && photo.height) Store.save(photo).catch(() => { });
            blob = null; // 立即释放字节，降低内存峰值
        } catch (e) {
            console.error('upload failed:', file.name, e);
            st.err = e && e.message ? e.message : String(e);
            failed++;
            markReady(idx, null);
            toast(`「${file.name}」上传失败: ${st.err}`, 'alert');
        }
    }

    // 拆分：图片走 CONFIG.CONCURRENCY 并发；视频/GIF 单线程（WebCodecs 内部已并行，多开极易 OOM）
    const picTasks = [], vp9Tasks = [];
    files.forEach((file, idx) => {
        const heavy = vp9Ok && (isVideoFile(file) || isGifFile(file));
        (heavy ? vp9Tasks : picTasks).push(() => processOne(file, idx));
    });

    startUiTick();
    await Promise.all([
        runWithConcurrency(picTasks, CONFIG.CONCURRENCY),
        runWithConcurrency(vp9Tasks, 1)
    ]);
    stopUiTick();
    flushCards(); // 兜底 flush 剩余卡片

    // 阶段 3：最终同步对齐（占总进度最后 5%）
    const finalStart = Date.now();
    const finalDur = 500;
    const finalAnim = setInterval(() => {
        const t = Math.min(1, (Date.now() - finalStart) / finalDur);
        setUploadProgress(PHASE.PREP + PHASE.UPLOAD + t * PHASE.SYNC, null, '同步服务器…', { remaining: Math.max(0, total - done - skipped - failed) });
    }, 30);
    try {
        updateMasonryStatsOnly();
        if (state.lightboxOpen) {
            const cp = curPhoto();
            if (cp) updateLightboxVotes(cp);
            renderDots();
        }
    } catch (_) { }
    clearInterval(finalAnim);

    setUploadProgress(1, null, '完成', { stat: `共 ${formatSize(prepTotal)} · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s` });
    const summary = [];
    if (done > 0) summary.push(`成功 ${done}`);
    if (skipped > 0) summary.push(`跳过重复 ${skipped}`);
    if (failed > 0) summary.push(`失败 ${failed}`);
    if (summary.length) toast(`上传完成：${summary.join('，')}`, done > 0 || skipped > 0 ? 'success' : 'alert');
    setTimeout(resetUploadUI, 2500);
}

async function checkHashExists(sha) {
    try {
        const r = await fetch(apiBase() + '/api/photos/hash/' + sha, { cache: 'no-store' });
        if (r.ok) {
            const j = await r.json();
            if (j && j.exists) return j.photo || true;
        }
    } catch (e) { /* ignore */ }
    return false;
}

function loadDims(photo) {
    return new Promise(resolve => {
        const animated = hasAnimatedMedia(photo);
        const done = (w, h) => {
            photo.width = w || 0;
            photo.height = h || 0;
            resolve();
        };
        const timeout = setTimeout(() => done(photo.width || 0, photo.height || 0), 8000);
        if (animated) {
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true; v.preload = 'metadata';
            v.onloadedmetadata = () => { clearTimeout(timeout); done(v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load && v.load(); };
            v.onerror = () => { clearTimeout(timeout); done(photo.width, photo.height); };
            v.src = photo.url;
        } else {
            const img = new Image();
            img.onload = () => { clearTimeout(timeout); done(img.naturalWidth, img.naturalHeight); };
            img.onerror = () => { clearTimeout(timeout); done(photo.width, photo.height); };
            img.src = photo.url;
        }
    });
}

/* =========================================================
   Lightbox 卡片预览 + 四向手势
   ========================================================= */
const THRESHOLD = 80;

function openLightbox(idx) {
    const list = getSorted();
    if (idx < 0 || idx >= list.length) return;
    state.currentIndex = idx;
    state.lightboxOpen = true;
    $('#lightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
    updateLightbox();
    renderDots();
}
function closeLightbox() {
    state.lightboxOpen = false;
    $('#lightbox').classList.remove('show');
    document.body.style.overflow = '';
    closeMenu();
    resetGestures();
    resetZoom();
    // 关闭时暂停 video 并清空 src，释放 GPU / 解码资源
    const vid = $('#lbVid');
    if (vid) {
        try {
            vid.pause();
            vid.removeAttribute('src');
            vid.load && vid.load();
        } catch (_) { }
    }
}
function curPhoto() { return getSorted()[state.currentIndex]; }
/* ---------- 音量按钮显示/隐藏（拖动时隐藏，结束显示）---------- */
function _setAudioBtnsVisible(v) {
    const list = document.querySelectorAll('.audio-toggle');
    list.forEach(b => { b.classList.toggle('is-hidden', !v); });
}
/* ---------- 轻量通用收尾：Lightbox 手势结束时把 lbWrap 复位 + 图标复位 + 音量按钮恢复 ---------- */
function _resetLbWrapAndGestures(animatedBack = true) {
    const w = lbWrap();
    if (w) {
        if (animatedBack) w.style.transition = 'transform .3s ease, opacity .3s ease';
        w.style.transform = 'translate(0,0)';
    }
    resetGestures();
    _setAudioBtnsVisible(true);
}
/* ---------- 根据手势判定触发：投票/下载/菜单 ---------- */
function _triggerGestureByDrag(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > ay) {
        if (ax > THRESHOLD) triggerGesture(dx > 0 ? 'right' : 'left');
    } else {
        if (ay > THRESHOLD) triggerGesture(dy > 0 ? 'down' : 'up');
    }
}
function updateLightboxVotes(p) {
    const likes = p.likes || 0;
    const dislikes = p.dislikes || 0;
    const myVote = Store.getMyVote(p.id);
    const likesStr = likes > 0 ? `<span class="lb-vote lb-vote-like${myVote === 1 ? ' active' : ''}"><svg class="icon" data-i="heart"></svg><b>${likes}</b></span>` : '';
    const dislikesStr = dislikes > 0 ? `<span class="lb-vote lb-vote-dislike${myVote === -1 ? ' active' : ''}"><svg class="icon" data-i="x-circle"></svg><b>${dislikes}</b></span>` : '';
    let votesBox = $('#lbVotes');
    if (!votesBox) {
        votesBox = el('div', 'lb-votes');
        votesBox.id = 'lbVotes';
        $('#lbCounter').after(votesBox);
    }
    votesBox.innerHTML = likesStr + dislikesStr;
    renderIcons(votesBox);

    const giLeft = $('#giLeft'), giRight = $('#giRight');
    giLeft.classList.toggle('voted', myVote === 1);
    giRight.classList.toggle('voted', myVote === -1);
}
function updateLightbox() {
    const p = curPhoto();
    if (!p) return;

    // 清理旧的 lb 音量按钮
    const w = lbWrap();
    if (w) {
        w.querySelectorAll('.audio-toggle').forEach(n => n.remove());
    }
    state.zoom = { s: 1, x: 0, y: 0, r: 0 };
    state.panning = false;
    if (w) {
        w.style.transition = 'none';
        w.style.transformOrigin = '50% 50%';
        w.style.transform = 'translate(0,0) scale(1) rotate(0deg)';
        w.style.opacity = 1;
    }

    const img = $('#lbImg');
    const vid = $('#lbVid');

    try { if (vid && vid.pause) vid.pause(); } catch (_) { }

    const animated = hasAnimatedMedia(p);
    if (animated) {
        img.style.display = 'none';
        try { img.removeAttribute('src'); } catch (_) { }
        vid.style.display = '';
        vid.muted = true;
        vid.loop = true;
        vid.playsInline = true;
        vid.controls = false;
        vid.preload = 'auto';
        vid.onerror = () => { vid.style.opacity = '.4'; };

        const onMeta = () => {
            if (p.hasAudio && w && !w.querySelector('.audio-toggle')) {
                const vbtn = makeVolumeBtn({ initiallyMuted: true });
                vbtn.classList.add('audio-toggle--lb');
                w.appendChild(vbtn);
                _setAudioBtnsVisible(true);
            }
        };
        vid.addEventListener('loadedmetadata', onMeta, { once: true });

        vid.src = p.url;
        // muted autoplay 允许；失败就等用户交互再 play（常见于 iOS Safari 低电量模式）
        try {
            const pProm = vid.play();
            if (pProm && typeof pProm.catch === 'function') pProm.catch(() => { /* ignore */ });
        } catch (_) { }
    } else {
        vid.style.display = 'none';
        try { vid.removeAttribute('src'); if (vid.load) vid.load(); } catch (_) { }
        img.style.display = '';
        img.onerror = () => { };
        img.src = p.url;
        img.alt = dlName(p);
    }
    $('#lbCounter').textContent = `${state.currentIndex + 1} / ${getSorted().length}`;
    updateLightboxVotes(p);
    renderDots();
    _setAudioBtnsVisible(true);
}
function renderDots() {
    const d = $('#lbDots');
    const list = getSorted();
    const max = Math.min(list.length, 20);
    // 1) 保证 dot 数量正确（不够补、多了删），不重建已有 dot
    while (d.children.length < max) d.appendChild(el('span', 'dot'));
    while (d.children.length > max) d.removeChild(d.lastChild);
    // 2) 只切换 active class
    for (let i = 0; i < max; i++) {
        d.children[i].classList.toggle('active', i === state.currentIndex);
    }
}
function prevPhoto() { state.currentIndex = (state.currentIndex - 1 + getSorted().length) % getSorted().length; updateLightbox(); }
function nextPhoto() { state.currentIndex = (state.currentIndex + 1) % getSorted().length; updateLightbox(); }

$('#lbCloseBtn').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('click', e => { if (state.menuOpen) return; if (e.target.id === 'lightbox') closeLightbox(); });

document.addEventListener('keydown', e => {
    if (!state.lightboxOpen) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => {
    if (!state.lightboxOpen) return;
    if (e.repeat) return;
    if (state.menuOpen) {
        if (e.key === 'Escape') closeMenu();
        return;
    }
    if (e.key === 'ArrowLeft') triggerGesture('left');
    else if (e.key === 'ArrowRight') triggerGesture('right');
    else if (e.key === 'ArrowUp') triggerGesture('up');
    else if (e.key === 'ArrowDown') triggerGesture('down');
    else if (e.key === 'Escape') closeLightbox();
});

function resetGestures() {
    ['#giLeft', '#giRight', '#giUp', '#giDown'].forEach(s => {
        const g = $(s);
        g.style.opacity = 0; g.style.transform = '';
    });
}

/* ---- Lightbox 缩放 / 平移 / 旋转（统一作用到 lbMediaWrap 容器，img/video 同步被变换）---- */
function lbWrap() { return $('#lbMediaWrap'); }
function applyZoomTransform() {
    const w = lbWrap(); if (!w) return;
    w.style.transform = `translate(${state.zoom.x}px, ${state.zoom.y}px) scale(${state.zoom.s}) rotate(${(state.zoom.r || 0).toFixed(2)}deg)`;
}
function clampPan() {
    const w = lbWrap(); if (!w) return;
    const sr = stage.getBoundingClientRect();
    const r = w.getBoundingClientRect();
    // scale<=1 时 translate 归零，但**不重置旋转**（用户显式旋转过就保留）
    if (state.zoom.s <= 1) { state.zoom.x = 0; state.zoom.y = 0; applyZoomTransform(); return; }
    if (r.left > sr.left + 1) state.zoom.x += (sr.left + 1 - r.left);
    if (r.right < sr.right - 1) state.zoom.x += (sr.right - 1 - r.right);
    if (r.top > sr.top + 1) state.zoom.y += (sr.top + 1 - r.top);
    if (r.bottom < sr.bottom - 1) state.zoom.y += (sr.bottom - 1 - r.bottom);
}
// 以 stage 内坐标 (sx,sy) 为锚点缩放到 ns
function zoomTo(ns, sx, sy) {
    ns = Math.min(8, Math.max(1, ns));
    const sr = stage.getBoundingClientRect();
    const Sx = sr.width / 2, Sy = sr.height / 2;
    const s = state.zoom.s, x = state.zoom.x, y = state.zoom.y;
    state.zoom.s = ns;
    state.zoom.x = (sx - Sx) - ns * (sx - Sx - x) / s;
    state.zoom.y = (sy - Sy) - ns * (sy - Sy - y) / s;
    applyZoomTransform();
    clampPan();
}
function resetZoom() {
    state.zoom = { s: 1, x: 0, y: 0, r: 0 };
    const w = lbWrap(); if (w) {
        w.style.transition = 'transform .2s ease';
        w.style.transformOrigin = '50% 50%';
    }
    applyZoomTransform();
    setTimeout(() => { if (w) w.style.transition = 'none'; }, 200);
}
let pinch = null;
function startPinch(e) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const sr = stage.getBoundingClientRect();
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    // 记录初始：双指距离 + 向量角度（度）+ 两指中心（stage 坐标）+ 当前缩放/旋转
    const dist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const cxStage = (t0.clientX + t1.clientX) / 2 - sr.left;
    const cyStage = (t0.clientY + t1.clientY) / 2 - sr.top;
    // 把两指中心换算成 wrap 相对百分位，作为 transform-origin 让旋转/缩放围绕两指中心（仿 iOS/Google Photos）
    const w = lbWrap();
    if (w) {
        // transform-origin 必须始终钉在元素中心(50% 50%)。
        // 若按「已变换后的 getBoundingClientRect」反算 origin 百分比，scale/rotate 后 wr.width/wr.left 已是形变值，
        // 算出的 origin 严重错位 → 缩放/旋转围绕错误支点，图片直接飞走。onGm 里的锚点数学(zoomTo 同款)正是假设中心 origin。
        w.style.transition = 'none';
        w.style.transformOrigin = '50% 50%';
    }
    pinch = {
        dist, angle,
        cx: cxStage, cy: cyStage,
        s: state.zoom.s,
        r: state.zoom.r || 0,
    };
}

// 归一化角度差（返回 (-180, +180]，避免 179°→-179° 时旋转突然转 358°）
function _normAngleDelta(d) {
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
}

function _isRotated() {
    // 吸附后 0/180/360° 视为"水平"，其他任何角度（含 90/270°）都视为"旋转了，应该走平移"
    // 注意 90° / 270° 时图片是竖图横放，主流相册依然允许用户 pan 调整位置看图
    const r = Math.abs(state.zoom.r || 0) % 360;
    const TOL = 0.5;
    return !(r <= TOL || Math.abs(r - 180) <= TOL || Math.abs(r - 360) <= TOL);
}
function onGs(e) {
    if (!state.lightboxOpen || state.menuOpen) return;
    if (e.target.closest('#lbMoreBtn,#lbCloseBtn,.audio-toggle')) return;
    // 阻止触摸产生的「兼容鼠标事件」(synthetic mousedown/move/up)：
    // 否则一次触摸滑动会先由 touchend(onGe) 触发一次手势，随后浏览器再合成一套 mouse 事件
    // 在 document 上触发 onGeMouse，导致同一滑动被判定两次（如同时「打开菜单 + 标记喜欢」）。
    // 按钮区域已在上面 return（不 preventDefault，保留点击）；其余触摸一律掐断合成链。
    if (e.touches && e.cancelable) e.preventDefault();
    // 双指捏合缩放
    if (e.touches && e.touches.length === 2) { startPinch(e); state.dragging = true; _setAudioBtnsVisible(false); return; }
    // 已放大 / 或图片被旋转过：单指/鼠标拖动 = 平移看图（不做投票手势，避免碰一下就翻页）
    if (state.zoom.s > 1.01 || _isRotated()) {
        state.dragging = true; state.panning = true;
        const pt = e.touches ? e.touches[0] : e;
        state.dragStart = { x: pt.clientX, y: pt.clientY };
        state.dragCurrent = { x: pt.clientX, y: pt.clientY };
        const w = lbWrap(); if (w) w.style.transition = 'none';
        _setAudioBtnsVisible(false);
        return;
    }
    state.dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    state.dragStart = { x: pt.clientX, y: pt.clientY };
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const w = lbWrap(); if (w) w.style.transition = 'none';
    _setAudioBtnsVisible(false);
    resetGestures();
}
function onGm(e) {
    if (!state.dragging || state.menuOpen) return;
    // 捏合缩放 + 双指旋转（与缩放同 anchor，归一化角度差避免 179↔-179 跨零跳变）
    if (e.touches && e.touches.length === 2) {
        if (!pinch) startPinch(e);
        const t0 = e.touches[0], t1 = e.touches[1];
        const sr = stage.getBoundingClientRect();
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        const d = Math.hypot(dx, dy) || 1;
        const curAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        const rotDelta = _normAngleDelta(curAngle - pinch.angle);
        const cx = (t0.clientX + t1.clientX) / 2 - sr.left;
        const cy = (t0.clientY + t1.clientY) / 2 - sr.top;

        // 1) 先把 zoom 按双指锚点缩放（沿用 zoomTo 的锚点计算，不做 clampPan 因为拖动中）
        const ns = Math.min(8, Math.max(1, pinch.s * (d / pinch.dist)));
        const Sx = sr.width / 2, Sy = sr.height / 2;
        const s = pinch.s, x = state.zoom.x, y = state.zoom.y;
        state.zoom.s = ns;
        state.zoom.x = (cx - Sx) - ns * (cx - Sx - x) / s;
        state.zoom.y = (cy - Sy) - ns * (cy - Sy - y) / s;
        // 2) 叠加旋转相对增量（以 pinch 起始为基准，避免累积浮点漂移）
        state.zoom.r = pinch.r + rotDelta;
        applyZoomTransform();
        if (e.cancelable) e.preventDefault();
        return;
    }
    // 放大状态下平移
    if (state.panning) {
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - state.dragStart.x;
        const dy = pt.clientY - state.dragStart.y;
        state.dragCurrent = { x: pt.clientX, y: pt.clientY };
        state.zoom.x += dx; state.zoom.y += dy;
        state.dragStart = { x: pt.clientX, y: pt.clientY };
        applyZoomTransform();
        if (e.cancelable) e.preventDefault();
        return;
    }
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - state.dragStart.x;
    const dy = pt.clientY - state.dragStart.y;
    state.dragCurrent = { x: pt.clientX, y: pt.clientY };
    const w = lbWrap();
    if (w) w.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;

    const ax = Math.abs(dx), ay = Math.abs(dy);
    let dir = null, dist = 0;
    if (ax > ay) { dir = dx > 0 ? 'right' : 'left'; dist = ax; } else { dir = dy > 0 ? 'down' : 'up'; dist = ay; }
    const ratio = Math.min(dist / THRESHOLD, 1);
    resetGestures();
    if (dist > 10) {
        const g = $(dir === 'left' ? '#giLeft' : dir === 'right' ? '#giRight' : dir === 'down' ? '#giDown' : '#giUp');
        if (g) {
            g.style.opacity = ratio;
            const base = dir === 'left' || dir === 'right' ? 'translateY(-50%)' : 'translateX(-50%)';
            g.style.transform = base + ` scale(${0.8 + ratio * 0.4})`;
        }
    }
    if (e.cancelable) e.preventDefault();
}
function onGe(e) {
    if (!state.dragging || state.menuOpen) return;
    // 触摸结束：掐断随后浏览器合成的 click/mouse 事件（见 onGs 注释），避免同一滑动被判定两次；
    // 同时设一个防御窗口，即便仍有 stray mouse 事件也直接忽略（见 onGeMouse）。
    if (e.changedTouches) {
        if (e.cancelable) e.preventDefault();
        state._suppressMouseUntil = Date.now() + 600;
    }
    // 捏合结束：吸附到最近的 90°（iOS / Google Photos 主流行为）
    if (pinch) {
        const w = lbWrap();
        // 吸附到最近的 90°（iOS / Google Photos 主流行为）。
        // 关键：保留为「连续的有符号值」——Math.round(r/90)*90 的结果本就在当前角度 ±45° 内，
        // 不要强行取模到 [0,360)（如把手势中渲染的 -90° 变成 270°），
        // 否则 CSS transition 在 rotate(-90deg)→rotate(270deg) 间会插值出 360° 整圈旋转，
        // 用户感知就是「逆时针转 90° 却多转了一大圈」。
        let r = (state.zoom.r || 0);
        const snapped = Math.round(r / 90) * 90;
        state.zoom.r = snapped;
        if (state.zoom.s <= 1.01) { state.zoom.x = 0; state.zoom.y = 0; }
        else clampPan();
        if (w) {
            w.style.transition = 'transform .2s ease';
            applyZoomTransform();
            setTimeout(() => { try { w.style.transition = 'none'; } catch (_) { } }, 210);
        } else {
            applyZoomTransform();
        }
        pinch = null; state.dragging = false; _setAudioBtnsVisible(true);
        return;
    }
    // 平移结束
    if (state.panning) {
        state.dragging = false; state.panning = false;
        clampPan();
        _setAudioBtnsVisible(true);
        return;
    }
    // 触摸双击：放大 / 复位
    if (e && e.changedTouches && e.changedTouches.length) {
        const t = e.changedTouches[0];
        const moved = Math.hypot(state.dragCurrent.x - state.dragStart.x, state.dragCurrent.y - state.dragStart.y);
        if (moved < 12) {
            const now = Date.now();
            if (state._lastTap && (now - state._lastTap.t) < 300 && Math.hypot(t.clientX - state._lastTap.x, t.clientY - state._lastTap.y) < 40) {
                const sr = stage.getBoundingClientRect();
                if (state.zoom.s > 1.01) resetZoom();
                else zoomTo(2.5, t.clientX - sr.left, t.clientY - sr.top);
                state._lastTap = null;
                state.dragging = false;
                _setAudioBtnsVisible(true);
                return;
            }
            state._lastTap = { t: now, x: t.clientX, y: t.clientY };
        }
    }
    state.dragging = false;
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    _triggerGestureByDrag(dx, dy);
    _resetLbWrapAndGestures(true);
}

function triggerGesture(dir) {
    if (!state.lightboxOpen || state.menuOpen) return;
    const p = curPhoto();
    if (!p) return;
    const w = lbWrap();
    if (w) { w.style.transition = 'transform .2s ease'; w.style.transform = 'translate(0,0)'; }

    if (dir === 'left' || dir === 'right') {
        const delta = dir === 'left' ? +1 : -1;
        const giId = dir === 'left' ? '#giLeft' : '#giRight';
        const gi = $(giId); gi.style.opacity = 1; gi.style.transform = 'translateY(-50%) scale(1.2)';

        // 先读本地是否已投过，再进行乐观更新（避免本地判断被新状态影响）
        const alreadyLocal = Store.getMyVote(p.id) === delta;
        const dirLabel = delta === 1 ? '喜欢' : '不喜欢';

        // 本地乐观更新后立刻刷新 UI（不阻塞，不等服务器）
        const rPromise = Store.setLike(p.id, delta);

        toast(alreadyLocal ? `你已标记过${dirLabel}这张` : `已标记为${dirLabel}`,
            delta === 1 ? 'heart' : 'alert');

        updateLightboxVotes(p);
        updateCardStatsById(p.id);

        // 异步收尾：服务器回来后 → 刷新全局数据（更新其他图的最新投票、新增图等）
        rPromise.then(() => {
            try { return Store.load(); } catch (_) { return Store.photos; }
        }).then(() => {
            const cp = curPhoto();
            if (cp) {
                updateLightboxVotes(cp);
                updateCardStatsById(cp.id);
            }
            if (state.lightboxOpen) renderDots();
        }).catch(() => { });

        setTimeout(() => { resetGestures(); nextPhoto(); }, 200);
    } else if (dir === 'down') {
        const gi = $('#giDown'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        downloadUrl(p.url + '?dl=1', dlName(p));
        toast('开始下载', 'download');
        setTimeout(() => { resetGestures(); }, 250);
    } else if (dir === 'up') {
        const gi = $('#giUp'); gi.style.opacity = 1; gi.style.transform = 'translateX(-50%) scale(1.2)';
        setTimeout(() => { resetGestures(); openMenu(); }, 200);
    }
}
function onGeMouse() {
    if (!state.dragging || state.menuOpen) return;
    // 防御：触摸刚结束的窗口内（state._suppressMouseUntil）忽略合成 mouse 手势，避免同一滑动被判定两次
    if (state._suppressMouseUntil && Date.now() < state._suppressMouseUntil) {
        state.dragging = false;
        return;
    }
    state.dragging = false;
    const dx = state.dragCurrent.x - state.dragStart.x;
    const dy = state.dragCurrent.y - state.dragStart.y;
    _triggerGestureByDrag(dx, dy);
    _resetLbWrapAndGestures(true);
}

const stage = $('#lbStage');
stage.addEventListener('mousedown', onGs);
document.addEventListener('mousemove', onGm);
document.addEventListener('mouseup', () => { if (state.dragging) onGeMouse(); });
stage.addEventListener('touchstart', onGs, { passive: false });
stage.addEventListener('touchmove', onGm, { passive: false });
stage.addEventListener('touchend', onGe);
// 触摸被系统手势/边缘中断（touchcancel 代替 touchend）时，必须复位拖拽状态并归位，否则会卡住 dragging 导致后续误触发
stage.addEventListener('touchcancel', () => {
    if (!state.lightboxOpen) return;
    state.dragging = false; state.panning = false;
    if (pinch) pinch = null;
    _resetLbWrapAndGestures(true);
});
// 缩放：滚轮 / 双击
stage.addEventListener('wheel', (e) => {
    if (!state.lightboxOpen) return;
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomTo(state.zoom.s * factor, e.clientX - sr.left, e.clientY - sr.top);
}, { passive: false });
stage.addEventListener('dblclick', (e) => {
    if (!state.lightboxOpen) return;
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    if (state.zoom.s > 1.01) resetZoom();
    else zoomTo(2.5, e.clientX - sr.left, e.clientY - sr.top);
});

/* =========================================================
   更多菜单
   ========================================================= */
function openMenu() { state.menuOpen = true; $('#menuMask').classList.add('show'); $('#menu').classList.add('show'); }
function closeMenu() { state.menuOpen = false; $('#menuMask').classList.remove('show'); $('#menu').classList.remove('show'); }
$('#lbMoreBtn').addEventListener('click', e => { e.stopPropagation(); openMenu(); });
$('#menuMask').addEventListener('click', closeMenu);
$('#menuCancel').addEventListener('click', closeMenu);

async function copyText(txt) {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) { return false; }
}
$('#menuCopyLink').addEventListener('click', async () => {
    const ok = await copyText(curPhoto().url);
    toast(ok ? '已复制直链到剪贴板' : '复制失败', 'success');
    closeMenu();
});
$('#menuCopyImage').addEventListener('click', async () => {
    try {
        const blob = await (await fetch(curPhoto().url)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已复制图片到剪贴板', 'success');
    } catch (e) {
        toast('复制图片失败（浏览器限制），已复制直链', 'alert');
        copyText(curPhoto().url);
    }
    closeMenu();
});
$('#menuShare').addEventListener('click', async () => {
    const p = curPhoto();
    if (navigator.share) {
        try { await navigator.share({ title: dlName(p), url: p.url }); } catch (e) { }
    } else {
        await copyText(p.url);
        toast('已复制链接，去分享吧', 'success');
    }
    closeMenu();
});
$('#menuGoogle').addEventListener('click', () => {
    // 使用 Google Lens 新版 URL（旧 searchbyimage 在多数地区会丢失 image_url 参数并重定向到首页）
    window.open('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(curPhoto().url), '_blank', 'noopener');
    toast('即将打开 Google 搜图', 'info');
    closeMenu();
});

async function downloadUrl(url, name) {
    const a = el('a');
    a.download = name || 'download';
    try {
        // 同源 fetch Blob 再触发下载：彻底避免 Safari / SW 拦截下"下载 + 新标签预览"同时发生，
        // 也保证文件名不被后端 Content-Disposition 覆盖（download 属性在 blob: URL 上 100% 生效）。
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (_) {
        // 兜底：fetch 失败（如 CORS/离线）时回退为老的 <a href> 方式
        a.href = url;
        document.body.appendChild(a); a.click(); a.remove();
    }
}

/* =========================================================
   初始化
   ========================================================= */
let _resumeWorkerListener = null;
function resumeRunningTask() {
    if (!TaskWorker.isSupported()) return;
    const types = ['delete', 'download'];
    for (const ttype of types) {
        const t = TaskWorker.getTask(ttype);
        if (t && t.status === 'running') {
            _mode = ttype;
            resetProgressUI();
            setProgress(t.progress, t.curFile, t.step, { stat: t.extraStat || '', remaining: t.total - t.done - t.skipped - t.failed });
            toast(`检测到后台进行中的${ttype === 'delete' ? '删除' : ttype === 'download' ? '下载' : '上传'}任务，已恢复进度显示`, 'info');
            if (_resumeWorkerListener) _resumeWorkerListener();
            _resumeWorkerListener = TaskWorker.onMessage((msg) => {
                if (msg.type === 'task-update' && msg.task && msg.task.type === ttype) {
                    const tt = msg.task;
                    setProgress(tt.progress, tt.curFile, tt.step, { stat: tt.extraStat || '', remaining: tt.total - tt.done - tt.skipped - tt.failed });
                }
                if (msg.type === 'task-clear' && msg.taskType === ttype) {
                    setTimeout(() => { resetProgressUI(); _mode = 'upload'; }, 2500);
                    if (_resumeWorkerListener) { _resumeWorkerListener(); _resumeWorkerListener = null; }
                }
                if (msg.type === 'delete-complete') {
                    (async () => {
                        await Store.load(true);
                        exitMulti();
                        renderMasonry();
                    })();
                }
                if (msg.type === 'download-complete' && msg.zipUrl) {
                    downloadUrl(msg.zipUrl, msg.fileName || 'download.zip');
                    setTimeout(() => URL.revokeObjectURL(msg.zipUrl), 60000);
                    toast('下载完成', 'success');
                }
            });
            return;
        }
    }
}

(async function init() {
    try {
        const q = new URLSearchParams(location.search).get('api');
        if (q) CONFIG.API_BASE = q;
    } catch (e) { }
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