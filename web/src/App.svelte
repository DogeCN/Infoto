<script lang="ts">
  import EmptyState from '$lib/components/EmptyState.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import type { SortKey } from '$lib/components/SortTabs.svelte';
  import OverlaySidebar from '$lib/components/OverlaySidebar.svelte';
  import WaterfallLayout from '$lib/components/WaterfallLayout.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AnnouncementSidebar from '$lib/components/AnnouncementSidebar.svelte';
  import { onDestroy, onMount, tick } from 'svelte';

  import { Toaster, toast } from 'svelte-sonner';
  import { Settings as SettingsIcon, Megaphone, Upload } from '@lucide/svelte';
  import { toastOptions } from '$base/lib/ui';
  import { getEngine } from './core/engine';
  import {
    ensureIdentity,
    renderTurnstile,
    disposeTurnstile,
    TURNSTILE_DISPOSE_DELAY_MS,
  } from './core/identity';
  import { postSync, type SyncClientIo, type SyncCallResult } from './core/api/syncClient';
  import { createAppStore } from './state/appStore.svelte';
  import { downloadOne, downloadZip } from './core/download';
  import { createUploadStore } from './state/uploadStore.svelte';
  import type { Photo, SyncRequest } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import {
    type FilterSettings,
    type LayoutSettings,
    type Settings,
    applyFilters,
    loadSettings,
  } from './settings';

  /** Deduplicate sync failure toasts over ten seconds. */
  let lastSyncToastAt = 0;
  function notifySyncFailure(): void {
    const now = Date.now();
    if (now - lastSyncToastAt < 10_000) return;
    lastSyncToastAt = now;
    toast.error(copy.sync.failed, { description: copy.sync.queuedRetry });
  }

  const store = createAppStore();
  const engine = getEngine({
    postSyncFn: syncWithIdentity,
    onSyncResponse: (r, context) => {
      store.applySync(r, context);
    },
    onError: (phase, e) => {
      console.error('[sync]', phase, e);
      notifySyncFailure();
    },
  });
  store.bindEngine(engine);

  const uploads = createUploadStore(store, engine);
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let multiMode = $state(false);
  /** Wide layout: the upload panel moves to the bottom-right, clear of bottom-left toasts. */
  let wideLayout = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => (wideLayout = mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  /** Measured upload-panel height, zero while collapsed or hidden. A stable callback preserves its observer subscription. */
  let uploadPanelHeight = $state(0);
  const handleUploadPanelHeight = (px: number) => (uploadPanelHeight = px);

  /** Bottom toast clearance in pixels. Narrow layouts clear the upload panel; multi-select clears the bottom bar. */
  const TOAST_EDGE_GAP = 16;
  const MULTI_SELECT_CLEARANCE = 80;
  let toastOffsetBottom = $derived(
    multiMode
      ? MULTI_SELECT_CLEARANCE
      : uploads.panelRows.length > 0 && !wideLayout
        ? TOAST_EDGE_GAP + uploadPanelHeight
        : TOAST_EDGE_GAP,
  );

  // Layout settings (from SettingsPanel). Seeded from the same factory defaults the
  // panel persists against, so the first frame cannot disagree with a stored value.
  const loadedSettings = loadSettings();
  let layout = $state<LayoutSettings>(loadedSettings.layout);
  let filters = $state<FilterSettings>(loadedSettings.filters);
  let filterCount = $state(0);

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

  let verificationTimer: ReturnType<typeof setTimeout> | undefined;

  /** Inbound verification: after a 401 the captcha renders centered in the empty
   *  waterfall; `done` = token in, kept until the handshake ends. */
  type VerifyState = 'idle' | 'loading' | 'done';
  let verifyState = $state<VerifyState>('idle');
  let turnstileEl = $state<HTMLDivElement | undefined>(undefined);

  /** Resolve verification within the engine's single attempt, preserving its queued operations. */
  async function syncWithIdentity(
    request: SyncRequest,
    io?: SyncClientIo,
  ): Promise<SyncCallResult> {
    try {
      const { response, firstEntry } = await ensureIdentity(request.ops, {
        postSyncFn: (body) => postSync(body, io),
        requestToken: async (siteKey) => {
          if (destroyed) throw new Error('page_closed');
          verifyState = 'loading';
          await tick();
          const el = turnstileEl;
          if (!el || destroyed) throw new Error('turnstile container missing');
          return renderTurnstile(siteKey, el);
        },
      });
      if (firstEntry && !destroyed) {
        verifyState = 'done';
        verificationTimer = setTimeout(() => {
          void disposeTurnstile().finally(() => {
            if (!destroyed) verifyState = 'idle';
          });
        }, TURNSTILE_DISPOSE_DELAY_MS);
      }
      return { response, status: 200 };
    } catch (error) {
      clearTimeout(verificationTimer);
      void disposeTurnstile();
      if (!destroyed) verifyState = 'idle';
      throw error;
    }
  }

  onMount(() => {
    void engine.init().catch((error) => {
      console.error('[sync] init', error);
      notifySyncFailure();
    });
    engine.install();
    uploads.start();
  });

  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    store.dispose();
    clearTimeout(verificationTimer);
    void disposeTurnstile();
  });

  // Forward photo operations by SHA-256 to the optimistic store and durable operation log.
  /** Ids in a selection → the photos' hashes, resolved against both lists. */
  function shasOf(ids: number[]): string[] {
    const all = [...uploads.pendingPhotos, ...visiblePhotos];
    const out: string[] = [];
    for (const id of ids) {
      const sha = all.find((p) => p.id === id)?.sha256;
      if (sha) out.push(sha);
    }
    return out;
  }
  function handleLike(photo: Photo) {
    store.toggleMark(photo.sha256, 'like');
  }
  function handleDislike(photo: Photo) {
    store.toggleMark(photo.sha256, 'dislike');
  }
  function handleRequestDelete(photo: Photo) {
    store.toggleMark(photo.sha256, 'report');
  }
  function handleDelete(photo: Photo) {
    store.deletePhotos([photo.sha256]);
  }
  function handleDeleteSelected(ids: number[]) {
    const shas = shasOf(ids);
    if (shas.length === 0) return;
    store.deletePhotos(shas);
  }
  /** Bulk unmark: undo like / dislike / request-delete (unmarked items are idempotent no-ops). */
  function handleUnmarkSelected(ids: number[]) {
    const shas = shasOf(ids);
    if (shas.length === 0) return;
    store.setMarkMany(shas, 'like', false);
    store.setMarkMany(shas, 'dislike', false);
    store.setMarkMany(shas, 'report', false);
  }
  /** Downloads go through core/download: single files as {id36}.{ext}, multiple
   *  files packed into download.zip, numbered in current visible order. */
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

  // Skip visiblePhotos when only layout changed. settings.filters keeps the same
  // reference, and recomputing it reflows the waterfall.
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
      const orderedIds = new Set(randomOrder);
      const rest = list.filter((p) => !orderedIds.has(p.id));
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
  /** Top-bar "Random" clicked again → re-shuffle (Fisher-Yates, every click). */
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
    const files = input.files;
    if (!files || files.length === 0) return;
    uploads.addFiles(files);
    input.value = '';
  }
  /** Panel row remove button: cancel anywhere in the flow (queue, token wait, transcode). */
  function handleRemoveUpload(jobId: string) {
    uploads.cancel(jobId);
  }
  function handleSync() {
    void engine.sync();
  }

  // Announcement ops: react / vote / feedback → op-log → /sync pipeline
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
  <OverlaySidebar bind:open={leftOpen} side="left" title={copy.sidebar.settingsTitle}>
    {#snippet icon()}
      <SettingsIcon class="size-5 text-primary" />
    {/snippet}
    <SettingsPanel
      onSettingsChange={handleSettingsChange}
      photos={store.photos}
      onFilterCount={(n) => (filterCount = n)}
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
      pendingCount={store.engineState.pending}
      {filterCount}
      isSyncing={store.engineState.syncing}
      settingsActive={leftOpen}
      announcementActive={rightOpen}
      multiSelectActive={multiMode}
    />

    <main class="relative flex-1 overflow-hidden">
      <!-- Verification fades out after the snapshot arrives and the widget is disposed. -->
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

      <!-- Uploads must stay visible even on an empty album: the first upload of a
           new account would land in this branch with nowhere to render, and a
           failed first upload needs its retry card. -->
      {#if visiblePhotos.length === 0 && uploads.pendingPhotos.length === 0}
        <EmptyState
          icon={Upload}
          text={store.photos.length === 0 ? copy.gallery.empty : copy.gallery.emptyFiltered}
          hint={store.photos.length === 0 ? copy.gallery.emptyHint : copy.gallery.emptyFilteredHint}
        />
      {:else}
        <WaterfallLayout
          photos={visiblePhotos}
          pending={uploads.pendingPhotos}
          overlays={uploads.overlays}
          onRetryUpload={uploads.retry}
          onDismissUpload={uploads.dismiss}
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
  <OverlaySidebar bind:open={rightOpen} side="right" title={copy.sidebar.announcementsTitle}>
    {#snippet icon()}
      <Megaphone class="size-5 text-primary" />
    {/snippet}
    <AnnouncementSidebar
      announcements={store.announcements}
      selfId={store.selfId}
      onReact={handleReact}
      onVote={handleVote}
      onFeedback={handleFeedback}
    />
  </OverlaySidebar>

  <!-- Upload progress: the transcode leg only (the card curtain carries the rest). -->
  <UploadPanel
    tasks={uploads.panelRows}
    progress={uploads.progress}
    onRemove={handleRemoveUpload}
    onHeight={handleUploadPanelHeight}
    hidden={multiMode}
  />

  <!-- Toast notifications: bottom-left (keeps image subjects clear); color, radius, and font all use site tokens -->
  <!-- No close button: a swipe dismisses the toast (sonner's own gesture). -->
  <!-- Expanded toast stack with measured clearance above the upload panel or selection bar. -->
  <Toaster
    class="toast-stack"
    position="bottom-left"
    theme="dark"
    richColors
    expand
    offset={{ bottom: toastOffsetBottom, left: '1rem' }}
    {toastOptions}
  />
</div>
