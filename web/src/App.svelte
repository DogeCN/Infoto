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
   * Surface sync failures: before, only console.error ran, so users saw "nothing
   * happened". Deduped over 10s — while the backend is down every retry fails and
   * would flood the toast.
   */
  let lastSyncToastAt = 0;
  function notifySyncFailure(): void {
    const now = Date.now();
    if (now - lastSyncToastAt < 10_000) return;
    lastSyncToastAt = now;
    toast.error('同步失败', { description: '操作已排队，稍后自动重试' });
  }

  // Store first: the engine writes the full /sync snapshot straight into it
  // (contract: server-delivered state wins)
  const store = createAppStore();
  const engine = getEngine({
    onSyncResponse: (r, context) => store.applySync(r, context),
    onError: (phase, e) => {
      console.error('[sync]', phase, e);
      // Cookie lost/expired → return to the first-entry flow (ensureIdentity
      // handles Turnstile rendering)
      if (e instanceof TurnstileRequiredError) void bootstrapIdentity();
      else notifySyncFailure();
    },
  });
  store.bindEngine(engine);

  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log('[upload]', line),
    // Once the artifact URL becomes an upload op it is queued on the sync engine
    // (pending count and the 256-op threshold belong to the engine; contract: all
    // writes go through the op-log → /sync pipeline)
    onUploadOp: (op) => void engine.addOp(op),
  });

  let uploadTasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);

  // ---- Optimistic upload entries (contract: waterfall during upload) ----------
  // Transcode done → insert at the top under a "curtain" mask that pulls up with
  // progress; failure → full mask + retry icon; /sync drops it by sha256 (server wins).
  let nextTempId = -1;
  const tempIdByJob = new Map<string, number>();
  const jobByTempId = new Map<number, string>();

  let pendingPhotos = $derived.by(() => {
    const out: Photo[] = [];
    for (const t of uploadTasks.values()) {
      if (!['uploading', 'done', 'failed'].includes(t.phase)) continue;
      // tempId is assigned uniformly in the onTask callback; it must exist here
      const id = tempIdByJob.get(t.jobId)!;
      // Failed transcodes have no meta: use a placeholder ratio so the failure stays
      // visible — the contract wants a failure mark + manual retry button, not a
      // silent disappearance
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
        // Transcode failure (no meta) still gets a failure mask — retry must not
        // depend on a successful transcode
        m.set(id, { failed: true });
      }
      // done → no mask (curtain fully open, awaiting /sync correction)
    }
    return m;
  });

  // After /sync the real entries land: drop matching optimistic entries by sha256
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

  // Layout settings (from SettingsPanel)
  let layout = $state<LayoutSettings>({
    dir: 'v',
    strategy: 'sequential',
    band: 320,
    gap: 12,
  });
  // Filter settings (from SettingsPanel; used to filter the waterfall)
  let filters = $state<FilterSettings>(defaultFilterSettings());
  let filterCount = $state(0);
  let resetToken = $state(0);

  // Sort state: latest / hottest / random; each key remembers its own direction —
  // switching away and back keeps it (newest↔oldest, hottest↔coldest saved separately)
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
   * Inbound verification state: after a 401 the captcha renders centered in the empty
   * waterfall (no overlay, no failure UI — Turnstile retries itself). `done` = token in;
   * keep the node until the iframe handshake ends or the widget dangles.
   */
  type VerifyState = 'idle' | 'loading' | 'done';
  let verifyState = $state<VerifyState>('idle');
  let turnstileEl = $state<HTMLDivElement | undefined>(undefined);

  /** First entry (no cookie): Turnstile → /sync with token → build identity + full snapshot. */
  async function bootstrapIdentity() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const { response, firstEntry } = await ensureIdentity([], {
        postSyncFn: postSync,
        requestToken: async (siteKey) => {
          verifyState = 'loading';
          await tick(); // wait for the verify mount point to render, then mount the widget
          const el = turnstileEl;
          if (!el) throw new Error('turnstile container missing');
          const token = await renderTurnstile(siteKey, el);
          // Only the success path schedules disposal; on failure the widget stays
          // put to self-heal or wait for a user refresh
          setTimeout(() => {
            void disposeTurnstile().finally(() => {
              if (verifyState === 'done') verifyState = 'idle';
            });
          }, TURNSTILE_DISPOSE_DELAY_MS);
          return token;
        },
      });
      store.applySync(response);
      // Collapse the verify layer only after content lands, avoiding a one-frame
      // flash of the "no photos yet" empty state
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
      // Optimistic tempIds are assigned here — both pendingPhotos and uploadOverlays
      // deriveds read them; callbacks run before any derived evaluates, so order is safe
      if (['uploading', 'done', 'failed'].includes(t.phase) && !tempIdByJob.has(t.jobId)) {
        const id = nextTempId--;
        tempIdByJob.set(t.jobId, id);
        jobByTempId.set(id, t.jobId);
      }
      uploadTasks = new Map(uploadTasks.set(t.jobId, t));
    });
  });

  // Photo mark / delete: the store does the local optimistic update + submits the
  // op (contract: all writes go through the op-log)
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
  /** Bulk unmark: undo like / dislike / request-delete (unmarked items are idempotent no-ops). */
  function handleUnmarkSelected(ids: number[]) {
    store.setMarkMany(ids, 'like', false);
    store.setMarkMany(ids, 'dislike', false);
    store.setMarkMany(ids, 'report', false);
  }
  /**
   * Downloads go through core/download: single files as {id36}.{ext}, multiple
   * files packed into download.zip (contract: "Download"), numbered in current
   * visible order.
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

  // Previous filters reference: on layout-only changes settings.filters keeps the
  // same spread reference and must not recompute visiblePhotos → waterfall reflow
  // (one root cause of the freeze)
  let _prevFilterRef: import('./settings').FilterSettings | undefined;
  function handleSettingsChange(s: Settings) {
    layout = {
      dir: s.layout.dir,
      strategy: s.layout.strategy,
      band: s.layout.band,
      gap: s.layout.gap,
    };
    // Update only when the filters object reference actually changes (layout-only
    // changes don't trigger it)
    if (s.filters !== _prevFilterRef) {
      _prevFilterRef = s.filters;
      filters = { ...s.filters, types: new Set(s.filters.types) };
    }
  }

  // Sort + filter → the photos handed to the waterfall (filter logic lives in
  // settings.ts, pure and testable)
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
      // random: reorder by the current shuffled index
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
      // Click again → reverse (newest↔oldest / hottest↔coldest); direction
      // remembered per key
      if (key === 'hottest') hottestAsc = !hottestAsc;
      else latestAsc = !latestAsc;
    } else if (key === 'random' && key === sortKey) {
      randomOrder = shuffle(store.photos.map((p) => p.id)); // re-shuffle
    } else {
      // Switching sort keys: keep each key's last direction, don't reset it
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
  /** Top-bar "Random" clicked again → re-shuffle (contract: re-shuffle every click, Fisher-Yates). */
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

  // Announcement ops: react / vote / feedback → op-log (spec: all writes go through
  // the op-log → /sync pipeline)
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
      <!-- Inbound verification: a new user's waterfall is empty anyway, so the captcha sits
           centered here and the content below shows through the fade. The node unmounts only
           after the fade (widget disposed first). -->
      {#if verifyState !== 'idle'}
        <div
          data-verify
          class="absolute inset-0 z-10 grid place-items-center bg-background transition-opacity duration-300 ease-[var(--ease-exit)] {verifyState ===
          'done'
            ? 'pointer-events-none opacity-0'
            : 'opacity-100'}"
        >
          <!-- Turnstile mount point: fixed min height so the layout doesn't jump when the widget loads -->
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

  <!-- Toast notifications: bottom-left (keeps image subjects clear); color, radius, and font all use site tokens -->
  <Toaster
    position="bottom-left"
    theme="dark"
    richColors
    offset={{ bottom: '1rem', left: '1rem' }}
    toastOptions={{
      style: [
        // Surface and border use site tokens; richColors' four states tint only the
        // border and icon colors
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
