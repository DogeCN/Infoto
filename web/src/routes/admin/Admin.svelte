<script lang="ts">
  import {
    Megaphone,
    MessageSquare,
    Plus,
    Download,
    Upload,
    RefreshCw,
    Trash2,
    Pencil,
    GripVertical,
  } from "@lucide/svelte";
  import { getEngine } from "../../core/sync/engine";
  import { createAppStore } from "../../state/appStore.svelte";

  const store = createAppStore();
  const engine = getEngine({
    onSyncResponse: (r) => store.applySync(r),
    onError: (phase, e) => console.error("[sync]", phase, e),
  });
  store.bindEngine(engine);

  let activeTab = $state<"announcements" | "feedback">("announcements");
  let initialized = $state(false);

  $effect(() => {
    if (initialized) return;
    initialized = true;
    engine.init().catch(console.error);
    engine.install();
  });

  let isRoot = $derived(store.selfId === 0);

  // ---- 公告 CRUD ----
  let editingAnn = $state<{
    id: number;
    title: string;
    contentMd: string;
  } | null>(null);
  let showNewAnn = $state(false);
  let newTitle = $state("");
  let newContentMd = $state("");

  function handleCreateAnn() {
    if (!newTitle.trim() || !newContentMd.trim()) return;
    store.annCreate(newTitle.trim(), newContentMd.trim());
    newTitle = "";
    newContentMd = "";
    showNewAnn = false;
  }
  function handleUpdateAnn() {
    if (!editingAnn) return;
    if (!editingAnn.title.trim() || !editingAnn.contentMd.trim()) return;
    store.annUpdate(
      editingAnn.id,
      editingAnn.title.trim(),
      editingAnn.contentMd.trim(),
    );
    editingAnn = null;
  }
  function handleDeleteAnn(id: number) {
    store.annDelete(id);
  }
  function startEdit(ann: { id: number; title: string; contentMd: string }) {
    editingAnn = { id: ann.id, title: ann.title, contentMd: ann.contentMd };
  }

  // ---- SQL 导入/导出 ----
  async function handleExportSql() {
    try {
      const res = await fetch("/admin/migrate", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `infoto-export-${Date.now()}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error("[admin] export failed", e);
    }
  }

  let importInputEl: HTMLInputElement | undefined = $state(undefined);
  async function handleImportSql(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/admin/migrate", {
        method: "POST",
        credentials: "include",
        body: buf,
      });
      const json = (await res.json()) as {
        ok: boolean;
        imported?: number;
        error?: string;
        detail?: string;
      };
      if (json.ok) {
        store.resetAfterImport();
        await engine.sync();
      } else {
        console.error("[admin] import failed", json.error, json.detail);
      }
    } catch (e) {
      console.error("[admin] import failed", e);
    }
  }

  // ---- 公告拖动排序 ----
  let dragId = $state<number | null>(null);
  let dragOverId = $state<number | null>(null);

  function onDragStart(id: number) {
    dragId = id;
  }

  function onDragOver(e: DragEvent, id: number) {
    e.preventDefault();
    if (dragId === null || dragId === id) return;
    dragOverId = id;
    const ids = store.announcements.map((a) => a.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    store.annReorder(next);
  }

  function onDragEnd() {
    dragId = null;
    dragOverId = null;
  }

  // ---- 反馈 ----
  let fbQuery = $state("");
  let visibleFeedback = $derived.by(() => {
    const q = fbQuery.trim().toLowerCase();
    if (!q) return store.feedback;
    return store.feedback.filter(
      (f) =>
        f.contentMd.toLowerCase().includes(q) || String(f.userId).includes(q),
    );
  });

  function handleDeleteFeedback(id: number) {
    store.fbDelete(id);
  }
</script>

<div class="min-h-screen bg-background">
  <header
    class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/70 px-3 backdrop-blur-xl backdrop-saturate-150 md:h-16 md:px-6"
  >
    <div class="flex items-center gap-2">
      <div class="flex items-center rounded-lg bg-secondary p-0.5">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeTab ===
          'announcements'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = "announcements")}
        >
          <Megaphone class="size-4" />
          公告
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeTab ===
          'feedback'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = "feedback")}
        >
          <MessageSquare class="size-4" />
          建议
        </button>
      </div>

      <button
        type="button"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        onclick={() => engine.sync()}
      >
        <RefreshCw
          class="size-5 {store.engineState.syncing ? 'animate-spin' : ''}"
        />
      </button>
    </div>

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        title="新增公告"
        onclick={() => {
          showNewAnn = !showNewAnn;
          editingAnn = null;
        }}
      >
        <Plus class="size-5" />
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        title="导出 SQL"
        onclick={handleExportSql}
      >
        <Download class="size-5" />
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        title="导入 SQL"
        onclick={() => importInputEl?.click()}
      >
        <Upload class="size-5" />
      </button>
    </div>
  </header>

  <input
    bind:this={importInputEl}
    type="file"
    accept=".sql"
    class="hidden"
    onchange={handleImportSql}
  />

  <main class="mx-auto max-w-4xl p-4 md:p-6">
    {#if !isRoot}
      <div class="flex flex-col items-center justify-center py-20 text-center">
        <p class="text-muted-foreground">需要管理员权限</p>
      </div>
    {:else if activeTab === "announcements"}
      <div class="space-y-4" role="list">
        {#if showNewAnn}
          <div class="rounded-xl border border-primary/50 bg-card p-4">
            <input
              bind:value={newTitle}
              type="text"
              placeholder="标题"
              class="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <textarea
              bind:value={newContentMd}
              placeholder="内容（Markdown）"
              rows="4"
              class="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
            ></textarea>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onclick={handleCreateAnn}
              >
                发布
              </button>
              <button
                type="button"
                class="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                onclick={() => {
                  showNewAnn = false;
                  newTitle = "";
                  newContentMd = "";
                }}
              >
                取消
              </button>
            </div>
          </div>
        {/if}
        {#if editingAnn}
          <div class="rounded-xl border border-primary/50 bg-card p-4">
            <input
              bind:value={editingAnn.title}
              type="text"
              placeholder="标题"
              class="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <textarea
              bind:value={editingAnn.contentMd}
              placeholder="内容（Markdown）"
              rows="4"
              class="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
            ></textarea>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onclick={handleUpdateAnn}
              >
                保存
              </button>
              <button
                type="button"
                class="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                onclick={() => (editingAnn = null)}
              >
                取消
              </button>
            </div>
          </div>
        {/if}
        {#if store.announcements.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 text-center"
          >
            <Megaphone class="mb-4 size-10 text-muted-foreground" />
            <p class="text-muted-foreground">暂无公告</p>
          </div>
        {:else}
          {#each store.announcements as ann (ann.id)}
            <div
              role="listitem"
              class="rounded-xl border bg-card p-4 transition-colors {dragOverId === ann.id ? 'border-primary' : 'border-border'} {dragId === ann.id ? 'opacity-50' : ''}"
              draggable="true"
              ondragstart={() => onDragStart(ann.id)}
              ondragover={(e) => onDragOver(e, ann.id)}
              ondragend={onDragEnd}
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-1 items-start gap-2">
                  <span
                    class="mt-0.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground"
                  >
                    <GripVertical class="size-4" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <h3 class="text-sm font-medium">{ann.title}</h3>
                    <p class="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {ann.contentMd}
                    </p>
                    <div
                      class="mt-3 flex items-center gap-2 text-xs text-muted-foreground/70"
                    >
                      <span>排序: {ann.sort}</span>
                      <span>·</span>
                      <span
                        >更新: {new Date(ann.updatedAt).toLocaleDateString(
                          "zh-CN",
                        )}</span
                      >
                    </div>
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                    title="编辑"
                    onclick={() => startEdit(ann)}
                  >
                    <Pencil class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="删除"
                    onclick={() => handleDeleteAnn(ann.id)}
                  >
                    <Trash2 class="size-4" />
                  </button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <span
            class="inline-flex items-center rounded-full border border-transparent bg-secondary px-4 py-1 text-base font-semibold text-secondary-foreground"
          >
            共 {store.feedback.length} 条
          </span>
          <input
            bind:value={fbQuery}
            type="search"
            placeholder="按内容或用户 ID 过滤"
            class="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {#if visibleFeedback.length === 0}
          <div
            class="flex flex-col items-center justify-center py-20 text-center"
          >
            <MessageSquare class="mb-4 size-10 text-muted-foreground" />
            <p class="text-muted-foreground">
              {fbQuery.trim() ? "没有匹配的建议" : "暂无建议"}
            </p>
          </div>
        {:else}
          {#each visibleFeedback as fb (fb.id)}
            <div class="rounded-xl border border-border bg-card p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="line-clamp-2 text-sm">{fb.contentMd}</p>
                  <div
                    class="mt-3 flex items-center gap-2 text-xs text-muted-foreground/70"
                  >
                    <span
                      class="inline-flex items-center rounded-full border border-border px-2 py-0.5"
                      >用户 {fb.userId}</span
                    >
                    <span>·</span>
                    <span>{new Date(fb.createdAt).toLocaleString("zh-CN")}</span
                    >
                  </div>
                </div>
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="删除"
                  onclick={() => handleDeleteFeedback(fb.id)}
                >
                  <Trash2 class="size-4" />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </main>
</div>
