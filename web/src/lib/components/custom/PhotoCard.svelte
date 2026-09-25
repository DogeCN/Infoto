<script lang="ts">
  import type { Photo } from '$shared/types';
  import { ThumbsUp, ThumbsDown, Flag, VolumeX, Volume2, Check, RotateCcw } from '@lucide/svelte';
  import PhotoFallback from './PhotoFallback.svelte';

  interface Props {
    photo: Photo;
    selfId?: number;
    /** 布局引擎给出的绝对坐标（瀑布流定位）。 */
    x?: number;
    y?: number;
    width: number;
    height: number;
    /** 上传窗帘遮罩：fraction=进度（拉开比例），failed=全遮罩待重试。 */
    overlay?: { fraction?: number; failed?: boolean };
    selected?: boolean;
    multiMode?: boolean;
    onClick?: () => void;
    onRetryUpload?: () => void;
    onLongPress?: () => void;
    onLike?: () => void;
    onDislike?: () => void;
    onRequestDelete?: () => void;
    onVolumeToggle?: () => void;
  }

  let {
    photo,
    selfId = -1,
    x = 0,
    y = 0,
    width,
    height,
    overlay,
    selected = false,
    multiMode = false,
    onClick,
    onRetryUpload,
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
  let loaded = $state(false);
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
  class="absolute overflow-hidden rounded-[14px] bg-card cursor-pointer border transition-[border-color,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)] {selected ? 'border-2 border-primary' : 'border-white/0 hover:border-white/10'}"
  style="left: {x}px; top: {y}px; width: {width}px; height: {height}px"
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
  {:else}
    {#if !loaded}
      <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
    {/if}
    {#if isVideo}
      <video
        src={photo.url}
        class="h-full w-full object-cover transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loaded ? 'opacity-100' : 'opacity-0'}"
        muted={volumeMuted}
        loop
        autoplay
        playsinline
        onloadeddata={() => (loaded = true)}
        onerror={() => (loadFailed = true)}
      ></video>
    {:else}
      <img
        src={photo.url}
        alt=""
        class="h-full w-full object-cover transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loaded ? 'opacity-100' : 'opacity-0'}"
        loading="lazy"
        draggable="false"
        onload={() => (loaded = true)}
        onerror={() => (loadFailed = true)}
      />
    {/if}
  {/if}

  <!-- 上传窗帘遮罩：随进度自下而上拉开；失败回到全遮罩 + 重试 -->
  {#if overlay}
    {#if overlay.failed}
      <div class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/75">
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-full bg-white/10 text-white/85 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-primary hover:text-primary-foreground"
          title="重试上传"
          onclick={(e) => { e.stopPropagation(); onRetryUpload?.(); }}
        >
          <RotateCcw class="size-5" />
        </button>
        <span class="text-xs text-white/70">上传失败</span>
      </div>
    {:else}
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/70"
        style="height: {Math.max(0, 1 - (overlay.fraction ?? 0)) * 100}%"
      >
        <div class="absolute inset-x-0 bottom-1 text-center text-[10px] font-medium tabular-nums text-white/60">
          {Math.round((overlay.fraction ?? 0) * 100)}%
        </div>
      </div>
    {/if}
  {/if}

  <!-- Selection checkbox (top-right) -->
  {#if multiMode}    <div class="absolute top-2 right-2 z-10">
      <div class="flex items-center justify-center size-6 rounded-full transition-all duration-[var(--duration-enter)] ease-[var(--ease-enter)] {selected ? 'bg-primary text-primary-foreground' : 'bg-black/50 text-white/80 backdrop-blur-sm border border-white/20 hover:bg-black/70'}">
        {#if selected}
          <Check class="size-4" />
        {/if}
      </div>
    </div>
  {/if}

  <!-- 标记徽章：叠图 pill，计数为零则整项隐藏（v1 语言） -->
  <div class="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
    {#if photo.likes.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75 {isLiked ? 'text-[#f43f5e]' : ''}"
        onclick={(e) => { e.stopPropagation(); onLike?.(); }}
      >
        <ThumbsUp class="size-3" />
        <span>{photo.likes.length}</span>
      </button>
    {/if}

    {#if photo.dislikes.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75 {isDisliked ? 'text-[#3b82f6]' : ''}"
        onclick={(e) => { e.stopPropagation(); onDislike?.(); }}
      >
        <ThumbsDown class="size-3" />
        <span>{photo.dislikes.length}</span>
      </button>
    {/if}

    {#if photo.reports.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75 {isReported ? 'text-amber-400' : ''}"
        onclick={(e) => { e.stopPropagation(); onRequestDelete?.(); }}
      >
        <Flag class="size-3" />
        <span>{photo.reports.length}</span>
      </button>
    {/if}
  </div>

  <!-- 音量按钮（type=2 有声视频） -->
  {#if photo.type === 2}
    <button
      type="button"
      class="absolute bottom-2 right-2 z-10 flex items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/70 backdrop-blur-[4px] transition-[background-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-[#22d3ee]/20 hover:scale-105"
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
