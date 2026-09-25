<script lang="ts">
  // Fixed full-width top bar. Left: sort pills, settings icon (with active
  // filter count), sync icon (with pending count, spins while syncing);
  // right: announcements, multi-select, upload.
  // Uses position fixed, not sticky (known iOS Safari + backdrop-filter bug).
  import {
    Settings,
    Megaphone,
    CheckSquare,
    UploadCloud,
  } from "@lucide/svelte";
  import SortTabs, { type SortKey } from "./SortTabs.svelte";
  import SyncButton from "./SyncButton.svelte";
  import Tooltip from "./Tooltip.svelte";
  import { scroll } from "../../../state/scroll.svelte";

  interface Props {
    sortKey?: SortKey;
    /** Per-key remembered directions (latest oldest↔newest, hottest cold↔hot). */
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
    sortKey = "latest",
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

  // Immersive bar: transparent and borderless at the scroll origin; the
  // blurred surface fades in once the content moves.
  let scrolled = $derived(scroll.y > 8 || scroll.x > 8);
</script>

<header
  class="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between px-3 transition-[background-color,border-color,backdrop-filter] duration-[var(--duration-enter)] ease-[var(--ease-enter)] md:h-16 md:px-6 {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
>
  <div class="flex items-center gap-1">
    <!-- Sort pills: segmented three-way selector -->
    <SortTabs
      {sortKey}
      dirs={sortDirs}
      onChange={onSortChange}
      onReshuffle={onSortReshuffle}
    />

    <!-- Settings: badge shows the number of active filters -->
    <div class="relative">
      <Tooltip text="设置">
        <button
          type="button"
          aria-label="设置"
          class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
          class:text-primary={settingsActive}
          onclick={onSettingsClick}
        >
          <Settings class="size-5" />
        </button>
      </Tooltip>
      {#if filterCount > 0}
        <Tooltip text="重置筛选">
          <button
            type="button"
            aria-label="重置筛选（{filterCount} 项生效）"
            class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
            onclick={(e) => {
              e.stopPropagation();
              onFilterBadgeClick?.();
            }}
          >
            {filterCount > 99 ? "99+" : filterCount}
          </button>
        </Tooltip>
      {/if}
    </div>

    <!-- Sync -->
    <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
  </div>

  <div class="flex items-center gap-1">
    <Tooltip text="公告">
      <button
        type="button"
        aria-label="公告"
        class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
        class:text-primary={announcementActive}
        onclick={onAnnouncementClick}
      >
        <Megaphone class="size-5" />
      </button>
    </Tooltip>

    <Tooltip text="多选">
      <button
        type="button"
        aria-label="多选"
        class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
        class:text-primary={multiSelectActive}
        onclick={onMultiSelectClick}
      >
        <CheckSquare class="size-5" />
      </button>
    </Tooltip>

    <Tooltip text="上传">
      <button
        type="button"
        aria-label="上传"
        class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
        onclick={onUploadClick}
      >
        <UploadCloud class="size-5" />
      </button>
    </Tooltip>
  </div>
</header>
