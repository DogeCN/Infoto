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

  // 身份未知（无 selfId 缓存且 /sync 未返回）：回主页让 Turnstile 建号，
  // 不在 /admin 等待也不显示 loading。replace 掉历史记录，后退不回到 /admin。
  $effect(() => {
    if (store.selfId === -1) location.replace('/');
  });

  function openCreateAnnouncement() {
    editingAnnouncement = null;
    editorOpen = true;
  }

  /** 「新增公告」按钮 = 编辑器开关：开着（新建态）再点关闭；编辑态点它切到新建。 */
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
    <header
      class="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 md:h-16 md:px-6"
    >
      <div class="flex items-center gap-2">
        <!-- 分段选择器：复用通用 SegmentedControl（滑动 pill 动画与主页 SortTabs 完全一致） -->
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
        <!-- 编辑器开关（与主页顶栏侧栏按钮同一套高亮语言）：开启时图标转主色 -->
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
{:else if store.selfId >= 1}
  <!-- 已知非 root（缓存或 /sync 确认）：与旧的服务端 404 页等价 -->
  <ErrorPage code={404} />
{/if}
<!-- selfId === -1：重定向已触发，本帧不渲染 -->
