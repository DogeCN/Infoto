/* =========================================================
 * 批量下载：SharedWorker 后台打包 zip / 主线程 JSZip 回退（可动态追加）
 * 依赖：icons.js、store.js、ui.js、masonry.js、task-worker.js、shared.js
 * ========================================================= */
// JSZip 用动态 import（项目零 npm 依赖），首次用到才加载
let _jszip = null;
async function getZipLib() {
    if (_jszip) return _jszip;
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    _jszip = JSZip;
    return _jszip;
}

let _downloadWorkerListener = null;
let _downloadMainRunner = null; // 页面级：进行中的主线程下载批次（再触发下载 → append 合并）
$('#batchDownloadBtn').addEventListener('click', async () => {
    const list = getSorted().filter(p => state.selected.has(p.id));
    if (list.length === 0) { toast('请先选择照片'); return; }
    if (list.length === 1) {
        exitMulti(); // 下载触发后退出多选
        return downloadUrl(list[0].url + '?dl=1', dlName(list[0]));
    }

    if (TaskWorker.isSupported()) {
        // 已有下载任务进行中 → 动态追加（不再新开任务竞争进度环）
        const cur = TaskWorker.getTask('download');
        if (cur && cur.status === 'running') {
            TaskWorker.appendDownload(list, apiBase(), TAB_ID);
            exitMulti();
            return;
        }
        if (TaskWorker.startDownload(list, apiBase(), TAB_ID)) {
            resetProgressUI('download');
            if (_downloadWorkerListener) _downloadWorkerListener();
            _downloadWorkerListener = TaskWorker.onMessage((msg) => {
                if (msg.type === 'error') {
                    toast(msg.error || '下载启动失败', 'alert');
                    resetProgressUI('download');
                    if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
                    return;
                }
                if (msg.type === 'task-update' && msg.task && msg.task.type === 'download') {
                    applyTaskUpdate(msg.task);
                }
                if (msg.type === 'download-complete' && msg.zipUrl) {
                    // 多标签页去重：仅发起页弹下载，其他页提示即可（zip blob URL 各页共享，双端弹窗重复）
                    if (msg.tabId && msg.tabId !== TAB_ID) {
                        toast('已在其他页面完成下载', 'info');
                        setProgress(1, msg.fileName || 'download.zip', '完成', null, 'download');
                        exitMulti(); // 本页若在多选，下载结束一并退出
                        scheduleProgressFade('download');
                        if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
                        return;
                    }
                    downloadUrl(msg.zipUrl, msg.fileName || 'download.zip');
                    setTimeout(() => URL.revokeObjectURL(msg.zipUrl), 60000);
                    setProgress(1, msg.fileName || 'download.zip', '完成', null, 'download');
                    exitMulti();
                    scheduleProgressFade('download');
                    if (_downloadWorkerListener) { _downloadWorkerListener(); _downloadWorkerListener = null; }
                }
            });
            return;
        }
    }

    // 主线程下载回退：合并到进行中的批次
    if (_downloadMainRunner && _downloadMainRunner.running) { _downloadMainRunner.append(list); exitMulti(); return; }
    const runner = { running: true, append: null, done: null };
    _downloadMainRunner = runner;

    const JSZip = await getZipLib();
    const zip = new JSZip();

    // 下载/打包进度由 shared.js createDownloadProgress 统一汇总（与 DownloadTask 同一实现），
    // dlp 支持 append 动态扩项；fetch 用动态队列，运行中可追加
    const dlp = createDownloadProgress(list.length, (s) => {
        setProgress(s.progress, s.curFile, s.step, { stat: s.extraStat, remaining: s.total - s.done }, 'download');
    });
    const q = createTaskQueue(CONFIG.CONCURRENCY);
    let successCount = 0;

    const fetchOne = (p, i) => async () => {
        try {
            const base = dlName(p);
            const { blob, total: t } = await fetchWithProgress(
                p.url,
                (loaded, tot) => dlp.onItemProgress(i, loaded, tot)
            );
            dlp.onItemDone(i, t || blob.size || 1);
            zip.file(base, blob, { binary: true });
            successCount++;
        } catch (e) {
            dlp.onItemFail(i);
            toast(`${dlName(p)} 下载失败`, 'alert');
        }
    };
    const enqueue = (p, i) => q.push(() => fetchOne(p, i));
    let _zipping = false;
    runner.append = (items) => {
        if (_zipping) { toast('正在打包 zip，暂不能追加', 'info'); return; }
        for (const p of items || []) {
            const i = dlp.append(1) - 1;
            enqueue(p, i);
        }
    };

    // 初始批次
    list.forEach((p, i) => enqueue(p, i));
    runner.done = (async () => {
        await q.idle();
        _zipping = true;
        if (successCount === 0) {
            toast('全部下载失败', 'alert');
            setProgress(1, null, '失败', { stat: null }, 'download');
            scheduleProgressFade('download');
            runner.running = false;
            if (_downloadMainRunner === runner) _downloadMainRunner = null;
            return;
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
            const p = meta.percent / 100;
            const failedCount = dlp.snapshot().total - successCount;
            const s = dlp.setZip(p, `${successCount}/${dlp.snapshot().total} 张成功${failedCount ? ` · ${failedCount} 张跳过` : ''} · zip ${meta.percent.toFixed(0)}%`);
            // zip 阶段补充更细的 curFile/step 文案（snapshot 只提供通用「打包 zip 中」）
            setProgress(
                s.progress,
                `生成 zip ${meta.percent.toFixed(0)}%`,
                failedCount ? `打包中（${successCount}/${dlp.snapshot().total} 张成功）` : '打包 zip…',
                { stat: s.extraStat, remaining: dlp.snapshot().total - successCount }
            );
        });
        dlp.setZip(1);

        const url = URL.createObjectURL(zipBlob);
        const finalName = 'download.zip';
        downloadUrl(url, finalName);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        exitMulti(); // 下载触发后退出多选

        const finalFailed = dlp.snapshot().total - successCount;
        const finalStat = `成功 ${successCount} 张${finalFailed ? ` · 跳过 ${finalFailed}` : ''} · zip ${formatSize(zipBlob.size)}`;
        setProgress(1, finalName, '完成', { stat: finalStat }, 'download');
        setTimeout(() => { resetProgressUI('download'); }, 3000);
        runner.running = false;
        if (_downloadMainRunner === runner) _downloadMainRunner = null;
    })();
});
