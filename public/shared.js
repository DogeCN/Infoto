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
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self));