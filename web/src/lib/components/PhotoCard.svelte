<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { reflowFlipWindowMs } from '$base/lib/motion';
  import type { GeomStamp } from '$base/lib/layout';
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

  interface Props {
    photo: Photo;
    selfId?: number;
    /** Absolute coordinates from the layout engine (waterfall positioning). */
    x?: number;
    y?: number;
    width: number;
    height: number;
    /** Cross-mount geometry memory, so a card the virtualizer had unmounted can glide from
     *  the box it last rendered at instead of appearing at the new one. */
    motionMemory?: Map<number, GeomStamp>;
    /** performance.now() of the latest layout commit; a remount inside the flip window
     *  (derived from `--duration-reflow`) glides, a later one appears in place. */
    reflowAt?: number;
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
    motionMemory,
    reflowAt = 0,
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
  let cardEl: HTMLDivElement | undefined = $state(undefined);
  // The card sits at 0,0 and moves purely by transform; a CSS transition interpolates
  // between reflows and retargets mid-flight, so continuous reflows (a dragged slider)
  // glide instead of restart-jumping. `placed` gates the transition until the first box
  // has landed, so a mount never slides in from the origin.
  let placed = $state(false);
  // The virtualizer unmounts cards outside the scroll window, so on a reflow those cards
  // would remount straight at the new box. Within the flip window a remounting card is
  // painted at its remembered old box first, gets the transition enabled, then retargets
  // to the new box — same glide as the cards that stayed mounted. The window comes from
  // `--duration-reflow` (see `reflowFlipWindowMs`) rather than a literal of its own.
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fromBox: GeomStamp | null = $state(null);
  // Mount-time snapshot, on purpose. This sits outside every `$effect` in the component, so
  // no later prop update can retro-fire the flip — a remounting card either glides from the
  // box it last rendered at, or appears in place. `untrack` is what marks the props below as
  // deliberately read once: Svelte otherwise warns that they only capture their initial
  // value, which is exactly the intent, and `--fail-on-warnings` would fail the build.
  untrack(() => {
    const remembered =
      motionMemory &&
      !reducedMotion &&
      reflowAt > 0 &&
      performance.now() - reflowAt <= reflowFlipWindowMs
        ? motionMemory.get(photo.id)
        : undefined;
    if (
      remembered &&
      (remembered.x !== x ||
        remembered.y !== y ||
        remembered.w !== width ||
        remembered.h !== height)
    ) {
      fromBox = remembered;
    }
  });
  let cancelFlip: (() => void) | undefined;
  onDestroy(() => cancelFlip?.());
  let flipArmed = false;
  $effect(() => {
    void x;
    void y;
    void width;
    void height;
    void fromBox;
    if (fromBox) {
      if (!flipArmed) {
        flipArmed = true;
        // Frame A: enable the transition while the inline style still holds the old box;
        // frame B: retarget to the new box. Both must be separate painted commits or the
        // browser sees transition:none in the before-change style and skips the animation.
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
          placed = true;
          raf2 = requestAnimationFrame(() => {
            fromBox = null;
          });
        });
        cancelFlip = () => {
          cancelAnimationFrame(raf1);
          cancelAnimationFrame(raf2);
        };
      }
      return;
    }
    if (!placed) placed = true;
    motionMemory?.set(photo.id, { x, y, w: width, h: height });
  });
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

  // A media element that fails to load leaves a bare surface; the failure is reported by the
  // Lightbox, which this card still opens into. The grid itself stays silent about it.
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
  }

  function handleClick() {
    if (didLongPress) return;
    onClick?.();
  }
</script>

<!-- The border width stays constant: `border-width` is not in the transition list, so a
     selected `border-2` would snap 1px while the colour cross-fades. Only colour moves. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={cardEl}
  class="absolute left-0 top-0 overflow-hidden rounded-[var(--radius-card)] bg-card cursor-pointer border {selected
    ? 'border-primary'
    : 'border-white/0 hover:border-white/10'}"
  class:card-motion={placed}
  style="transform: translate3d({fromBox?.x ?? x}px, {fromBox?.y ?? y}px, 0); width: {fromBox?.w ??
    width}px; height: {fromBox?.h ?? height}px; transform-origin: top left"
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
  <!-- Media: on load failure the card keeps a bare raised surface. The failure is reported by
       the Lightbox, which the card still opens; the grid itself shows nothing.
       Empty URL (upload still in flight) keeps the skeleton instead of an <img>
       whose instant error would flip the card to the fallback. -->
  {#if loadFailed}
    <div class="h-full w-full bg-card"></div>
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
          class="icon-button icon-button--danger absolute top-2 right-2 size-8 rounded-full hover:text-destructive"
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
          class="icon-button size-14 rounded-full text-primary/70 hover:bg-primary/10 hover:text-primary"
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
            ? 'fill-current text-destructive'
            : 'text-destructive/60'}"
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
            ? 'fill-current text-dislike'
            : 'text-dislike/60'}"
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
            ? 'fill-current text-warning'
            : 'text-warning/60'}"
        />
        <span class="tabular-nums">{photo.reports.length}</span>
      </button>
    {/if}
  </div>

  <!-- Volume button (type=2 video with sound). A failed card has no media to mute. -->
  {#if photo.type === 2 && !loadFailed}
    <button
      type="button"
      class="absolute z-10 flex items-center justify-center rounded-full border backdrop-blur-[4px] transition-[background-color,border-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:scale-105 active:scale-95 {tight
        ? 'bottom-1 right-1'
        : 'bottom-2 right-2'} {volumeMuted
        ? 'border-white/15 bg-black/55 text-white/70 hover:bg-primary/20'
        : 'border-primary/50 bg-primary/20 text-primary'}"
      aria-label={volumeMuted ? copy.lightbox.unmute : copy.lightbox.mute}
      style="width: {tight ? '1.25rem' : '1.9rem'}; height: {tight ? '1.25rem' : '1.9rem'}"
      onclick={(e) => {
        e.stopPropagation();
        volumeMuted = !volumeMuted;
      }}
    >
      {#if volumeMuted}
        <VolumeX class="{tight ? 'size-3' : 'size-4'} text-warning" />
      {:else}
        <Volume2 class={tight ? 'size-3' : 'size-4'} />
      {/if}
    </button>
  {/if}
</div>

<style>
  /* Demo-standard reflow motion: the layout writes transform/width/height and this
     transition interpolates, so a reflow glides and retargets mid-flight instead of
     restart-jumping. border-color/opacity ride along because the Tailwind transition
     utility they used previously would be overridden by this unlayered shorthand. */
  .card-motion {
    transition:
      transform var(--duration-reflow) var(--ease-reflow),
      width var(--duration-reflow) var(--ease-reflow),
      height var(--duration-reflow) var(--ease-reflow),
      border-color var(--duration-exit) var(--ease-exit),
      opacity var(--duration-exit) var(--ease-exit);
  }
  @media (prefers-reduced-motion: reduce) {
    .card-motion {
      transition: none;
    }
  }
</style>
