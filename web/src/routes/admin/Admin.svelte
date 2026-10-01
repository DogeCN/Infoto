<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Announcement, LocaleCode, Poll } from '$shared/types';
  import { Megaphone, MessageSquare, ChartNoAxesColumn } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import { Toaster, toast } from 'svelte-sonner';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { toastOptions } from '$base/lib/ui';
  import { getEngine } from '../../core/engine';
  import { postSync, TurnstileRequiredError } from '../../core/api/syncClient';
  import { createAppStore } from '../../state/appStore.svelte';
  import { UploadPipeline, type UploadRow } from '../../transcode/pipeline';

  import AdminMigrateMenu from './AdminMigrateMenu.svelte';
  import AnnouncementEditorDialog from './AnnouncementEditorDialog.svelte';
  import AnnouncementList from './AnnouncementList.svelte';
  import FeedbackList from './FeedbackList.svelte';
  import PollEditorDialog from './PollEditorDialog.svelte';
  import PollList from './PollList.svelte';

  type AdminTab = 'announcements' | 'feedback' | 'polls';
  const store = createAppStore();
  let syncErrorToastAt = 0;
  const engine = getEngine({
    postSyncFn: postSync,
    onSyncResponse: (response, context) => store.applySync(response, context),
    onError: (phase, error) => {
      console.error('[sync]', phase, error);
      if (error instanceof TurnstileRequiredError) {
        identityRejected = true;
        return;
      }
      const now = Date.now();
      if (now - syncErrorToastAt > 10_000) {
        syncErrorToastAt = now;
        toast.error(copy.sync.failed, { description: copy.sync.dataMayBeStale });
      }
    },
  });
  store.bindEngine(engine);
  const pipeline = new UploadPipeline({ onEvent: (line) => console.log('[upload]', line) });

  let activeTab = $state<AdminTab>('announcements');
  let initialized = $state(false);
  let editorOpen = $state(false);
  let editingAnnouncement = $state<Announcement | null>(null);
  let pollEditorOpen = $state(false);
  let editingPoll = $state<Poll | null>(null);
  let editorUploadTask = $state<UploadRow | null>(null);
  let editorJobId: string | null = null;

  const adminItems = $derived([
    { value: 'announcements', label: copy.admin.tabs.announcements, icon: Megaphone },
    { value: 'feedback', label: copy.admin.tabs.feedback, icon: MessageSquare },
    { value: 'polls', label: copy.admin.tabs.polls, icon: ChartNoAxesColumn },
  ]);
  const createLabel = $derived(
    activeTab === 'announcements'
      ? copy.admin.newAnnouncement
      : activeTab === 'polls'
        ? copy.admin.newPoll
        : undefined,
  );
  const createActive = $derived(
    (activeTab === 'announcements' && editorOpen && editingAnnouncement === null) ||
      (activeTab === 'polls' && pollEditorOpen && editingPoll === null),
  );

  $effect(() => {
    if (untrack(() => initialized)) return;
    initialized = true;
    pipeline.start();
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

  function openCreateAnnouncement(): void {
    editingAnnouncement = null;
    editorOpen = true;
  }

  function toggleCreateAnnouncement(): void {
    if (editorOpen && editingAnnouncement === null) {
      closeAnnouncementEditor();
      return;
    }
    openCreateAnnouncement();
  }

  function openEditAnnouncement(announcement: Announcement): void {
    editingAnnouncement = announcement;
    editorOpen = true;
  }

  function closeAnnouncementEditor(): void {
    if (editorJobId) {
      pipeline.cancel(editorJobId);
      editorJobId = null;
    }
    editorUploadTask = null;
    editorOpen = false;
    editingAnnouncement = null;
  }

  function saveAnnouncement(title: string, contentMd: string): void {
    if (editingAnnouncement) store.annUpdate(editingAnnouncement.id, title, contentMd);
    else store.annCreate(title, contentMd);
    closeAnnouncementEditor();
  }

  function openCreatePoll(): void {
    editingPoll = null;
    pollEditorOpen = true;
  }

  function toggleCreatePoll(): void {
    if (pollEditorOpen && editingPoll === null) {
      closePollEditor();
      return;
    }
    openCreatePoll();
  }

  function openEditPoll(poll: Poll): void {
    editingPoll = poll;
    pollEditorOpen = true;
  }

  function closePollEditor(): void {
    pollEditorOpen = false;
    editingPoll = null;
  }

  function savePoll(title: string, options: string[], allowMultiple: boolean): void {
    if (editingPoll) store.pollUpdate(editingPoll.id, title, options, allowMultiple);
    else store.pollCreate(title, options, allowMultiple);
    closePollEditor();
  }

  function handleCreate(): void {
    if (activeTab === 'announcements') toggleCreateAnnouncement();
    else if (activeTab === 'polls') toggleCreatePoll();
  }

  function handleTabChange(value: string): void {
    if (value === 'announcements' || value === 'feedback' || value === 'polls') activeTab = value;
  }

  function handleLocaleChange(locale: LocaleCode): void {
    closeAnnouncementEditor();
    closePollEditor();
    store.setContentLocale(locale);
    void engine.sync();
  }

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
    <TopBar
      variant="admin"
      {adminItems}
      adminValue={activeTab}
      onAdminChange={handleTabChange}
      onLocaleChange={handleLocaleChange}
      adminCreateLabel={createLabel}
      adminCreateActive={createActive}
      onAdminCreateClick={handleCreate}
    >
      {#snippet adminActions()}
        <AdminMigrateMenu onImported={handleImported} />
      {/snippet}
    </TopBar>

    <main class="w-full px-4 pb-6 pt-20 md:px-8 md:pt-24">
      {#if activeTab === 'announcements'}
        <AnnouncementList
          announcements={store.announcements}
          onEdit={openEditAnnouncement}
          onDelete={(id) => store.annDelete(id)}
          onReorder={handleAnnouncementReorder}
        />
      {:else if activeTab === 'feedback'}
        <FeedbackList
          feedback={store.feedback}
          onDelete={(id) => store.fbDelete(id)}
          onReorder={(ids) => store.fbReorder(ids)}
        />
      {:else}
        <PollList
          polls={store.polls}
          selfId={store.selfId}
          onEdit={openEditPoll}
          onDelete={(id) => store.pollDelete(id)}
          onReorder={(ids) => store.pollReorder(ids)}
        />
      {/if}
    </main>

    {#if editorOpen}
      {#key editingAnnouncement?.id ?? 'new-announcement'}
        <AnnouncementEditorDialog
          announcement={editingAnnouncement}
          polls={store.polls}
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

    <Toaster position="bottom-left" theme="dark" richColors expand {toastOptions} />
  </div>
{:else if store.selfId >= 1}
  <ErrorPage code={404} />
{/if}
