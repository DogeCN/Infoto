<script lang="ts">
  import type { Announcement, LocaleCode, Poll } from '$shared/types';
  import { copy, getLocale } from '$lib/i18n.svelte';
  import { onDestroy, untrack } from 'svelte';
  import { Toaster, toast } from 'svelte-sonner';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { toastOptions } from '$base/lib/ui';
  import { getEngine } from '../../core/engine';
  import { postSync, TurnstileRequiredError } from '../../core/api/syncClient';
  import { createAppStore } from '../../state/appStore.svelte';
  import { UploadPipeline, type UploadRow } from '../../transcode/pipeline';

  import AnnouncementEditorDialog from './AnnouncementEditorDialog.svelte';
  import AnnouncementList from './AnnouncementList.svelte';
  import FeedbackList from './FeedbackList.svelte';
  import PollList from './PollList.svelte';
  import PollEditorDialog from './PollEditorDialog.svelte';
  import AdminTopBar from './AdminTopBar.svelte';

  const store = createAppStore();
  // Sync-failure toast dedupe: the failure stays until the next success, so a burst of toasts is pointless.
  let syncErrorToastAt = 0;
  const engine = getEngine({
    postSyncFn: postSync,
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

  let activeTab = $state<'announcements' | 'feedback' | 'polls'>('announcements');
  const locale = $derived(getLocale());
  const localizedAnnouncements = $derived(
    store.announcements.filter((announcement) => announcement.locale === locale),
  );
  const localizedFeedback = $derived(store.feedback.filter((item) => item.locale === locale));
  const localizedPolls = $derived(store.polls.filter((poll) => poll.locale === locale));
  let initialized = $state(false);
  let editorOpen = $state(false);
  let editingAnnouncement = $state<Announcement | null>(null);
  let editingLocale = $state<LocaleCode>('en-US');
  let pollEditorOpen = $state(false);
  let editingPoll = $state<Poll | null>(null);
  // Editor image uploads share the SharedWorker pipeline with the waterfall
  // (transcode → hash → upload); this row carries their live stage.
  let editorUploadTask = $state<UploadRow | null>(null);
  /** Job id of the in-flight editor upload (null when idle/terminal). */
  let editorJobId: string | null = null;

  // `untrack` keeps the guard out of the effect's dependency set, so writing it does
  // not schedule the second run a plain `if (initialized) return` would.
  $effect(() => {
    if (untrack(() => initialized)) return;
    initialized = true;
    pipeline.start();
    // No engine.install(): the admin page creates no /sync ops (every write is an
    // immediate admin-API call), so the pagehide dump has nothing to flush. init()
    // alone pulls the one snapshot the page needs.
    engine.init().catch(console.error);
  });

  onDestroy(() => {
    pipeline.stop();
    store.dispose();
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

  // Wait for identity resolution before redirecting non-root visitors; replace the admin history entry.
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
    editingLocale = locale;
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
    editingLocale = announcement.locale;
    editorOpen = true;
  }

  function closeAnnouncementEditor() {
    // Cancel unfinished editor uploads when closing the editor.
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
      store.annUpdate(editingAnnouncement.id, title, contentMd, editingLocale);
    } else {
      store.annCreate(title, contentMd, editingLocale);
    }
    closeAnnouncementEditor();
  }

  function openCreatePoll() {
    editingPoll = null;
    pollEditorOpen = true;
  }

  function openEditPoll(poll: Poll) {
    editingPoll = poll;
    pollEditorOpen = true;
  }

  function toggleCreatePoll() {
    if (pollEditorOpen && editingPoll === null) {
      closePollEditor();
      return;
    }
    openCreatePoll();
  }

  function closePollEditor() {
    pollEditorOpen = false;
    editingPoll = null;
  }

  async function savePoll(title: string, options: string[], allowMultiple: boolean): Promise<void> {
    if (editingPoll) {
      await store.pollUpdate(editingPoll.id, title, options, allowMultiple, editingPoll.locale);
    } else {
      await store.pollCreate(title, options, allowMultiple, locale);
    }
    closePollEditor();
  }

  async function deletePoll(id: number): Promise<void> {
    if (!window.confirm(copy.admin.poll.deleteConfirm)) return;
    try {
      await store.pollDelete(id);
    } catch (error) {
      console.error('[poll] delete failed', error);
      toast.error(copy.admin.poll.deleteFailed, {
        description: error instanceof Error ? error.message : copy.admin.fail.network,
      });
    }
  }

  // Reorder is never blocked by a pending create: the store keeps the new order
  // locally and flushes it as soon as a fresh announcement's real id arrives.
  function handleAnnouncementReorder(ids: number[]): void {
    store.annReorder(ids, locale);
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
    <AdminTopBar
      {activeTab}
      onTabChange={(tab) => (activeTab = tab)}
      onCreate={activeTab === 'polls' ? toggleCreatePoll : toggleCreateAnnouncement}
      createActive={activeTab === 'polls'
        ? pollEditorOpen && editingPoll === null
        : editorOpen && editingAnnouncement === null}
      onImported={handleImported}
    />

    <main class="w-full px-4 pb-6 pt-20 md:px-8 md:pt-24">
      {#if activeTab === 'announcements'}
        <AnnouncementList
          announcements={localizedAnnouncements}
          onEdit={openEditAnnouncement}
          onDelete={(id) => store.annDelete(id)}
          onReorder={handleAnnouncementReorder}
        />
      {:else if activeTab === 'feedback'}
        <FeedbackList
          feedback={localizedFeedback}
          onDelete={(id) => store.fbDelete(id)}
          onReorder={(ids) => store.fbReorder(ids, locale)}
        />
      {:else}
        <PollList
          polls={localizedPolls}
          onEdit={openEditPoll}
          onDelete={(id) => void deletePoll(id)}
          onReorder={(ids) => store.pollReorder(ids, locale)}
        />
      {/if}
    </main>

    {#if editorOpen}
      {#key editingAnnouncement?.id ?? 'new'}
        <AnnouncementEditorDialog
          announcement={editingAnnouncement}
          polls={store.polls.filter((poll) => poll.locale === editingLocale)}
          selfId={store.selfId}
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
      {/key}
    {/if}

    {#if pollEditorOpen}
      {#key editingPoll?.id ?? 'new-poll'}
        <PollEditorDialog poll={editingPoll} onSave={savePoll} onCancel={closePollEditor} />
      {/key}
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
