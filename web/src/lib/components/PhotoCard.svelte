<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$shared/copy';
  import {
    ThumbsUp,
    ThumbsDown,
    Flag,
    VolumeX,
    Volume2,
    Check,
    RotateCcw,
    X,
  } from '@lucide/svelte';
  import GlitchText from './GlitchText.svelte';

  interface Props {
    photo: Photo;
    selfId?: number;
    /** Absolute coordinates from the layout engine (waterfall positioning). */
    x?: number;
    y?: number;
    width: number;
    height: number;
    /** Upload curtain overlay: fraction = progress (reveal ratio), failed = full cover + retry. */
    overlay?: { fraction?: number; failed?: boolean; error?: string };
    selected?: boolean;
    multiMode?: boolean;
    onClick?: () => void;
    onRetryUpload?: () => void;
    /** Dismiss a failed upload card (removes it from the waterfall). */
    onDismissUpload?: () => void;
    onLongPress?: () => void;
    onLike?: () => void;
    onDislike?: () => void;
    onRequestDelete?: () => void;
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
    onDismissUpload,
    onLongPress,
    onLike,
    onDislike,
    onRequestDelete,
  }: Props = $props();

  let isLiked = $derived(photo.likes.includes(selfId));
  let isDisliked = $derived(photo.dislikes.includes(selfId));
  let isReported = $derived(photo.reports.includes(selfId));
  let volumeMuted = $state(true);
  let loadFailed = $state(false);
  // HTTP status probed after a load failure; "0" = network error / CORS-blocked.
  // Falls back to "404" until the HEAD probe resolves.
  let failStatus = $state('404');
  let failController: AbortController | null = null;
  // The URL that has finished loading into the <img>/<video> below. The UI (skeleton /
  // opacity) is *derived* from `loadedUrl === photo.url`, so an object-identity swap on
  // every /sync keeps the loaded image visible; the browser caches decoding by URL itself.
  let loadedUrl = $state('');
  // type=1 (animated image without audio track) and type=2 (video with sound) are both
  // video media — inside the card they always play muted and looping, no poster frame.
  let isVideo = $derived(photo.type !== 0);

  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let didLongPress = false;

  function handlePointerDown() {
    didLongPress = false;
    longPressTimer = setTimeout(() => {
      didLongPress = true;
      onLongPress?.();
    }, 500);
  }

  function handlePointerUp() {
    if (longPressTimer) clearTimeout(longPressTimer);
  }

  // Releasing outside the card (drag off) or unmounting mid-press must not fire
  // the long press afterwards — it toggles multi-select from nowhere.
  function cancelLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }

  onDestroy(() => {
    cancelLongPress();
    failController?.abort();
  });

  // <img>/<video> onerror does not expose the HTTP status (browser security).
  // Send a HEAD probe so the fallback can show the real code (404/403/500…).
  // 0 means the request itself failed (network / CORS).
  function probeFailStatus(url: string) {
    failController?.abort();
    failController = new AbortController();
    fetch(url, { method: 'HEAD', cache: 'force-cache', signal: failController.signal })
      .then((res) => (failStatus = String(res.status)))
      .catch(() => {
        if (!failController?.signal.aborted) failStatus = '0';
      });
  }

  function handleClick() {
    if (didLongPress) return;
    onClick?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute overflow-hidden rounded-[14px] bg-card cursor-pointer border transition-[border-color,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)] {selected
    ? 'border-2 border-primary'
    : 'border-white/0 hover:border-white/10'}"
  style="left: {x}px; top: {y}px; width: {width}px; height: {height}px"
  role="button"
  tabindex="0"
  onclick={handleClick}
  onpointerdown={handlePointerDown}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onpointerleave={cancelLongPress}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') onClick?.();
  }}
>
  <!-- Media: on load failure render a glitching error code.
       Empty URL (upload still in flight) keeps the skeleton instead of an <img>
       whose instant error would flip the card to the fallback. -->
  {#if loadFailed}
    <div class="flex h-full w-full items-center justify-center bg-card">
      <GlitchText text={failStatus} size="clamp(2rem, 12vw, 3.5rem)" />
    </div>
  {:else if photo.url}
    {#if loadedUrl !== photo.url}
      <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
    {/if}
    {#if isVideo}
      <video
        src={photo.url}
        class="h-full w-full object-cover transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loadedUrl ===
        photo.url
          ? 'opacity-100'
          : 'opacity-0'}"
        muted={volumeMuted}
        loop
        autoplay
        playsinline
        onloadeddata={() => (loadedUrl = photo.url)}
        onerror={() => {
          loadFailed = true;
          probeFailStatus(photo.url);
        }}
      ></video>
    {:else}
      <img
        src={photo.url}
        alt=""
        class="h-full w-full object-cover transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loadedUrl ===
        photo.url
          ? 'opacity-100'
          : 'opacity-0'}"
        loading="lazy"
        draggable="false"
        onload={() => (loadedUrl = photo.url)}
        onerror={() => {
          loadFailed = true;
          probeFailStatus(photo.url);
        }}
      />
    {/if}
  {:else}
    <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
  {/if}

  <!-- Upload curtain overlay: lifts bottom-to-top with progress; failure returns to full cover + retry / dismiss -->
  {#if overlay}
    {#if overlay.failed}
      <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/75">
        <button
          type="button"
          class="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-white/10 text-white/85 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/25 hover:text-white"
          title={copy.photoCard.dismiss}
          aria-label={copy.photoCard.dismiss}
          onclick={(e) => {
            e.stopPropagation();
            onDismissUpload?.();
          }}
        >
          <X class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-full bg-white/10 text-white/85 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-primary hover:text-primary-foreground"
          title={copy.photoCard.retry}
          aria-label={copy.photoCard.retry}
          onclick={(e) => {
            e.stopPropagation();
            onRetryUpload?.();
          }}
        >
          <RotateCcw class="size-5" />
        </button>
      </div>
    {:else}
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/70"
        style="height: {Math.max(0, 1 - (overlay.fraction ?? 0)) * 100}%"
      ></div>
    {/if}
  {/if}

  <!-- Selection checkbox (top-right) -->
  {#if multiMode}
    <div class="absolute top-2 right-2 z-10">
      <div
        class="flex items-center justify-center size-6 rounded-full transition-all duration-[var(--duration-enter)] ease-[var(--ease-enter)] {selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-black/50 text-white/80 backdrop-blur-sm border border-white/20 hover:bg-black/70'}"
      >
        {#if selected}
          <Check class="size-4" />
        {/if}
      </div>
    </div>
  {/if}

  <!-- Mark badges: pills overlaid on the image, each hidden entirely when its count is zero.
       Color language: the user's own mark = solid cyan (fill-current on the icon); everyone else's
       marks = outline cyan at reduced opacity (plain white read as monotone). -->
  <div class="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
    {#if photo.likes.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75"
        onclick={(e) => {
          e.stopPropagation();
          onLike?.();
        }}
      >
        <ThumbsUp class="size-3 {isLiked ? 'fill-current text-[#f43f5e]' : 'text-[#f43f5e]/60'}" />
        <span class="tabular-nums">{photo.likes.length}</span>
      </button>
    {/if}

    {#if photo.dislikes.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75"
        onclick={(e) => {
          e.stopPropagation();
          onDislike?.();
        }}
      >
        <ThumbsDown
          class="size-3 {isDisliked ? 'fill-current text-[#3b82f6]' : 'text-[#3b82f6]/60'}"
        />
        <span class="tabular-nums">{photo.dislikes.length}</span>
      </button>
    {/if}

    {#if photo.reports.length > 0}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75"
        onclick={(e) => {
          e.stopPropagation();
          onRequestDelete?.();
        }}
      >
        <Flag class="size-3 {isReported ? 'fill-current text-amber-400' : 'text-amber-400/60'}" />
        <span class="tabular-nums">{photo.reports.length}</span>
      </button>
    {/if}
  </div>

  <!-- Volume button (type=2 video with sound) -->
  {#if photo.type === 2}
    <button
      type="button"
      class="absolute bottom-2 right-2 z-10 flex items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/70 backdrop-blur-[4px] transition-[background-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-[#22d3ee]/20 hover:scale-105"
      style="width: 1.9rem; height: 1.9rem"
      onclick={(e) => {
        e.stopPropagation();
        volumeMuted = !volumeMuted;
      }}
    >
      {#if volumeMuted}
        <VolumeX class="size-4 text-amber-500" />
      {:else}
        <Volume2 class="size-4" />
      {/if}
    </button>
  {/if}
</div>
