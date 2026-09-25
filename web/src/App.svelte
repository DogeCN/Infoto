<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import type { SortKey } from '$lib/components/SortTabs.svelte';
  import OverlaySidebar from '$lib/components/OverlaySidebar.svelte';
  import WaterfallLayout from '$lib/components/WaterfallLayout.svelte';
  import UploadProgressPanel from '$lib/components/UploadProgressPanel.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AnnouncementSidebar from '$lib/components/AnnouncementSidebar.svelte';
  import { tick } from 'svelte';
  import { Toaster, toast } from 'svelte-sonner';
  import { Settings as SettingsIcon, Megaphone } from '@lucide/svelte';
  import { getEngine } from './core/sync/engine';
  import {
    ensureIdentity,
    renderTurnstile,
    disposeTurnstile,
    TURNSTILE_DISPOSE_DELAY_MS,
  } from './core/identity';
  import { postSync, TurnstileRequiredError } from './core/api/syncClient';
  import { createAppStore } from './state/appStore.svelte';
  import { downloadOne, downloadZip } from './core/download';
  import { UploadPipeline, type PipelineTaskSnapshot } from './transcode/pipeline';
  import type { Photo } from '$shared/types';
  import type { FilterSettings, LayoutSettings, Settings } from './settings';
  import { applyFilters, defaultFilterSettings } from './settings';

  /**
   * 同步失败可见化：原来只 console.error，用户看到的是"点了没反应"。
   * 10s 去重 —— 后端躺平时每轮重试都会失败，不去重会把 toast 刷屏。
   */
  let lastSyncToastAt = 0;
  function notifySyncFailure(): void {
    const now = Date.now();
    if (now - lastSyncToastAt < 10_000) return;
    lastSyncToastAt = now;
    toast.error('同步失败', { description: '操作已排队，稍后自动重试' });
  }

  // store 先建：引擎把 /sync 全量快照直接写进 store（契约：服务端下发为准）
  const store = createAppStore();
  const engine = getEngine({
    onSyncResponse: (r, context) => store.applySync(r, context),
    onError: (phase, e) => {
      console.error('[sync]', phase, e);
      // Cookie 丢失/过期 → 回到首次入站流程（Turnstile 渲染由 ensureIdentity 承担）
      if (e instanceof TurnstileRequiredError) void bootstrapIdentity();
      else notifySyncFailure();
    },
  });
  store.bindEngine(engine);

  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log('[upload]', line),
    // 上传产物 URL 落成 upload op 后交给同步引擎入队（pending 计数与 256
    // 条阈值都归引擎，契约「所有写操作走 op-log → /sync 管线」）
    onUploadOp: (op) => void engine.addOp(op),
  });

  let uploadTasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);

  // ---- 上传乐观条目（契约「上传期间的瀑布流呈现」） ------------------------------
  // 转码完成（进入上传阶段）即以乐观条目插入瀑布流最前；卡片上覆盖"窗帘"遮罩
  // 随上传进度自下而上拉开；失败变回全遮罩 + 重试图标；/sync 全量下发后按
  // sha256 移除乐观条目，以服务端状态为准。
  let nextTempId = -1;
  const tempIdByJob = new Map<string, number>();
  const jobByTempId = new Map<number, string>();

  let pendingPhotos = $derived.by(() => {
    const out: Photo[] = [];
    for (const t of uploadTasks.values()) {
      if (!['uploading', 'done', 'failed'].includes(t.phase)) continue;
      // tempId 在 onTask 回调里统一分配，这里必已存在
      const id = tempIdByJob.get(t.jobId)!;
      // 转码失败的任务没有 meta（读不到宽高）：给占位比例让失败可见 ——
      // 契约要求"失败标记该文件 + 卡片提供手动重试按钮"，不能静默消失
      const meta = t.meta ?? { width: 800, height: 600, size: 0, type: 0 as const };
      out.push({
        id,
        sha256: t.sha256 ?? '',
        url: t.url ?? '',
        uploader: store.selfId,
        width: meta.width,
        height: meta.height,
        size: meta.size,
        createdAt: Date.now(),
        type: meta.type,
        likes: [],
        dislikes: [],
        reports: [],
      });
    }
    return out;
  });

  let uploadOverlays = $derived.by(() => {
    const m = new Map<number, { fraction?: number; failed?: boolean }>();
    for (const t of uploadTasks.values()) {
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      if (t.phase === 'uploading') {
        if (t.meta) m.set(id, { fraction: t.fraction ?? 0 });
      } else if (t.phase === 'failed') {
        // 转码失败（无 meta）同样要挂失败遮罩 —— 重试入口不能依赖转码成功
        m.set(id, { failed: true });
      }
      // done → 无遮罩（窗帘已全开，等 /sync 校正）
    }
    return m;
  });

  // /sync 后真实条目到位：按 sha256 摘掉对应乐观条目
  $effect(() => {
    const shas = new Set(store.photos.map((p) => p.sha256));
    let changed = false;
    for (const t of uploadTasks.values()) {
      if (t.sha256 && shas.has(t.sha256)) {
        const id = tempIdByJob.get(t.jobId);
        if (id !== undefined) {
          tempIdByJob.delete(t.jobId);
          jobByTempId.delete(id);
        }
        const next = new Map(uploadTasks);
        next.delete(t.jobId);
        uploadTasks = next;
        changed = true;
      }
    }
    void changed;
  });

  function handleRetryUpload(photo: Photo) {
    const jobId = jobByTempId.get(photo.id);
    if (jobId) pipeline.retry(jobId);
  }

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let multiMode = $state(false);
  let initialized = $state(false);

  // 布局设置（来自 SettingsPanel）
  let layout = $state<LayoutSettings>({
    dir: 'v',
    strategy: 'sequential',
    band: 320,
    gap: 12,
  });
  // 筛选设置（来自 SettingsPanel，用于过滤瀑布流）
  let filters = $state<FilterSettings>(defaultFilterSettings());
  let filterCount = $state(0);
  let resetToken = $state(0);

  // 排序状态：latest / hottest / random；方向按 key 各自记忆——切到别的排序项
  // 再切回来，方向不丢（最新↔最旧、最热↔最冷 独立保存）
  let sortKey = $state<SortKey>('latest');
  let latestAsc = $state(false);
  let hottestAsc = $state(false);
  let sortDirs = $derived<Partial<Record<SortKey, boolean>>>({
    latest: latestAsc,
    hottest: hottestAsc,
    random: false,
  });
  let randomOrder = $state<number[]>([]);

  let bootstrapping = false;

  /**
   * 入站验证态。新用户（无 Cookie）在服务端 401 后进 loading：验证码渲染在瀑布流
   * 区域中央 —— 那里本来就是空的，还直接表达"通过验证才能看"，不必再单开一层
   * 盖住整个应用（那样顶栏、侧栏、骨架都被挡住，看着像首屏卡住）。
   *
   * 不做额外的失败 UI：widget 失败后留在原地 —— Turnstile 交互式 widget 失败时
   * 自带可点击的重试，timeout 后默认还会自动重试，用户也可以直接刷新。
   *
   * done = token 已拿到，验证层淡出但节点先留着：Turnstile iframe 的收尾握手还没
   * 发完，dispose 之前摘 DOM 会留下悬空 widget（控制台刷 "Cannot find Widget"）。
   */
  type VerifyState = 'idle' | 'loading' | 'done';
  let verifyState = $state<VerifyState>('idle');
  let turnstileEl = $state<HTMLDivElement | undefined>(undefined);

  /** 首次入站（无 Cookie）：Turnstile → 带 token 的 /sync → 建身份 + 全量下发。 */
  async function bootstrapIdentity() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const { response, firstEntry } = await ensureIdentity([], {
        postSyncFn: postSync,
        requestToken: async (siteKey) => {
          verifyState = 'loading';
          await tick(); // 等验证态的挂载点渲染出来，再往里渲染 widget
          const el = turnstileEl;
          if (!el) throw new Error('turnstile container missing');
          const token = await renderTurnstile(siteKey, el);
          // 仅成功路径安排销毁；失败路径让 widget 留在原地自愈或等用户刷新
          setTimeout(() => {
            void disposeTurnstile().finally(() => {
              if (verifyState === 'done') verifyState = 'idle';
            });
          }, TURNSTILE_DISPOSE_DELAY_MS);
          return token;
        },
      });
      store.applySync(response);
      // 内容就位之后再收起验证层，避免中间闪一帧"还没有照片"的空态
      if (firstEntry && verifyState === 'loading') verifyState = 'done';
    } catch (e) {
      console.error('[identity] bootstrap failed', e);
    } finally {
      bootstrapping = false;
    }
  }

  $effect(() => {
    if (initialized) return;
    initialized = true;
    void (async () => {
      await bootstrapIdentity();
      await engine.init().catch(console.error);
      engine.install();
    })();
    pipeline.start();
    pipeline.onTask((t) => {
      // 乐观条目的 tempId 统一在这里分配：pendingPhotos 与 uploadOverlays 两个
      // derived 都读它，事件回调先于任何 derived 求值，顺序无关
      if (['uploading', 'done', 'failed'].includes(t.phase) && !tempIdByJob.has(t.jobId)) {
        const id = nextTempId--;
        tempIdByJob.set(t.jobId, id);
        jobByTempId.set(id, t.jobId);
      }
      uploadTasks = new Map(uploadTasks.set(t.jobId, t));
    });
  });

  // 照片标记 / 删除：store 负责本地乐观更新 + 提交 op（契约：所有写操作走 op-log）
  function handleLike(photo: Photo) {
    store.toggleMark(photo.id, 'like');
  }
  function handleDislike(photo: Photo) {
    store.toggleMark(photo.id, 'dislike');
  }
  function handleRequestDelete(photo: Photo) {
    store.toggleMark(photo.id, 'report');
  }
  function handleDelete(photo: Photo) {
    store.deletePhotos([photo.id]);
  }
  function handleDeleteSelected(ids: number[]) {
    store.deletePhotos(ids);
  }
  /** 批量取消标记：撤销喜欢 / 不喜欢 / 请求删除（未标记的项为幂等 no-op）。 */
  function handleUnmarkSelected(ids: number[]) {
    store.setMarkMany(ids, 'like', false);
    store.setMarkMany(ids, 'dislike', false);
    store.setMarkMany(ids, 'report', false);
  }
  /**
   * 下载走 core/download：单张 {id36}.{ext}，多张打包 download.zip
   * （契约「下载」）。多张按当前可见顺序编号。
   */
  async function handleDownloadSelected(ids: number[]) {
    const picked = visiblePhotos.filter((p) => ids.includes(p.id));
    if (picked.length === 0) return;
    try {
      if (picked.length === 1) await downloadOne(picked[0]!);
      else await downloadZip(picked);
    } catch (e) {
      console.error('[download]', e);
    }
  }
  async function handleDownload(photo: Photo) {
    try {
      await downloadOne(photo);
    } catch (e) {
      console.error('[download]', photo.id, e);
    }
  }

  // 上一次传入的 filters 引用：layout-only 变更时 settings.filters 是 spread 保留的同一引用，
  // 不应触发 visiblePhotos 重算 → 瀑布流重排（卡死根源之一）。
  let _prevFilterRef: import('./settings').FilterSettings | undefined;
  function handleSettingsChange(s: Settings) {
    layout = {
      dir: s.layout.dir,
      strategy: s.layout.strategy,
      band: s.layout.band,
      gap: s.layout.gap,
    };
    // 仅当 filters 对象引用真正变化时才更新（layout-only 变更不触发）
    if (s.filters !== _prevFilterRef) {
      _prevFilterRef = s.filters;
      filters = { ...s.filters, types: new Set(s.filters.types) };
    }
  }

  // 排序 + 筛选 → 最终给瀑布流的照片（筛选逻辑在 settings.ts，纯函数可测）
  let visiblePhotos = $derived.by(() => {
    let list = applyFilters(store.photos, filters, store.selfId);

    if (sortKey === 'latest') {
      list = [...list].sort((a, b) =>
        latestAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt,
      );
    } else if (sortKey === 'hottest') {
      const heat = (p: (typeof list)[number]) => p.likes.length - p.dislikes.length;
      list = [...list].sort((a, b) => (hottestAsc ? heat(a) - heat(b) : heat(b) - heat(a)));
    } else {
      // random：按当前打乱序号重排
      const map = new Map(list.map((p) => [p.id, p]));
      const ordered = randomOrder
        .map((id) => map.get(id))
        .filter((p): p is (typeof list)[number] => !!p);
      const rest = list.filter((p) => !randomOrder.includes(p.id));
      list = [...ordered, ...rest];
    }
    return list;
  });

  function onSortChange(key: SortKey) {
    if (key === sortKey && key !== 'random') {
      // 再次单击 → 反向（最新↔最旧 / 最热↔最冷），方向按 key 各自记忆
      if (key === 'hottest') hottestAsc = !hottestAsc;
      else latestAsc = !latestAsc;
    } else if (key === 'random' && key === sortKey) {
      randomOrder = shuffle(store.photos.map((p) => p.id)); // 重新打乱
    } else {
      // 切换排序项：保留该项上次的方向，不重置
      sortKey = key;
      if (key === 'random') randomOrder = shuffle(store.photos.map((p) => p.id));
    }
  }

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  /** 顶栏「随机」再次单击 → 重新打乱（契约：每次单击重新打乱，Fisher-Yates）。 */
  function handleReshuffle() {
    randomOrder = shuffle(store.photos.map((p) => p.id));
    sortKey = 'random';
  }

  function toggleLeft() {
    leftOpen = !leftOpen;
    if (leftOpen) rightOpen = false;
  }
  function toggleRight() {
    rightOpen = !rightOpen;
    if (rightOpen) leftOpen = false;
  }
  function handleMultiSelect() {
    multiMode = !multiMode;
  }
  function handleMultiModeChange(v: boolean) {
    multiMode = v;
  }
  function handleUploadClick() {
    fileInputEl?.click();
  }
  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      pipeline.addFiles(input.files);
      input.value = '';
    }
  }
  function handleSync() {
    void engine.sync();
  }
  function handleFilterReset() {
    resetToken++;
  }

  // 公告 op：反应 / 投票 / 反馈 → op-log（spec：全部写操作走 op-log → /sync 管线）
  function handleReact(annId: number, emoji: string | null) {
    store.react(annId, emoji);
  }
  function handleVote(annId: number, option: number | null) {
    store.vote(annId, option);
  }
  function handleFeedback(contentMd: string) {
    store.fbCreate(contentMd);
  }
</script>

<input
  bind:this={fileInputEl}
  type="file"
  accept="image/*,video/*"
  multiple
  class="hidden"
  onchange={handleFileChange}
/>

<div class="flex h-screen overflow-hidden bg-background">
  <!-- Left Sidebar (Settings) -->
  <OverlaySidebar bind:open={leftOpen} side="left" title="设置">
    {#snippet icon()}
      <SettingsIcon class="size-5 text-primary" />
    {/snippet}
    <SettingsPanel
      onSettingsChange={handleSettingsChange}
      photos={store.photos}
      onFilterCount={(n) => (filterCount = n)}
      {resetToken}
    />
  </OverlaySidebar>

  <!-- Main Content -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <TopBar
      {sortKey}
      {sortDirs}
      {onSortChange}
      onSortReshuffle={handleReshuffle}
      onSettingsClick={toggleLeft}
      onSyncClick={handleSync}
      onAnnouncementClick={toggleRight}
      onMultiSelectClick={handleMultiSelect}
      onUploadClick={handleUploadClick}
      onFilterBadgeClick={handleFilterReset}
      pendingCount={store.engineState.pending}
      {filterCount}
      isSyncing={store.engineState.syncing}
      settingsActive={leftOpen}
      announcementActive={rightOpen}
      multiSelectActive={multiMode}
    />

    <main class="relative flex-1 overflow-hidden">
      <!-- 入站验证：新用户的瀑布流本来就是空的，验证码就居中放在这个位置。
           淡出后才卸载节点（widget 必须先销毁），期间下方内容已经可以被看到。 -->
      {#if verifyState !== 'idle'}
        <div
          data-verify
          class="absolute inset-0 z-10 grid place-items-center bg-background transition-opacity duration-300 ease-[var(--ease-exit)] {verifyState ===
          'done'
            ? 'pointer-events-none opacity-0'
            : 'opacity-100'}"
        >
          <!-- Turnstile 挂载点：固定最小高度，widget 加载完不跳动 -->
          <div bind:this={turnstileEl} class="min-h-[65px]"></div>
        </div>
      {/if}

      {#if visiblePhotos.length === 0}
        <div
          class="flex flex-col items-center justify-center py-24 text-center"
          style="animation: fadeInUp var(--duration-enter) var(--ease-enter) both"
        >
          <div class="mb-6">
            <svg
              class="size-12 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <p class="text-lg font-medium tracking-[-0.02em] text-foreground/85">
            {store.photos.length === 0 ? '还没有照片' : '没有符合筛选的照片'}
          </p>
          <p class="mt-1.5 text-sm text-muted-foreground">
            {store.photos.length === 0 ? '点击右上角上传你的第一张照片' : '试试调整筛选条件'}
          </p>
        </div>
      {:else}
        <WaterfallLayout
          photos={visiblePhotos}
          pending={pendingPhotos}
          overlays={uploadOverlays}
          onRetryUpload={handleRetryUpload}
          selfId={store.selfId}
          dir={layout.dir}
          strategy={layout.strategy}
          band={layout.band}
          gap={layout.gap}
          bind:multiMode
          onMultiModeChange={handleMultiModeChange}
          onLike={handleLike}
          onDislike={handleDislike}
          onRequestDelete={handleRequestDelete}
          onDelete={handleDelete}
          onDeleteSelected={handleDeleteSelected}
          onDownloadSelected={handleDownloadSelected}
          onUnmarkSelected={handleUnmarkSelected}
          onDownload={handleDownload}
        />
      {/if}
    </main>
  </div>

  <!-- Right Sidebar (Announcements) -->
  <OverlaySidebar bind:open={rightOpen} side="right" title="公告">
    {#snippet icon()}
      <Megaphone class="size-5 text-primary" />
    {/snippet}
    <AnnouncementSidebar
      announcements={store.announcements ?? []}
      selfId={store.selfId}
      onReact={handleReact}
      onVote={handleVote}
      onFeedback={handleFeedback}
    />
  </OverlaySidebar>

  <!-- Upload progress -->
  <div class="fixed bottom-4 right-4 z-30 w-72">
    <UploadProgressPanel tasks={uploadTasks} />
  </div>

  <!-- Toast 通知：左下角（不压图片主体），配色/圆角/字体全部对齐站点令牌 -->
  <Toaster
    position="bottom-left"
    theme="dark"
    richColors
    offset={{ bottom: '1rem', left: '1rem' }}
    toastOptions={{
      style: [
        // 表面与描边走站点令牌，richColors 的四种状态也只染边框与图标色
        '--normal-bg: var(--color-popover)',
        '--normal-bg-hover: var(--color-surface-top)',
        '--normal-border: var(--color-border)',
        '--normal-border-hover: var(--color-primary)',
        '--normal-text: var(--color-foreground)',
        '--success-bg: var(--color-popover)',
        '--success-border: rgba(16, 185, 129, 0.45)',
        '--success-text: var(--color-success)',
        '--info-bg: var(--color-popover)',
        '--info-border: rgba(34, 211, 238, 0.45)',
        '--info-text: var(--color-primary)',
        '--warning-bg: var(--color-popover)',
        '--warning-border: rgba(245, 158, 11, 0.45)',
        '--warning-text: var(--color-warning)',
        '--error-bg: var(--color-popover)',
        '--error-border: rgba(244, 63, 94, 0.45)',
        '--error-text: var(--color-destructive)',
        '--border-radius: 14px',
        '--width: min(20rem, calc(100vw - 2rem))',
        'padding: 11px 14px',
        'font-family: "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif',
        'box-shadow: var(--shadow-lg)',
        'backdrop-filter: blur(12px)',
      ].join(';'),
    }}
  />
</div>
