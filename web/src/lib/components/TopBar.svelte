<script lang="ts">
  // Top bar. Left: sort pill, settings icon (filter-count badge), sync icon
  // (pending-count badge, spins while syncing); right: announcements, multi-select, upload.
  // Fixed full width + frosted glass, not sticky (iOS Safari has a known backdrop-filter bug).
  import { Settings, Megaphone, CheckSquare, UploadCloud, Funnel } from '@lucide/svelte';
  import SortTabs, { type SortKey } from './SortTabs.svelte';
  import SyncButton from './SyncButton.svelte';
  import { scroll } from '../../state/scroll.svelte';
  import { copy } from '$shared/copy';

  interface Props {
    sortKey?: SortKey;
    /** Secondary direction (newest↔oldest, hottest↔coldest), remembered per sort item. */
    sortDirs?: Partial<Record<SortKey, boolean>>;
    onSortChange?: (key: SortKey) => void;
    onSortReshuffle?: () => void;
    onSettingsClick?: () => void;
    onSyncClick?: () => void;
    onAnnouncementClick?: () => void;
    onMultiSelectClick?: () => void;
    onUploadClick?: () => void;
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
    pendingCount = 0,
    filterCount = 0,
    isSyncing = false,
    settingsActive = false,
    announcementActive = false,
    multiSelectActive = false,
  }: Props = $props();

  // Immersive top bar: transparent with no border at the start of the main axis (scrollTop when
  // vertical, scrollLeft when horizontal), frosted glass fades in once scrolled.
  let scrolled = $derived(scroll.y > 8 || scroll.x > 8);
</script>

<header
  class="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between px-3 transition-[background-color,border-color,backdrop-filter] duration-[var(--duration-enter)] ease-[var(--ease-enter)] md:h-16 md:px-6 {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
>
  <div class="flex items-center gap-1">
    <!-- Sort pill: three-item segmented selector -->
    <SortTabs {sortKey} dirs={sortDirs} onChange={onSortChange} onReshuffle={onSortReshuffle} />

    <!-- Settings (count badge shown while filters are active) -->
    <div class="relative">
      <button
        type="button"
        class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
        class:text-primary={settingsActive}
        onclick={onSettingsClick}
        title={copy.topbar.settings}
      >
        <Settings class="size-5" />
      </button>
      {#if filterCount > 0}
        <span
          class="pointer-events-none absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Funnel class="size-2.5" />
        </span>
      {/if}
    </div>

    <!-- Sync -->
    <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
  </div>

  <div class="flex items-center gap-1">
    <button
      type="button"
      class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
      class:text-primary={announcementActive}
      onclick={onAnnouncementClick}
      title={copy.topbar.announcements}
    >
      <Megaphone class="size-5" />
    </button>

    <button
      type="button"
      class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
      class:text-primary={multiSelectActive}
      onclick={onMultiSelectClick}
      title={copy.topbar.multiSelect}
    >
      <CheckSquare class="size-5" />
    </button>

    <button
      type="button"
      class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
      onclick={onUploadClick}
      title={copy.topbar.upload}
    >
      <UploadCloud class="size-5" />
    </button>
  </div>
</header>
