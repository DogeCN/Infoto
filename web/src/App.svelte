<script lang="ts">
  import EmptyState from '$lib/components/EmptyState.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import OverlaySidebar from '$lib/components/OverlaySidebar.svelte';
  import WaterfallLayout from '$lib/components/WaterfallLayout.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import type { LayoutPreviewControl } from '$lib/components/SettingsPanel.svelte';
  import AnnouncementSidebar from '$lib/components/AnnouncementSidebar.svelte';
  import GithubMark from '$lib/components/GithubMark.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { onDestroy, onMount, tick } from 'svelte';

  import { Toaster, toast } from 'svelte-sonner';
  import { Settings as SettingsIcon, Megaphone, Upload } from '@lucide/svelte';
  import { toastOptions } from '$base/lib/ui';
  import { getEngine } from './core/engine';
  import { shuffle, sortPhotos, type SortDirections, type SortKey } from './core/gallery';
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
  import type { LocaleCode, Photo, SyncRequest } from '$shared/types';
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
  let layoutPreview = $state<LayoutPreviewControl>(null);
  let multiMode = $state(false);

  /** Measured upload-panel geometry, zero-height while collapsed or hidden. A stable callback
   *  preserves the panel's observer subscription; the edge and height come from the panel's
   *  own ResizeObserver, so clearance follows the panel rather than a viewport breakpoint. */
  let uploadPanelHeight = $state(0);
  let uploadPanelAtLeftEdge = $state(false);
  const handleUploadPanelGeometry = (geometry: { height: number; atLeftEdge: boolean }) => {
    uploadPanelHeight = geometry.height;
    uploadPanelAtLeftEdge = geometry.atLeftEdge;
  };

  /** Bottom toast clearance in pixels. A panel flush with the left edge covers the toast
   *  column; multi-select clears the bottom bar. */
  const TOAST_EDGE_GAP = 16;
  const MULTI_SELECT_CLEARANCE = 80;
  let toastOffsetBottom = $derived(
    multiMode
      ? MULTI_SELECT_CLEARANCE
      : uploads.panelRows.length > 0 && uploadPanelAtLeftEdge
        ? TOAST_EDGE_GAP + uploadPanelHeight
        : TOAST_EDGE_GAP,
  );

  // Persisted layout and filter state.
  const loadedSettings = loadSettings();
  let layout = $state<LayoutSettings>(loadedSettings.layout);
  let filters = $state<FilterSettings>(loadedSettings.filters);
  let filterCount = $state(0);

  // Keep chronological and reaction sort directions independently.
  let sortKey = $state<SortKey>('latest');
  let latestAsc = $state(false);
  let hottestAsc = $state(false);
  let sortDirs = $derived<SortDirections>({
    latest: latestAsc,
    hottest: hottestAsc,
    random: false,
  });
  let randomOrder = $state<number[]>([]);

  let verificationTimer: ReturnType<typeof setTimeout> | undefined;

  /** State for the identity verification overlay. */
  type VerifyState = 'idle' | 'loading' | 'done';
  let verifyState = $state<VerifyState>('idle');
  let turnstileEl = $state<HTMLDivElement | undefined>(undefined);

  /** Retry a sync request with an identity token when required. */
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
  /** Resolve selected card IDs to photo hashes. */
  function shasOf(ids: number[]): string[] {
    const selected = new Set(ids);
    const shas = new Set<string>();
    for (const photo of [...uploads.pendingPhotos, ...visiblePhotos]) {
      if (selected.has(photo.id)) shas.add(photo.sha256);
    }
    return [...shas];
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
  /** Clear every mark from the selected photos. */
  function handleUnmarkSelected(ids: number[]) {
    const shas = shasOf(ids);
    if (shas.length === 0) return;
    store.setMarkMany(shas, 'like', false);
    store.setMarkMany(shas, 'dislike', false);
    store.setMarkMany(shas, 'report', false);
  }
  /** Download one photo or package the current selection. */
  async function handleDownloadSelected(ids: number[]) {
    const selected = new Set(ids);
    const picked = visiblePhotos.filter((photo) => selected.has(photo.id));
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

  let previousFilterSettings: FilterSettings | undefined;
  function handleSettingsChange(s: Settings) {
    layout = {
      dir: s.layout.dir,
      strategy: s.layout.strategy,
      band: s.layout.band,
      gap: s.layout.gap,
    };
    if (s.filters !== previousFilterSettings) {
      previousFilterSettings = s.filters;
      filters = { ...s.filters, types: new Set(s.filters.types) };
    }
  }

  let visiblePhotos = $derived.by(() =>
    sortPhotos(applyFilters(store.photos, filters, store.selfId), sortKey, sortDirs, randomOrder),
  );

  function onSortChange(key: SortKey) {
    if (key === sortKey) {
      if (key === 'hottest') hottestAsc = !hottestAsc;
      else if (key === 'latest') latestAsc = !latestAsc;
      return;
    }
    sortKey = key;
    if (key === 'random') randomOrder = shuffle(store.photos.map((photo) => photo.id));
  }

  function handleReshuffle() {
    randomOrder = shuffle(store.photos.map((photo) => photo.id));
    sortKey = 'random';
  }

  function toggleLeft() {
    leftOpen = !leftOpen;
    if (!leftOpen) layoutPreview = null;
    if (leftOpen) rightOpen = false;
  }
  function toggleRight() {
    rightOpen = !rightOpen;
    if (rightOpen) {
      leftOpen = false;
      layoutPreview = null;
    }
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
  /** Cancel an upload from any pipeline stage. */
  function handleRemoveUpload(jobId: string) {
    uploads.cancel(jobId);
  }
  function handleSync() {
    void engine.sync();
  }

  /** The snapshot already carries every locale, so a language change is a local re-render. */
  function handleLocaleChange(locale: LocaleCode) {
    store.setContentLocale(locale);
  }

  // Submit announcement reactions, poll votes, and feedback.
  function handleReact(annId: number, emoji: string | null) {
    store.react(annId, emoji);
  }
  function handleVote(pollId: number, options: number[]) {
    store.vote(pollId, options);
  }
  function handleFeedback(contentMd: string) {
    store.fbCreate(contentMd, store.contentLocale);
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

<div class="flex h-dvh overflow-hidden bg-background">
  <!-- Left Sidebar (Settings) -->
  <OverlaySidebar
    bind:open={leftOpen}
    side="left"
    title={copy.sidebar.settingsTitle}
    previewTransparent={layoutPreview !== null}
  >
    {#snippet icon()}
      <SettingsIcon class="size-5 text-primary" />
    {/snippet}
    {#snippet footer()}
      <!-- Subtle source link pinned to the sidebar's bottom-left. -->
      <Tooltip text={copy.sidebar.sourceOnGitHub} side="top">
        <a
          href="https://github.com/DogeCN/Infoto"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={copy.sidebar.sourceOnGitHub}
          class="inline-flex rounded-md text-muted-foreground/50 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:text-foreground"
        >
          <GithubMark class="size-4" />
        </a>
      </Tooltip>
    {/snippet}
    <SettingsPanel
      onSettingsChange={handleSettingsChange}
      photos={store.photos}
      onFilterCount={(n) => (filterCount = n)}
      onLocaleChange={handleLocaleChange}
      onLayoutPreviewChange={(control) => (layoutPreview = control)}
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
          class="absolute inset-0 z-10 grid place-items-center bg-background transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {verifyState ===
          'done'
            ? 'pointer-events-none opacity-0'
            : 'opacity-100'}"
        >
          <!-- Turnstile mount point: fixed min height so the layout doesn't jump when the widget loads -->
          <div bind:this={turnstileEl} class="min-h-[65px]"></div>
        </div>
      {/if}

      <!-- Keep upload cards visible while the gallery has no settled photos. -->
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
  <OverlaySidebar
    bind:open={rightOpen}
    side="right"
    title={copy.sidebar.announcementsTitle}
    previewTransparent={layoutPreview !== null}
  >
    {#snippet icon()}
      <Megaphone class="size-5 text-primary" />
    {/snippet}
    <AnnouncementSidebar
      announcements={store.announcements}
      polls={store.polls}
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
    onGeometry={handleUploadPanelGeometry}
    hidden={multiMode}
  />

  <!-- Toast placement accounts for the upload panel and selection bar. -->
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
