<script lang="ts">
  import type { Photo } from '$shared/types';
  import { ThumbsUp, ThumbsDown, Flag, VolumeX, Volume2, Check } from '@lucide/svelte';
  import PhotoFallback from './PhotoFallback.svelte';

  interface Props {
    photo: Photo;
    selfId?: number;
    width: number;
    height: number;
    selected?: boolean;
    multiMode?: boolean;
    onClick?: () => void;
    onLongPress?: () => void;
    onLike?: () => void;
    onDislike?: () => void;
    onRequestDelete?: () => void;
    onVolumeToggle?: () => void;
  }

  let {
    photo,
    selfId = -1,
    width,
    height,
    selected = false,
    multiMode = false,
    onClick,
    onLongPress,
    onLike,
    onDislike,
    onRequestDelete,
    onVolumeToggle,
  }: Props = $props();

  let isLiked = $derived(photo.likes.includes(selfId));
  let isDisliked = $derived(photo.dislikes.includes(selfId));
  let isReported = $derived(photo.reports.includes(selfId));
  let volumeMuted = $state(true);
  let loadFailed = $state(false);
  // 契约：type=1（无音轨动图）与 type=2（有声视频）都是视频类媒体，
  // 卡片内一律静音循环播放，不使用海报帧
  let isVideo = $derived(photo.type !== 0);

  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let didLongPress = false;

  function handlePointerDown(e: PointerEvent) {
    didLongPress = false;
    longPressTimer = setTimeout(() => {
      didLongPress = true;
      onLongPress?.();
    }, 500);
  }

  function handlePointerUp() {
    if (longPressTimer) clearTimeout(longPressTimer);
  }

  function handleClick() {
    if (didLongPress) return;
    onClick?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative overflow-hidden rounded-[var(--radius)] bg-card cursor-pointer {selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}"
  style="width: {width}px; height: {height}px"
  role="button"
  tabindex="0"
  onclick={handleClick}
  onpointerdown={handlePointerDown}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
>
  <!-- Media：加载失败渲染 <PhotoFallback>（契约「照片卡片」） -->
  {#if loadFailed}
    <PhotoFallback id={photo.id} sha256={photo.sha256} />
  {:else if isVideo}
    <video
      src={photo.url}
      class="h-full w-full object-cover"
      muted={volumeMuted}
      loop
      autoplay
      playsinline
      onerror={() => (loadFailed = true)}
    ></video>
  {:else}
    <img
      src={photo.url}
      alt=""
      class="h-full w-full object-cover"
      loading="lazy"
      onerror={() => (loadFailed = true)}
    />
  {/if}

  <!-- Selection checkbox (top-right) -->
  {#if multiMode}
    <div class="absolute top-2 right-2 z-10">
      <div class="flex items-center justify-center size-6 rounded-md {selected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white/80 backdrop-blur-sm border border-white/20'}">
        {#if selected}
          <Check class="size-4" />
        {/if}
      </div>
    </div>
  {/if}

  <!-- Bottom info bar with gradient -->
  <div class="absolute bottom-0 inset-x-0 p-2 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent">
    <!-- Left: vote badges -->
    <div class="flex items-center gap-1">
      {#if photo.likes.length > 0}
        <button
          type="button"
          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs transition-colors {isLiked ? 'bg-destructive/20 text-destructive' : 'bg-white/10 text-white/70 hover:bg-white/20'}"
          onclick={(e) => { e.stopPropagation(); onLike?.(); }}
        >
          <ThumbsUp class="size-3" />
          <span>{photo.likes.length}</span>
        </button>
      {/if}

      {#if photo.dislikes.length > 0}
        <button
          type="button"
          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs transition-colors {isDisliked ? 'bg-[#3b82f6]/20 text-[#3b82f6]' : 'bg-white/10 text-white/70 hover:bg-white/20'}"
          onclick={(e) => { e.stopPropagation(); onDislike?.(); }}
        >
          <ThumbsDown class="size-3" />
          <span>{photo.dislikes.length}</span>
        </button>
      {/if}

      {#if photo.reports.length > 0}
        <button
          type="button"
          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs transition-colors {isReported ? 'bg-amber-500/20 text-amber-500' : 'bg-white/10 text-white/70 hover:bg-white/20'}"
          onclick={(e) => { e.stopPropagation(); onRequestDelete?.(); }}
        >
          <Flag class="size-3" />
          <span>{photo.reports.length}</span>
        </button>
      {/if}
    </div>

    <!-- Right: volume button for videos -->
    {#if photo.type === 2}
      <button
        type="button"
        class="flex items-center justify-center rounded-full border border-white/15 bg-black/55 backdrop-blur-[4px] text-white/70 hover:bg-cyan-500/20 hover:text-cyan-400 hover:scale-105 transition-all"
        style="width: 1.9rem; height: 1.9rem"
        onclick={(e) => { e.stopPropagation(); volumeMuted = !volumeMuted; onVolumeToggle?.(); }}
      >
        {#if volumeMuted}
          <VolumeX class="size-4 text-amber-500" />
        {:else}
          <Volume2 class="size-4" />
        {/if}
      </button>
    {/if}
  </div>
</div>
