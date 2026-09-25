<script lang="ts">
  import { Megaphone, MessageSquare, Plus, RefreshCw } from '@lucide/svelte';
  import type { Announcement } from '$shared/types';
  import { Toaster, toast } from 'svelte-sonner';
  import ErrorPage from '$lib/components/custom/ErrorPage.svelte';
  import Tooltip from '$lib/components/custom/Tooltip.svelte';
  import { toastOptions } from '$lib/toastOptions';
  import { getEngine } from '../../core/sync/engine';
  import { createAppStore } from '../../state/appStore.svelte';
  import { UploadPipeline } from '../../transcode/pipeline';
  import AdminMigrateMenu from './AdminMigrateMenu.svelte';
  import AnnouncementEditorDialog from './AnnouncementEditorDialog.svelte';
  import AnnouncementList from './AnnouncementList.svelte';
  import FeedbackList from './FeedbackList.svelte';

  const store = createAppStore();
  const engine = getEngine({
    onSyncResponse: (response, context) => store.applySync(response, context),
    onError: (phase, error) => console.error('[sync]', phase, error),
  });
  store.bindEngine(engine);
  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log('[upload]', line),
  });

  let activeTab = $state<'announcements' | 'feedback'>('announcements');
  let initialized = $state(false);
  let editorOpen = $state(false);
  let editingAnnouncement = $state<Announcement | null>(null);

  $effect(() => {
    if (initialized) return;
    initialized = true;
    pipeline.start();
    engine.init().catch(console.error);
    engine.install();
  });

  const isRoot = $derived(store.selfId === 0);

  function openCreateAnnouncement() {
    editingAnnouncement = null;
    editorOpen = true;
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

  async function handleAnnouncementReorder(ids: number[]) {
    const result = await store.annReorder(ids);
    if (!result.ok && result.reason === 'temporary-id') {
      toast.error('暂不能排序', { description: '请等待新建公告同步完成' });
    } else if (!result.ok) {
      toast.error('排序同步失败', { description: '已恢复原顺序，操作已排队' });
    }
    return result;
  }

  function handleInvalidReorder(): void {
    toast.error('暂不能排序', { description: '请等待新建公告同步完成' });
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
    <header class="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 md:h-16 md:px-6">
      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-lg bg-secondary p-0.5">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeTab === 'announcements'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (activeTab = 'announcements')}
          >
            <Megaphone class="size-4" />
            公告
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeTab === 'feedback'
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (activeTab = 'feedback')}
          >
            <MessageSquare class="size-4" />
            建议
          </button>
        </div>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          aria-label="同步"
          onclick={() => engine.sync()}
        >
          <RefreshCw class="size-5 {store.engineState.syncing ? 'animate-spin' : ''}" />
        </button>
      </div>

      <div class="flex items-center gap-1">
        <Tooltip text="新增公告">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            aria-label="新增公告"
            onclick={openCreateAnnouncement}
          >
            <Plus class="size-5" />
          </button>
        </Tooltip>
        <AdminMigrateMenu onImported={handleImported} />
      </div>
    </header>

    <main class="mx-auto max-w-4xl px-4 pb-6 pt-20 md:px-6 md:pt-24">
      {#if activeTab === 'announcements'}
        <AnnouncementList
          announcements={store.announcements}
          pendingIds={store.pendingAnnouncementIds}
          timeReference={store.lastSync?.serverTime ?? Date.now()}
          onEdit={openEditAnnouncement}
          onDelete={(id) => store.annDelete(id)}
          onReorder={handleAnnouncementReorder}
          onInvalidReorder={handleInvalidReorder}
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
      />
    {/if}

    <Toaster position="bottom-left" theme="dark" richColors {toastOptions} />
  </div>
{:else}
  <ErrorPage code={404} />
{/if}
