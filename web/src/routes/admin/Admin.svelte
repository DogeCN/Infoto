<script lang="ts">
  import { Megaphone, MessageSquare, Plus } from '@lucide/svelte';
  import type { Announcement } from '$shared/types';
  import { copy } from '$shared/copy';
  import { Toaster, toast } from 'svelte-sonner';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import { toastOptions } from '$lib/toastOptions';
  import { getEngine } from '../../core/engine';
  import { TurnstileRequiredError } from '../../core/api/syncClient';
  import { createAppStore } from '../../state/appStore.svelte';
  import { UploadPipeline } from '../../transcode/pipeline';
  import type { UploadRow } from '../../transcode/pipeline';
  import AdminMigrateMenu from './AdminMigrateMenu.svelte';
  import AnnouncementEditorDialog from './AnnouncementEditorDialog.svelte';
  import AnnouncementList from './AnnouncementList.svelte';
  import FeedbackList from './FeedbackList.svelte';

  const store = createAppStore();
  // Sync-failure toast dedupe: the failure stays until the next success, so a burst of toasts is pointless.
  let syncErrorToastAt = 0;
  const engine = getEngine({
    onSyncResponse: (response, context) => store.applySync(response, context),
    onError: (phase, error) => {
      console.error('[sync]', phase, error);
      // 401 (no cookie / expired): confirmed anonymous — leave /admin for the
      // home first-entry flow instead of waiting out the grace period.
      if (error instanceof TurnstileRequiredError) {
        identityRejected = true;
        return;
      }
      const now = Date.now();
      if (now - syncErrorToastAt > 10_000) {
        syncErrorToastAt = now;
        toast.error(copy.sync.failed, {
          description: copy.sync.dataMayBeStale,
        });
      }
    },
  });
  store.bindEngine(engine);
  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log('[upload]', line),
  });

  let activeTab = $state<'announcements' | 'feedback'>('announcements');
  let initialized = $state(false);
  let editorOpen = $state(false);
  let editingAnnouncement = $state<Announcement | null>(null);
  // Editor image uploads share the SharedWorker pipeline with the waterfall
  // (transcode → hash → upload); this row carries their live stage.
  let editorUploadTask = $state<UploadRow | null>(null);
  /** Job id of the in-flight editor upload (null when idle/terminal). */
  let editorJobId: string | null = null;

  $effect(() => {
    if (initialized) return;
    initialized = true;
    pipeline.start();
    // No engine.install(): the admin page creates no /sync ops (every write is an
    // immediate admin-API call), so the pagehide dump has nothing to flush. init()
    // alone pulls the one snapshot the page needs.
    engine.init().catch(console.error);
  });

  $effect(() =>
    pipeline.onEditorTask((task) => {
      const terminal = task.phase === 'done' || task.phase === 'failed';
      editorJobId = terminal ? null : task.jobId;
      editorUploadTask = terminal
        ? null
        : {
            jobId: task.jobId,
            fileName: task.fileName,
            phase: task.phase,
            fraction: task.fraction ?? null,
          };
    }),
  );

  const isRoot = $derived(store.selfId === 0);

  // Identity gate: selfId === -1 means "unknown", NOT "anonymous" — on a cold
  // visit /sync is still in flight, so redirect home only once identity is
  // CONFIRMED absent (401 or grace period). replace() so Back skips /admin.
  let identityRejected = false;
  $effect(() => {
    if (store.selfId !== -1) return;
    if (identityRejected) {
      location.replace('/');
      return;
    }
    const grace = setTimeout(() => {
      if (store.selfId === -1) location.replace('/');
    }, 3000);
    return () => clearTimeout(grace);
  });

  function openCreateAnnouncement() {
    editingAnnouncement = null;
    editorOpen = true;
  }

  /** "New announcement" doubles as the editor toggle: while open in create mode it closes; in edit mode it switches to create. */
  function toggleCreateAnnouncement() {
    if (editorOpen && editingAnnouncement === null) {
      closeAnnouncementEditor();
      return;
    }
    openCreateAnnouncement();
  }

  function openEditAnnouncement(announcement: Announcement) {
    editingAnnouncement = announcement;
    editorOpen = true;
  }

  function closeAnnouncementEditor() {
    // Closing mid-upload orphans it (the URL would never be inserted) — cancel
    // so the SW stops the leg and the artifact work isn't wasted; the jobRemoved
    // echo clears the pipeline's editor snapshot, so reopening shows no stale row.
    if (editorJobId) {
      pipeline.cancel(editorJobId);
      editorJobId = null;
    }
    editorUploadTask = null;
    editorOpen = false;
    editingAnnouncement = null;
  }

  function saveAnnouncement(title: string, contentMd: string) {
    if (editingAnnouncement) {
      store.annUpdate(editingAnnouncement.id, title, contentMd);
    } else {
      store.annCreate(title, contentMd);
    }
    closeAnnouncementEditor();
  }

  // Reorder is never blocked by a pending create: the store keeps the new order
  // locally and flushes it as soon as a fresh announcement's real id arrives.
  function handleAnnouncementReorder(ids: number[]): void {
    store.annReorder(ids);
  }

  async function handleImported(): Promise<{ ok: boolean; message: string }> {
    store.resetAfterImport();
    try {
      const result = await engine.sync();
      if (result.ok) return { ok: true, message: copy.migrate.importSynced };
      return { ok: false, message: copy.migrate.importSyncFailed };
    } catch {
      return { ok: false, message: copy.migrate.importSyncFailed };
    }
  }
</script>

{#if isRoot}
  <div class="min-h-screen bg-background">
    <header
      class="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 md:h-16 md:px-6"
    >
      <div class="flex items-center gap-2">
        <!-- Segmented control: reuses the shared SegmentedControl (sliding-pill animation matches the home SortTabs exactly) -->
        <SegmentedControl
          items={[
            { value: 'announcements', label: copy.admin.tabs.announcements, icon: Megaphone },
            { value: 'feedback', label: copy.admin.tabs.feedback, icon: MessageSquare },
          ]}
          value={activeTab}
          ariaLabel={copy.admin.sectionLabel}
          onChange={(v) => (activeTab = v)}
        />
      </div>

      <div class="flex items-center gap-1">
        <!-- Editor toggle (same highlight convention as the home top bar sidebar button): icon turns primary while open -->
        <button
          type="button"
          class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
          class:text-primary={editorOpen && editingAnnouncement === null}
          aria-label={copy.admin.newAnnouncement}
          aria-pressed={editorOpen && editingAnnouncement === null}
          onclick={toggleCreateAnnouncement}
        >
          <Plus class="size-5" />
        </button>
        <AdminMigrateMenu onImported={handleImported} />
      </div>
    </header>

    <main class="w-full px-4 pb-6 pt-20 md:px-8 md:pt-24">
      {#if activeTab === 'announcements'}
        <AnnouncementList
          announcements={store.announcements}
          onEdit={openEditAnnouncement}
          onDelete={(id) => store.annDelete(id)}
          onReorder={handleAnnouncementReorder}
        />
      {:else}
        <FeedbackList
          feedback={store.feedback}
          onDelete={(id) => store.fbDelete(id)}
          onReorder={(ids) => store.fbReorder(ids)}
        />
      {/if}
    </main>

    {#if editorOpen}
      <AnnouncementEditorDialog
        announcement={editingAnnouncement}
        onPickImage={(file) => pipeline.uploadEditorImage(file)}
        onSave={saveAnnouncement}
        onCancel={closeAnnouncementEditor}
        uploadTask={editorUploadTask}
        onCancelUpload={() => {
          const id = editorUploadTask?.jobId;
          if (id) pipeline.cancel(id);
        }}
        onRetryUpload={(jobId) => pipeline.retryEditorUpload(jobId)}
      />
    {/if}

    <!-- No close button: a swipe dismisses the toast (sonner's own gesture). -->
    <!-- expand: see App.svelte — a swipe-out otherwise leaves the stack stuck open. -->
    <Toaster position="bottom-left" theme="dark" richColors expand {toastOptions} />
  </div>
{:else if store.selfId >= 1}
  <!-- Known non-root (confirmed by cache or /sync): show the 404 page -->
  <ErrorPage code={404} />
{/if}
<!-- selfId === -1: redirect already triggered; render nothing this frame -->
