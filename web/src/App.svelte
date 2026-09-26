<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import type { SortKey } from '$lib/components/SortTabs.svelte';
  import OverlaySidebar from '$lib/components/OverlaySidebar.svelte';
  import WaterfallLayout from '$lib/components/WaterfallLayout.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AnnouncementSidebar from '$lib/components/AnnouncementSidebar.svelte';
  import { tick } from 'svelte';
  import { Toaster, toast } from 'svelte-sonner';
  import { Settings as SettingsIcon, Megaphone } from '@lucide/svelte';
  import { toastOptions } from '$lib/toastOptions';
  import { getEngine } from './core/engine';
  import {
    ensureIdentity,
    renderTurnstile,
    disposeTurnstile,
    TURNSTILE_DISPOSE_DELAY_MS,
  } from './core/identity';
  import { postSync, TurnstileRequiredError } from './core/api/syncClient';
  import { createAppStore } from './state/appStore.svelte';
  import { downloadOne, downloadZip } from './core/download';
  import { UploadPipeline, probeSourceSize, type PipelineTaskSnapshot } from './transcode/pipeline';
  import { translateTaskError } from '$base/upload/pipeline';
  import { readArtifact } from './transcode/opfs';
  import type { Photo } from '$shared/types';
  import { copy, fmt } from '$shared/copy';
  import type { FilterSettings, LayoutSettings, Settings } from './settings';
  import { applyFilters, defaultFilterSettings, defaultSettings } from './settings';

  /** Surface sync failures, deduped over 10s: while the backend is down every
   *  retry fails and would flood the toast. */
  let lastSyncToastAt = 0;
  function notifySyncFailure(): void {
    const now = Date.now();
    if (now - lastSyncToastAt < 10_000) return;
    lastSyncToastAt = now;
    toast.error(copy.sync.failed, { description: copy.sync.queuedRetry });
  }

  // Store first: the engine writes the full /sync snapshot straight into it
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
    // The finished upload becomes an op on the sync engine (pending count and the 256-op
    // threshold belong to it). No sync is kicked off here on purpose: an upload must not
    // pull a snapshot, so the op leaves with the pagehide flush, the threshold, or the
    // top bar's manual sync — same as every other op.
    onUploadOp: (op) => {
      void engine.addOp(op);
      // Anything the user did to that card while it was still uploading (marks, delete)
      // is queued behind its upload op, so it can now go out.
      const sha = op.payload && 'sha256' in op.payload ? String(op.payload.sha256) : '';
      store.photoOpQueued(sha);
    },
    // cancelJob echo (broadcast): drop the row/card in this tab too. A cancel resolves the
    // job as far as the batch counter is concerned — otherwise the header would freeze at
    // (total-1)/total with nothing left on screen.
    onJobRemoved: (jobId) => {
      if (uploadTasks.has(jobId)) countResolved(jobId);
      dropTask(jobId);
    },
    // Files outside the accept surface (often empty MIME on Windows) — visible notice
    onRejected: (fileName) =>
      toast.error(fmt(copy.upload.unknownType, { fileName }), {
        description: copy.upload.acceptHint,
      }),
  });

  let uploadTasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);
  /** Source dimensions probed at enqueue — failed transcodes keep the real aspect ratio. */
  let probedSizeByJob = $state<Map<string, { width: number; height: number }>>(new Map());

  /**
   * Panel header counter ({done}/{total}). `total` is every accepted file of the current
   * pick batch, `done` the ones the panel is finished with (transcoded / failed /
   * cancelled) — counted once each. It cannot come from the live row list, because a row
   * leaves the panel long before its job ends: the numerator would rise and fall with the
   * list instead of describing the batch.
   */
  let batchTotal = $state(0);
  let batchDone = $state(0);
  const countedJobs = new Set<string>();
  /** Count a job as resolved exactly once (terminal state, or a cancel). */
  function countResolved(jobId: string): void {
    if (countedJobs.has(jobId)) return;
    countedJobs.add(jobId);
    batchDone += 1;
  }

  /** Rows the panel shows: the transcode leg only. Past it the card owns the progress
   *  (hashing is a deliberate silent gap, then the curtain carries the upload leg). */
  const PANEL_STAGES = new Set(['queued', 'lease-wait', 'transcoding']);
  let panelRows = $derived(
    Array.from(uploadTasks.values()).filter((t) => PANEL_STAGES.has(t.phase)),
  );

  /**
   * Preview behind the curtain until the host URL exists. It is the TRANSCODED artifact
   * read back from OPFS, not the picked file: the artifact is what will actually land
   * (so it always decodes, HEIC and exotic codecs included), it is written before the
   * card ever appears, and it survives a page reload — where the picked File is gone and
   * the artifact is still on disk. Reactive: the read is async, so the card repaints when
   * it lands. Revoked as soon as the task leaves.
   */
  let previewUrls = $state<Map<string, string>>(new Map());

  /** Object URL for the OPFS artifact, once per job (no-op while the read is in flight). */
  const previewReads = new Set<string>();
  async function ensureArtifactPreview(jobId: string, type: number): Promise<void> {
    if (previewUrls.has(jobId) || previewReads.has(jobId)) return;
    previewReads.add(jobId);
    try {
      const blob = await readArtifact(jobId, type === 0 ? 'webp' : 'webm');
      // The job may have landed or been cancelled while the handle was opening
      if (blob && uploadTasks.has(jobId) && !previewUrls.has(jobId)) {
        previewUrls.set(jobId, URL.createObjectURL(blob));
      }
    } catch {
      /* an unreadable artifact just leaves the skeleton */
    } finally {
      previewReads.delete(jobId);
    }
  }

  /** Drop a task and its optimistic-card mapping (idempotent; used by cancel + cleanup). */
  function dropTask(jobId: string) {
    const id = tempIdByJob.get(jobId);
    if (id !== undefined) {
      tempIdByJob.delete(jobId);
      jobByTempId.delete(id);
    }
    probedSizeByJob.delete(jobId);
    tempCreatedAt.delete(jobId);
    const sha = uploadTasks.get(jobId)?.sha256;
    if (sha) store.forgetPendingPhoto(sha);
    const preview = previewUrls.get(jobId);
    if (preview) {
      URL.revokeObjectURL(preview);
      previewUrls.delete(jobId);
    }
    const next = new Map(uploadTasks);
    next.delete(jobId);
    uploadTasks = next;
  }

  // Probes run sequentially (one decode at a time) so a 20-photo pick never
  // bursts the main thread with concurrent image decodes.
  let probeChain = Promise.resolve();
  function queueSizeProbe(jobId: string, file: File) {
    // Called once per ACCEPTED file (rejected MIME types never get here), so it is the
    // honest denominator for the panel header counter.
    batchTotal += 1;
    probeChain = probeChain
      .then(async () => {
        const size = await probeSourceSize(file);
        // The job may have been cancelled/finished while probing
        if (size && uploadTasks.has(jobId)) probedSizeByJob.set(jobId, size);
      })
      .catch(() => undefined);
  }

  // ---- Optimistic upload entries ----
  // Transcode done → insert at the top under a "curtain" mask that pulls up with
  // progress; failure → full mask + retry icon; /sync drops it by sha256 (server wins).
  let nextTempId = -1;
  const tempIdByJob = new Map<string, number>();
  const jobByTempId = new Map<number, string>();
  // Guard against double-toasting the same failure within one session (e.g. a
  // redundant status echo). Replay across a page reload re-toasts intentionally:
  // a lingering failed upload deserves a fresh reminder.
  const toastedFailures = new Set<string>();
  // Fixed createdAt per optimistic card — using Date.now() inside the derived
  // would re-stamp every progress frame and thrash the "newest" sort.
  const tempCreatedAt = new Map<string, number>();

  let pendingPhotos = $derived.by(() => {
    const out: Photo[] = [];
    // Sync-landed shas hide optimistic done/duplicate cards in the same render
    // cycle the real photo arrives — no one-frame double display while the
    // cleanup $effect is still scheduled.
    const landedShas = new Set(store.photos.map((p) => p.sha256));
    for (const t of uploadTasks.values()) {
      // Hashing stays invisible — its row has already left the panel and the card has
      // not appeared yet, so dedupe is a silent gap by design. The card enters with
      // the upload leg and its curtain carries that progress.
      if (!['uploading', 'done', 'failed'].includes(t.phase)) continue;
      if ((t.phase === 'done' || t.phase === 'duplicate') && t.sha256 && landedShas.has(t.sha256))
        continue;
      // tempId is assigned uniformly in the onTask callback; skip anything that
      // raced a dropTask (cancel / cleanup) instead of emitting id: undefined
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      // Failed transcodes have no meta: fall back to the probed source dimensions
      // so the failure card keeps the real aspect ratio (placeholder 800×600 only
      // when probing also failed)
      const probed = probedSizeByJob.get(t.jobId);
      const meta = t.meta ?? {
        width: probed?.width ?? 800,
        height: probed?.height ?? 600,
        size: 0,
        type: 0 as const,
      };
      const sha = t.sha256 ?? '';
      // Marks the user already gave this card while it was uploading; they render like
      // real ones and the ops behind them are queued right after the upload op.
      const marks = sha ? store.pendingMarksFor(sha) : { likes: [], dislikes: [], reports: [] };
      out.push({
        id,
        sha256: sha,
        url: t.url ?? previewUrls.get(t.jobId) ?? '',
        uploader: store.selfId,
        width: meta.width,
        height: meta.height,
        size: meta.size,
        createdAt: tempCreatedAt.get(t.jobId) ?? Date.now(),
        type: meta.type,
        likes: marks.likes,
        dislikes: marks.dislikes,
        reports: marks.reports,
      });
    }
    return out;
  });

  let uploadOverlays = $derived.by(() => {
    const m = new Map<
      number,
      { fraction?: number; failed?: boolean; error?: string; preview?: boolean }
    >();
    for (const t of uploadTasks.values()) {
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      if (t.phase === 'uploading') {
        // Once the host URL exists the curtain shows the real thing, not the local preview.
        if (t.meta) m.set(id, { fraction: t.fraction ?? 0, preview: !t.url });
      } else if (t.phase === 'failed') {
        // Transcode failure (no meta) still gets a failure mask — retry must not
        // depend on a successful transcode. The translated reason rides along so
        // the card can say WHY instead of a bare "upload failed".
        m.set(id, {
          failed: true,
          preview: !t.url,
          error: translateTaskError(t.error, {
            oversize: t.error === 'oversize',
            uploadLeg: !!t.sha256,
          }),
        });
      }
      // done → no mask (curtain fully open, awaiting /sync correction)
    }
    return m;
  });

  // After /sync the real entries land: drop matching optimistic entries by sha256.
  // Only terminal phases qualify — deleting on 'uploading' would flicker the card
  // mid-flight. 'duplicate' rows always go, or a sha absent from the store lingers.
  $effect(() => {
    const shas = new Set(store.photos.map((p) => p.sha256));
    for (const t of uploadTasks.values()) {
      if (t.phase !== 'done' && t.phase !== 'duplicate') continue;
      if (t.phase === 'duplicate' || (t.sha256 && shas.has(t.sha256))) {
        dropTask(t.jobId);
      }
    }
  });

  function handleRetryUpload(photo: Photo) {
    const jobId = jobByTempId.get(photo.id);
    if (!jobId) return;
    // A retry is a fresh attempt: allow its failure to toast again, otherwise the
    // dedupe set would swallow it and the second failure would look like nothing happened.
    toastedFailures.delete(jobId);
    pipeline.retry(jobId);
  }

  /** Dismiss a failed card: cancel on the SW (stops refresh replay) + drop locally. */
  function handleDismissUpload(photo: Photo) {
    const jobId = jobByTempId.get(photo.id);
    if (!jobId) return;
    pipeline.cancel(jobId);
    dropTask(jobId);
  }

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let multiMode = $state(false);
  let initialized = $state(false);

  // Layout settings (from SettingsPanel). Seeded from the same factory defaults the
  // panel persists against, so the first frame cannot disagree with a stored value.
  let layout = $state<LayoutSettings>(defaultSettings().layout);
  // Filter settings (from SettingsPanel; drives the waterfall filter)
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

  /** Inbound verification: after a 401 the captcha renders centered in the empty
   *  waterfall; `done` = token in, kept until the handshake ends. */
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
  });

  // Task sink lives in its own effect so its unsubscribe is honoured on teardown.
  // (Inside the guarded init effect above it would be torn down by the second run
  // that the `initialized` write triggers.)
  $effect(() =>
    pipeline.onTask((t) => {
      // Header counter: a job is resolved the moment it stops being one of the panel's
      // rows (transcoded, dead, or cancelled). The counter therefore reaches total exactly
      // when the list empties — an upload still in flight is the card's business, not the
      // panel's, and counting it here is what used to leave an empty panel at "12/18".
      if (!PANEL_STAGES.has(t.phase)) countResolved(t.jobId);
      // Card preview comes from the transcoded artifact, not the picked File.
      if (t.meta && (t.phase === 'uploading' || t.phase === 'failed')) {
        void ensureArtifactPreview(t.jobId, t.meta.type);
      }
      // Done/duplicate echo whose photo already landed must not resurrect an
      // optimistic card, but an existing row still drops — otherwise it freezes at
      // its last stage (the cleanup effect below only scans done/duplicate).
      if (
        (t.phase === 'done' || t.phase === 'duplicate') &&
        t.sha256 &&
        store.photos.some((p) => p.sha256 === t.sha256)
      ) {
        if (uploadTasks.has(t.jobId)) dropTask(t.jobId);
        return;
      }
      // Duplicate against a sha not (yet) in the store: brief panel row, toast, and
      // the cleanup effect drops it — no silent nothing, no lingering row.
      if (t.phase === 'duplicate' && t.fileName) {
        toast.info(fmt(copy.upload.duplicate, { fileName: t.fileName }));
      }
      // Album upload failure: surface a toast so the user notices even if the
      // failure card scrolled out of view. Editor failures have inline UI.
      if (t.phase === 'failed' && t.purpose === 'album' && !toastedFailures.has(t.jobId)) {
        toastedFailures.add(t.jobId);
        toast.error(
          fmt(copy.upload.failed, { fileName: t.fileName || copy.upload.defaultFileName }),
          {
            description: translateTaskError(t.error, { uploadLeg: !!t.sha256 }),
          },
        );
      }
      // Optimistic tempIds are assigned here — both pendingPhotos and uploadOverlays
      // deriveds read them; callbacks run before any derived evaluates, so order is safe
      if (['uploading', 'done', 'failed'].includes(t.phase) && !tempIdByJob.has(t.jobId)) {
        const id = nextTempId--;
        tempIdByJob.set(t.jobId, id);
        jobByTempId.set(id, t.jobId);
        tempCreatedAt.set(t.jobId, Date.now());
      }
      uploadTasks = new Map(uploadTasks.set(t.jobId, t));
    }),
  );

  // ---- Photo mark / delete ----
  // Addressed by sha256, never by the numeric id: an in-flight upload has no id yet, and
  // the hash is the photo's stable unique index (the id only serves the /l/{id36} link).
  // The store applies the optimistic update and queues the op (deferring it behind the
  // upload op when the row does not exist yet), so these handlers just forward the hash.
  const shaOf = (photo: Photo): string => photo.sha256;
  /** Ids in a selection → the photos' hashes, resolved against both lists. */
  function shasOf(ids: number[]): string[] {
    const all = [...pendingPhotos, ...visiblePhotos];
    const out: string[] = [];
    for (const id of ids) {
      const sha = all.find((p) => p.id === id)?.sha256;
      if (sha) out.push(sha);
    }
    return out;
  }
  function handleLike(photo: Photo) {
    store.toggleMark(shaOf(photo), 'like');
  }
  function handleDislike(photo: Photo) {
    store.toggleMark(shaOf(photo), 'dislike');
  }
  function handleRequestDelete(photo: Photo) {
    store.toggleMark(shaOf(photo), 'report');
  }
  function handleDelete(photo: Photo) {
    store.deletePhotos([shaOf(photo)]);
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
    // A pick while nothing is in flight starts a fresh batch — the counter describes one
    // batch, not the session.
    const inFlight = Array.from(uploadTasks.values()).some(
      (t) => t.phase !== 'done' && t.phase !== 'duplicate' && t.phase !== 'failed',
    );
    if (!inFlight) {
      batchTotal = 0;
      batchDone = 0;
      countedJobs.clear();
    }
    pipeline.addFiles(files, queueSizeProbe);
    input.value = '';
  }
  /** Panel row remove button: cancel anywhere in the flow (queue, token wait, transcode). */
  function handleRemoveUpload(jobId: string) {
    pipeline.cancel(jobId);
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

      <!-- Uploads must stay visible even on an empty album: the first upload of a
           new account would land in this branch with nowhere to render, and a
           failed first upload needs its retry card. -->
      {#if visiblePhotos.length === 0 && pendingPhotos.length === 0}
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
            {store.photos.length === 0 ? copy.gallery.empty : copy.gallery.emptyFiltered}
          </p>
          <p class="mt-1.5 text-sm text-muted-foreground">
            {store.photos.length === 0 ? copy.gallery.emptyHint : copy.gallery.emptyFilteredHint}
          </p>
        </div>
      {:else}
        <WaterfallLayout
          photos={visiblePhotos}
          pending={pendingPhotos}
          overlays={uploadOverlays}
          onRetryUpload={handleRetryUpload}
          onDismissUpload={handleDismissUpload}
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
      announcements={store.announcements ?? []}
      selfId={store.selfId}
      onReact={handleReact}
      onVote={handleVote}
      onFeedback={handleFeedback}
    />
  </OverlaySidebar>

  <!-- Upload progress: the transcode leg only (the card curtain carries the rest). -->
  <UploadPanel
    tasks={panelRows}
    progress={{ done: batchDone, total: batchTotal }}
    onRemove={handleRemoveUpload}
    hidden={multiMode}
  />

  <!-- Toast notifications: bottom-left (keeps image subjects clear); color, radius, and font all use site tokens -->
  <!-- No close button: a swipe dismisses the toast (sonner's own gesture). -->
  <!-- expand: the stack is always fully open. Sonner's hover-driven expansion is a trap
       here — swiping a toast away ends the gesture outside the list, so its internal
       `interacting` flag is never cleared and the survivors stay stuck expanded.
       The bottom offset clears the multi-select bar (bottom-0, ~65px tall): at 1rem the
       toasts sat on top of it and swallowed clicks on select-all. -->
  <Toaster
    position="bottom-left"
    theme="dark"
    richColors
    expand
    offset={{ bottom: '4.5rem', left: '1rem' }}
    {toastOptions}
  />
</div>
