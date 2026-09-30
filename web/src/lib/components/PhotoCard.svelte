<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
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
    /** Upload curtain overlay: fraction = progress (reveal ratio), failed = full cover + retry.
     *  `preview` marks media that is only a local stand-in, so a source the browser cannot
     *  decode falls back to the skeleton instead of the broken-photo placeholder. */
    overlay?: { fraction?: number; failed?: boolean; error?: string; preview?: boolean };
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
  /** Column or row is too small for the resting badge and volume sizes. */
  let tight = $derived(width < 140 || height < 64);
  const badgeCls = $derived(
    tight
      ? 'flex items-center gap-0.5 rounded-full bg-black/55 px-1 py-px text-[10px] font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75'
      : 'flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-black/75',
  );
  let volumeMuted = $state(true);
  let loadFailed = $state(false);
  // The URL that has finished loading into the <img>/<video> below. The UI (skeleton /
  // opacity) is *derived* from `loadedUrl === photo.url`, so an object-identity swap on
  // every /sync keeps the loaded image visible; the browser caches decoding by URL itself.
  let loadedUrl = $state('');
  let observedUrl = '';

  $effect(() => {
    const url = photo.url;
    if (url === observedUrl) return;
    observedUrl = url;
    if (url) {
      loadFailed = false;
    }
  });

  // A failed load is surfaced as a uniform "ERROR" glitch — the real HTTP status is
  // not reliably obtainable cross-origin (HEAD is CORS-gated), so showing a code
  // would be misleading.
  let failStatus = $state('ERROR');
  // type=1 (animated image without audio track) and type=2 (video with sound) are both
  // video media — inside the card they always play muted and looping, no poster frame.
  let isVideo = $derived(photo.type !== 0);
  /** Largest fraction the upload curtain may open to while the job is still running. */
  const CURTAIN_MAX_OPEN = 0.9;

  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let didLongPress = false;

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    cancelLongPress();
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
  });

  /** Display load failures for hosted media; retain the skeleton for unavailable local previews. */
  function handleMediaError(): void {
    if (overlay?.preview) return;
    loadFailed = true;
    failStatus = 'ERROR';
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
  aria-label={copy.lightbox.preview}
  aria-pressed={multiMode ? selected : undefined}
  tabindex="0"
  onclick={handleClick}
  onpointerdown={handlePointerDown}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onpointerleave={cancelLongPress}
  onkeydown={(e) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onClick?.();
  }}
>
  <!-- Media: on load failure render a glitching error code.
       Empty URL (upload still in flight) keeps the skeleton instead of an <img>
       whose instant error would flip the card to the fallback. -->
  {#if loadFailed}
    <div class="flex h-full w-full items-center justify-center bg-card [container-type:size]">
      <GlitchText
        text={failStatus}
        size={width < 140 ? 'clamp(0.65rem, 14cqmin, 0.85rem)' : 'clamp(1.25rem, 22cqmin, 3.5rem)'}
      />
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
        onerror={handleMediaError}
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
        onerror={handleMediaError}
      />
    {/if}
  {:else}
    <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
  {/if}

  <!-- Upload curtain overlay: lifts bottom-to-top with progress; failure returns to full cover + retry / dismiss -->
  {#if overlay}
    {#if overlay.failed}
      <!-- Failure cover with retry and dismiss controls. -->
      <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/75">
        <button
          type="button"
          class="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-destructive/70 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:text-destructive"
          title={copy.photoCard.dismiss}
          aria-label={copy.photoCard.dismiss}
          onclick={(e) => {
            e.stopPropagation();
            onDismissUpload?.();
          }}
        >
          <X class="size-4" />
        </button>
        <!-- Retry is the primary action on a failed card: a 56px target with a 28px
             glyph, so it is comfortable on touch and clearly the way out. -->
        <button
          type="button"
          class="flex size-14 items-center justify-center rounded-full text-primary/70 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:text-primary"
          title={copy.photoCard.retry}
          aria-label={copy.photoCard.retry}
          onclick={(e) => {
            e.stopPropagation();
            onRetryUpload?.();
          }}
        >
          <RotateCcw class="size-7" />
        </button>
      </div>
    {:else}
      <!-- Reveal media with upload progress while keeping a cancellation veil until server completion. -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/70 transition-[height] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
        style="height: {Math.max(0, 1 - Math.min(overlay.fraction ?? 0, CURTAIN_MAX_OPEN)) * 100}%"
      ></div>
      <button
        type="button"
        class="absolute top-2 right-2 z-30 flex size-8 items-center justify-center rounded-full text-destructive/70 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:text-destructive"
        title={copy.photoCard.dismiss}
        aria-label={copy.photoCard.dismiss}
        onclick={(e) => {
          e.stopPropagation();
          onDismissUpload?.();
        }}
      >
        <X class="size-4" />
      </button>
    {/if}
  {/if}

  <!-- Selection checkbox (top-right) -->
  {#if multiMode}
    <div class="absolute z-10 {tight ? 'top-1 right-1' : 'top-2 right-2'}">
      <div
        class="flex items-center justify-center rounded-full transition-all duration-[var(--duration-enter)] ease-[var(--ease-enter)] {tight
          ? 'size-4'
          : 'size-6'} {selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-black/50 text-white/80 backdrop-blur-sm border border-white/20 hover:bg-black/70'}"
      >
        {#if selected}
          <Check class={tight ? 'size-2.5' : 'size-4'} />
        {/if}
      </div>
    </div>
  {/if}

  <!-- Mark badges, hidden when the count is zero. The viewer's own mark is filled; others use the same hue at lower opacity. -->
  <div
    class="absolute z-10 flex flex-wrap items-center {tight
      ? 'bottom-1 left-1 max-w-[calc(100%-0.35rem)] gap-1'
      : 'bottom-2 left-2 max-w-[calc(100%-0.5rem)] gap-1.5'}"
  >
    {#if photo.likes.length > 0}
      <button
        type="button"
        class={badgeCls}
        aria-label={isLiked ? copy.lightbox.unlike : copy.lightbox.like}
        onclick={(e) => {
          e.stopPropagation();
          onLike?.();
        }}
      >
        <ThumbsUp
          class="{tight ? 'size-2.5' : 'size-3'} {isLiked
            ? 'fill-current text-[#f43f5e]'
            : 'text-[#f43f5e]/60'}"
        />
        <span class="tabular-nums">{photo.likes.length}</span>
      </button>
    {/if}

    {#if photo.dislikes.length > 0}
      <button
        type="button"
        class={badgeCls}
        aria-label={isDisliked ? copy.lightbox.undislike : copy.lightbox.dislike}
        onclick={(e) => {
          e.stopPropagation();
          onDislike?.();
        }}
      >
        <ThumbsDown
          class="{tight ? 'size-2.5' : 'size-3'} {isDisliked
            ? 'fill-current text-[#3b82f6]'
            : 'text-[#3b82f6]/60'}"
        />
        <span class="tabular-nums">{photo.dislikes.length}</span>
      </button>
    {/if}

    {#if photo.reports.length > 0}
      <button
        type="button"
        class={badgeCls}
        aria-label={isReported ? copy.lightbox.cancelReport : copy.lightbox.report}
        onclick={(e) => {
          e.stopPropagation();
          onRequestDelete?.();
        }}
      >
        <Flag
          class="{tight ? 'size-2.5' : 'size-3'} {isReported
            ? 'fill-current text-amber-400'
            : 'text-amber-400/60'}"
        />
        <span class="tabular-nums">{photo.reports.length}</span>
      </button>
    {/if}
  </div>

  <!-- Volume button (type=2 video with sound). A failed card has no media to mute. -->
  {#if photo.type === 2 && !loadFailed}
    <button
      type="button"
      class="absolute z-10 flex items-center justify-center rounded-full border backdrop-blur-[4px] transition-[background-color,border-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:scale-105 {tight
        ? 'bottom-1 right-1'
        : 'bottom-2 right-2'} {volumeMuted
        ? 'border-white/15 bg-black/55 text-white/70 hover:bg-[#22d3ee]/20'
        : 'border-[#22d3ee]/50 bg-[#22d3ee]/20 text-[#22d3ee]'}"
      aria-label={volumeMuted ? copy.lightbox.unmute : copy.lightbox.mute}
      style="width: {tight ? '1.25rem' : '1.9rem'}; height: {tight ? '1.25rem' : '1.9rem'}"
      onclick={(e) => {
        e.stopPropagation();
        volumeMuted = !volumeMuted;
      }}
    >
      {#if volumeMuted}
        <VolumeX class="{tight ? 'size-3' : 'size-4'} text-amber-500" />
      {:else}
        <Volume2 class={tight ? 'size-3' : 'size-4'} />
      {/if}
    </button>
  {/if}
</div>
