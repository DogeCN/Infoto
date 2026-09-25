<script lang="ts">
  // 顶栏（spec: "主页面"）。左：排序胶囊、设置图标（带筛选计数角标）、同步图标
  // （带未同步计数角标、同步时旋转）；右：公告、多选、上传。
  // 固定全宽 + 毛玻璃，不用 sticky（iOS Safari 与 backdrop-filter 有已知 bug）。
  import { Settings, Megaphone, CheckSquare, UploadCloud } from '@lucide/svelte';
  import SortTabs, { type SortKey } from './SortTabs.svelte';
  import SyncButton from './SyncButton.svelte';
  import { scroll } from '../../state/scroll.svelte';

  interface Props {
    sortKey?: SortKey;
    /** 最新↔最旧、最热↔最冷 的次级方向，按排序项各自记忆。 */
    sortDirs?: Partial<Record<SortKey, boolean>>;
    onSortChange?: (key: SortKey) => void;
    onSortReshuffle?: () => void;
    onSettingsClick?: () => void;
    onSyncClick?: () => void;
    onAnnouncementClick?: () => void;
    onMultiSelectClick?: () => void;
    onUploadClick?: () => void;
    onFilterBadgeClick?: () => void;
    pendingCount?: number;
    filterCount?: number;
    isSyncing?: boolean;
    settingsActive?: boolean;
    announcementActive?: boolean;
    multiSelectActive?: boolean;
  }

  let {
    sortKey = 'latest',
    sortDirs = {},
    onSortChange,
    onSortReshuffle,
    onSettingsClick,
    onSyncClick,
    onAnnouncementClick,
    onMultiSelectClick,
    onUploadClick,
    onFilterBadgeClick,
    pendingCount = 0,
    filterCount = 0,
    isSyncing = false,
    settingsActive = false,
    announcementActive = false,
    multiSelectActive = false,
  }: Props = $props();

  // 沉浸顶栏：主轴在起点时透明无边框（纵向看 scrollTop、横向看 scrollLeft），
  // 滚动后浮现毛玻璃
  let scrolled = $derived(scroll.y > 8 || scroll.x > 8);
</script>

<header
  class="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between px-3 transition-[background-color,border-color,backdrop-filter] duration-[var(--duration-enter)] ease-[var(--ease-enter)] md:h-16 md:px-6 {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
>
  <div class="flex items-center gap-1">
    <!-- 排序胶囊：三项并列分段选择器 -->
    <SortTabs {sortKey} dirs={sortDirs} onChange={onSortChange} onReshuffle={onSortReshuffle} />

    <!-- 设置（有生效筛选时显示计数角标） -->
    <div class="relative">
      <button
        type="button"
        class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
        class:text-primary={settingsActive}
        onclick={onSettingsClick}
        title="设置"
      >
        <Settings class="size-5" />
      </button>
      {#if filterCount > 0}
        <button
          type="button"
          class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          title="重置筛选"
          onclick={(e) => {
            e.stopPropagation();
            onFilterBadgeClick?.();
          }}
        >
          {filterCount > 99 ? '99+' : filterCount}
        </button>
      {/if}
    </div>

    <!-- 同步 -->
    <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
  </div>

  <div class="flex items-center gap-1">
    <button
      type="button"
      class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
      class:text-primary={announcementActive}
      onclick={onAnnouncementClick}
      title="公告"
    >
      <Megaphone class="size-5" />
    </button>

    <button
      type="button"
      class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
      class:text-primary={multiSelectActive}
      onclick={onMultiSelectClick}
      title="多选"
    >
      <CheckSquare class="size-5" />
    </button>

    <button
      type="button"
      class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
      onclick={onUploadClick}
      title="上传"
    >
      <UploadCloud class="size-5" />
    </button>
  </div>
</header>
