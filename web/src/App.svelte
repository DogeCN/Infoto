<script lang="ts">
  import TopBar from "$lib/components/custom/TopBar.svelte";
  import type { SortKey } from "$lib/components/custom/SortTabs.svelte";
  import OverlaySidebar from "$lib/components/custom/OverlaySidebar.svelte";
  import WaterfallLayout from "$lib/components/custom/WaterfallLayout.svelte";
  import UploadProgressPanel from "$lib/components/custom/UploadProgressPanel.svelte";
  import SettingsPanel from "$lib/components/custom/SettingsPanel.svelte";
  import AnnouncementSidebar from "$lib/components/custom/AnnouncementSidebar.svelte";
  import { Toaster } from "svelte-sonner";
  import { Settings as SettingsIcon, Megaphone } from "@lucide/svelte";
  import { getEngine } from "./core/sync/engine";
  import { ensureIdentity } from "./core/identity";
  import { postSync, TurnstileRequiredError } from "./core/api/syncClient";
  import { createAppStore } from "./state/appStore.svelte";
  import { downloadOne, downloadZip } from "./core/download";
  import {
    UploadPipeline,
    type PipelineTaskSnapshot,
  } from "./transcode/pipeline";
  import type { Photo } from "$shared/types";
  import type { ScrollDir, FillStrategy } from "$base/lib/layout";
  import type { FilterSettings, LayoutSettings, Settings } from "./settings";
  import { applyFilters, defaultFilterSettings } from "./settings";

  // store 先建：引擎把 /sync 全量快照直接写进 store（契约：服务端下发为准）
  const store = createAppStore();
  const engine = getEngine({
    onSyncResponse: (r) => store.applySync(r),
    onError: (phase, e) => {
      console.error("[sync]", phase, e);
      // Cookie 丢失/过期 → 回到首次入站流程（Turnstile 渲染由 ensureIdentity 承担）
      if (e instanceof TurnstileRequiredError) void bootstrapIdentity();
    },
  });
  store.bindEngine(engine);

  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log("[upload]", line),
    // 上传产物 URL 落成 upload op 后交给同步引擎入队（pending 计数与 256
    // 条阈值都归引擎，契约「所有写操作走 op-log → /sync 管线」）
    onUploadOp: (op) => void engine.addOp(op),
  });

  let uploadTasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);

  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let multiMode = $state(false);
  let initialized = $state(false);

  // 布局设置（来自 SettingsPanel）
  let layout = $state<LayoutSettings>({
    dir: "v",
    strategy: "sequential",
    band: 320,
    gap: 8,
  });
  // 筛选设置（来自 SettingsPanel，用于过滤瀑布流）
  let filters = $state<FilterSettings>(defaultFilterSettings());
  let filterCount = $state(0);
  let resetToken = $state(0);

  // 排序状态：latest / hottest / random；sortAsc 为「最新↔最旧」「最热↔最冷」的方向
  let sortKey = $state<SortKey>("latest");
  let sortAsc = $state(false);
  let randomOrder = $state<number[]>([]);

  function defaultFilters(): FilterSettings {
    return defaultFilterSettings();
  }

  let bootstrapping = false;
  /** 首次入站（无 Cookie）：Turnstile → 带 token 的 /sync → 建身份 + 全量下发。 */
  async function bootstrapIdentity() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const { response } = await ensureIdentity([], { postSyncFn: postSync });
      store.applySync(response);
    } catch (e) {
      console.error("[identity] bootstrap failed", e);
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
    pipeline.onTask((t) => {
      uploadTasks = new Map(uploadTasks.set(t.jobId, t));
    });
  });

  // 照片标记 / 删除：store 负责本地乐观更新 + 提交 op（契约：所有写操作走 op-log）
  function handleLike(photo: Photo) {
    store.toggleMark(photo.id, "like");
  }
  function handleDislike(photo: Photo) {
    store.toggleMark(photo.id, "dislike");
  }
  function handleRequestDelete(photo: Photo) {
    store.toggleMark(photo.id, "report");
  }
  /** Lightbox「取消标记」：撤销喜欢与不喜欢（两者可同时残留）。 */
  function handleUnmark(photo: Photo) {
    store.setMark(photo.id, "like", false);
    store.setMark(photo.id, "dislike", false);
  }
  function handleDelete(photo: Photo) {
    store.deletePhotos([photo.id]);
  }
  function handleDeleteSelected(ids: number[]) {
    store.deletePhotos(ids);
  }
  /** 批量取消标记：撤销喜欢 / 不喜欢 / 请求删除（未标记的项为幂等 no-op）。 */
  function handleUnmarkSelected(ids: number[]) {
    store.setMarkMany(ids, "like", false);
    store.setMarkMany(ids, "dislike", false);
    store.setMarkMany(ids, "report", false);
  }
  /**
   * 下载走 core/download：单张 {id36}.{ext}，多张打包 download.zip
   * （契约「下载」）。多张按当前可见顺序编号。
   */
  async function handleDownloadSelected(ids: number[]) {
    const picked = visiblePhotos.filter((p) => ids.includes(p.id));
    if (picked.length === 0) return;
    try {
      if (picked.length === 1) await downloadOne(picked[0]!);
      else await downloadZip(picked);
    } catch (e) {
      console.error("[download]", e);
    }
  }
  async function handleDownload(photo: Photo) {
    try {
      await downloadOne(photo);
    } catch (e) {
      console.error("[download]", photo.id, e);
    }
  }

  function handleSettingsChange(s: Settings) {
    layout = {
      dir: s.layout.dir,
      strategy: s.layout.strategy,
      band: s.layout.band,
      gap: s.layout.gap,
    };
    filters = { ...s.filters, types: new Set(s.filters.types) };
  }

  // 排序 + 筛选 → 最终给瀑布流的照片（筛选逻辑在 settings.ts，纯函数可测）
  let visiblePhotos = $derived.by(() => {
    let list = applyFilters(store.photos, filters, store.selfId);

    if (sortKey === "latest") {
      list = [...list].sort((a, b) =>
        sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt,
      );
    } else if (sortKey === "hottest") {
      const heat = (p: (typeof list)[number]) =>
        p.likes.length - p.dislikes.length;
      list = [...list].sort((a, b) =>
        sortAsc ? heat(a) - heat(b) : heat(b) - heat(a),
      );
    } else {
      // random：按当前打乱序号重排
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
    if (key === sortKey && key !== "random") {
      sortAsc = !sortAsc; // 再次单击 → 反向（最新↔最旧 / 最热↔最冷）
    } else if (key === "random" && key === sortKey) {
      randomOrder = shuffle(store.photos.map((p) => p.id)); // 重新打乱
    } else {
      sortKey = key;
      sortAsc = false;
      if (key === "random")
        randomOrder = shuffle(store.photos.map((p) => p.id));
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
  /** 顶栏「随机」再次单击 → 重新打乱（契约：每次单击重新打乱，Fisher-Yates）。 */
  function handleReshuffle() {
    randomOrder = shuffle(store.photos.map((p) => p.id));
    sortKey = "random";
    sortAsc = false;
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
    if (input.files && input.files.length > 0) {
      pipeline.addFiles(input.files);
      input.value = "";
    }
  }
  function handleRetry(jobId: string) {
    pipeline.retry(jobId);
  }
  function handleSync() {
    void engine.sync();
  }
  function handleFilterReset() {
    resetToken++;
  }

  // 公告 op：反应 / 投票 / 反馈 → op-log（spec：全部写操作走 op-log → /sync 管线）
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
  <OverlaySidebar bind:open={leftOpen} side="left" title="设置">
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
      {sortAsc}
      {onSortChange}
      onSortReshuffle={handleReshuffle}
      onSettingsClick={toggleLeft}
      onSyncClick={handleSync}
      onAnnouncementClick={toggleRight}
      onMultiSelectClick={handleMultiSelect}
      onUploadClick={handleUploadClick}
      onFilterBadgeClick={handleFilterReset}
      pendingCount={store.engineState.pending}
      {filterCount}
      isSyncing={store.engineState.syncing}
      settingsActive={leftOpen}
      announcementActive={rightOpen}
      multiSelectActive={multiMode}
    />

    <main class="flex-1 overflow-hidden p-4 pt-20 md:p-6 md:pt-20">
      {#if visiblePhotos.length === 0}
        <div
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div
            class="mb-4 flex size-20 items-center justify-center rounded-full bg-card"
          >
            <svg
              class="size-10 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <p class="text-muted-foreground">
            {store.photos.length === 0
              ? "还没有照片，点击右上角上传第一张吧"
              : "没有符合筛选的照片"}
          </p>
        </div>
      {:else}
        <WaterfallLayout
          photos={visiblePhotos}
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
          onUnmark={handleUnmark}
          onDeleteSelected={handleDeleteSelected}
          onDownloadSelected={handleDownloadSelected}
          onUnmarkSelected={handleUnmarkSelected}
          onDownload={handleDownload}
        />
      {/if}
    </main>
  </div>

  <!-- Right Sidebar (Announcements) -->
  <OverlaySidebar bind:open={rightOpen} side="right" title="公告">
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

  <!-- Upload progress -->
  <div class="fixed bottom-4 right-4 z-30 w-72">
    <UploadProgressPanel tasks={uploadTasks} onRetry={handleRetry} />
  </div>

  <!-- Toast notifications -->
  <Toaster position="bottom-center" richColors closeButton />
</div>
