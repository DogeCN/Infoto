<script lang="ts">
  import { Megaphone, MessageSquare, Plus } from '@lucide/svelte';
  import type { Announcement } from '$shared/types';
  import { Toaster, toast } from 'svelte-sonner';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import SyncButton from '$lib/components/SyncButton.svelte';
  import { toastOptions } from '$lib/toastOptions';
  import { getEngine } from '../../core/sync/engine';
  import { createAppStore } from '../../state/appStore.svelte';
  import { UploadPipeline } from '../../transcode/pipeline';
  import type { PanelTask } from '$lib/components/UploadProgressPanel.svelte';
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
      const now = Date.now();
      if (now - syncErrorToastAt > 10_000) {
        syncErrorToastAt = now;
        toast.error('同步失败', {
          description: '改动已排队，稍后自动重试；也可点击同步按钮手动重试',
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
  let editorUploadTask = $state<PanelTask | null>(null);

  $effect(() => {
    if (initialized) return;
    initialized = true;
    pipeline.start();
    engine.init().catch(console.error);
    engine.install();
  });

  $effect(() =>
    pipeline.onEditorTask((task) => {
      const terminal = task.phase === 'done' || task.phase === 'failed';
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

  // Identity unknown (no cached selfId, /sync not back yet): return home so Turnstile can create
  // one — don't wait on /admin or show loading. replace() the history entry so Back skips /admin.
  $effect(() => {
    if (store.selfId === -1) location.replace('/');
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
      if (result.ok) return { ok: true, message: '数据已导入并同步' };
      return { ok: false, message: '数据已导入，但同步失败，请稍后重试' };
    } catch {
      return { ok: false, message: '数据已导入，但同步失败，请稍后重试' };
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
            { value: 'announcements', label: '公告', icon: Megaphone },
            { value: 'feedback', label: '建议', icon: MessageSquare },
          ]}
          value={activeTab}
          ariaLabel="管理页分区"
          onChange={(v) => (activeTab = v)}
        />
        <SyncButton
          pendingCount={store.engineState.pending}
          isSyncing={store.engineState.syncing}
          onSync={() => engine.sync()}
        />
      </div>

      <div class="flex items-center gap-1">
        <!-- Editor toggle (same highlight convention as the home top bar sidebar button): icon turns primary while open -->
        <button
          type="button"
          class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
          class:text-primary={editorOpen && editingAnnouncement === null}
          aria-label="新增公告"
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
          saveState={store.annSave}
          timeReference={store.lastSync?.serverTime ?? Date.now()}
          onEdit={openEditAnnouncement}
          onDelete={(id) => store.annDelete(id)}
          onReorder={handleAnnouncementReorder}
        />
      {:else}
        <FeedbackList feedback={store.feedback} onDelete={(id) => store.fbDelete(id)} />
      {/if}
    </main>

    {#if editorOpen}
      <AnnouncementEditorDialog
        announcement={editingAnnouncement}
        onPickImage={(file) => pipeline.uploadEditorImage(file)}
        onSave={saveAnnouncement}
        onCancel={closeAnnouncementEditor}
        uploadTask={editorUploadTask}
      />
    {/if}

    <Toaster position="bottom-left" theme="dark" richColors {toastOptions} />
  </div>
{:else if store.selfId >= 1}
  <!-- Known non-root (confirmed by cache or /sync): equivalent to the old server-rendered 404 page -->
  <ErrorPage code={404} />
{/if}
<!-- selfId === -1: redirect already triggered; render nothing this frame -->
