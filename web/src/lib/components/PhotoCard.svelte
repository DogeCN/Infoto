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
  /** Largest fraction the upload curtain may open to while the job is still running. */
  const CURTAIN_MAX_OPEN = 0.9;

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

  /**
   * A local preview can be a source this browser cannot decode (HEIC, an exotic video
   * codec) — that is not a broken photo, so it degrades to the skeleton and waits for
   * the real URL instead of showing the glitch fallback.
   */
  function handleMediaError(): void {
    if (overlay?.preview) return;
    loadFailed = true;
    probeFailStatus(photo.url);
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
      <!-- Curtain back down to full cover. Both controls are the bare glyph: no plate,
           no ring, no hover fill — the stroke colour is the only feedback channel, so a
           hover cannot introduce a surface the resting state does not have. -->
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
      <!-- The curtain: the media is uncovered from the bottom as the leg progresses. Its
           remove button rides on top of it — a cancel must be available mid-flight, not
           only once the job has already failed.

           The last sliver never opens while the job is still running: XHR reports the
           request body as fully sent almost immediately (it measures the socket buffer,
           not the host's response), so on a fast local link the fraction jumps straight
           to 1 and an uncapped curtain would vanish at once — a card under upload looked
           like a bare photo with a stray X. The veil now survives until 'done' removes
           the overlay. -->
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
