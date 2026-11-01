<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { fmt, plural } from '$shared/copy';
  import { reflowFlipWindowMs } from '$base/lib/motion';
  import { prefersReducedMotion } from '$base/lib/device.svelte';
  import TooltipIconButton from './TooltipIconButton.svelte';
  import SiteIcon from './SiteIcon.svelte';
  import type { GeomStamp } from '$base/lib/layout';
  import type { UploadOverlay } from '../../core/pending';
  import { hasDecoded, markDecoded, forgetDecoded } from '../../state/decode.svelte';
  import {
    playbackVolume,
    isAudioMediaOpen,
    releaseAudio,
    toggleAudio,
  } from '../../state/playback.svelte';
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
    /** Upload curtain overlay; see `UploadOverlay` in `core/pending`. */
    overlay?: UploadOverlay;
    /** Whether the card is close enough to the viewport to hold decoded media. The
     *  virtualizer's buffer band renders cards before they are visible; keeping their
     *  images out of the DOM is what bounds decoded-image memory on a long album. */
    mediaNear?: boolean;
    /** Whether this card is INSIDE the live viewport, which is the one condition for smooth
     *  positional motion. A card outside it appears where it belongs and fades in; it never
     *  travels across the page, because that travel happens off-screen and only makes the
     *  layout look busy. Derived from the measured viewport at the moment of the change. */
    smoothMotion?: boolean;
    /** Whether this card was inside the viewport the last time it rendered. A card that was
     *  NOT visible then must not glide in on remount: it appears where it belongs and fades. */
    wasOnScreen?: boolean;
    /** Whether this card is in the autoplay band (the viewport's visible top row); the
     *  open-sound holder always keeps its player regardless of the band. */
    autoplay?: boolean;
    selected?: boolean;
    multiMode?: boolean;
    onClick?: () => void;
    onRetryUpload?: () => void;
    /** Dismiss a failed upload card (removes it from the waterfall). */
    onDismissUpload?: () => void;
    onLongPress?: () => void;
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
    mediaNear = true,
    smoothMotion = true,
    wasOnScreen = false,
    autoplay: autoplayProp = true,
    selected = false,
    multiMode = false,
    onClick,
    onRetryUpload,
    onDismissUpload,
    onLongPress,
  }: Props = $props();

  let isLiked = $derived(photo.likes.includes(selfId));
  let isDisliked = $derived(photo.dislikes.includes(selfId));
  let isReported = $derived(photo.reports.includes(selfId));
  /** Column or row is too small for the resting badge and volume sizes. */
  let tight = $derived(width < 140 || height < 64);
  // Mark badges are read-only on the card: they report the counts, they do not toggle
  // them. Every mark is made from the Lightbox, where the control is a real button.
  const badgeCls = $derived(
    tight
      ? 'flex items-center gap-0.5 rounded-full bg-black/55 px-1 py-px text-[10px] font-medium text-white/75 backdrop-blur-sm'
      : 'flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white/75 backdrop-blur-sm',
  );
  /** The shared open-sound state: this card is the player only while it holds the sound. */
  /** The card is now the ONLY element that sounds a media (the viewer keeps its own muted),
   *  so its mute follows the media's open state directly rather than which surface owns the
   *  unmute right. Any surface can open the sound — the viewer's control does — and the card
   *  is what plays it. */
  let volumeMuted = $derived(!isAudioMediaOpen(photo.url));
  let loadFailed = $state(false);
  // The card sits at 0,0 and moves purely by transform; a CSS transition interpolates
  // between reflows and retargets mid-flight, so continuous reflows (a dragged slider)
  // glide instead of restart-jumping. `placed` gates the transition until the first box
  // has landed, so a mount never slides in from the origin.
  let placed = $state(false);
  const reducedMotion = prefersReducedMotion();
  let fromBox: GeomStamp | null = $state(null);
  /**
   * Whether this card's positional change should be animated, decided ONCE per change.
   *
   * `smoothMotion` says whether the card is inside the live viewport RIGHT NOW. It is read at
   * the moment the box moves, not at mount: a card that was off-screen a frame ago is on
   * screen when its new position lands, and it must then simply appear rather than glide in
   * from somewhere the user never saw. The previous version snapshotted this at mount, so it
   * described the card's position at mount time and every later reflow ignored the rule.
   */
  let motionAllowed = $state(false);
  // Mount-time snapshot, on purpose. This sits outside every `$effect` in the component, so
  // no later prop update can retro-fire the flip — a remounting card either glides from the
  // box it last rendered at, or appears in place. `untrack` is what marks the props below as
  // deliberately read once: Svelte otherwise warns that they only capture their initial
  // value, which is exactly the intent, and `--fail-on-warnings` would fail the build.
  untrack(() => {
    const remembered =
      motionMemory &&
      !reducedMotion &&
      // A card may only glide in if the eye could already see it when it left. `wasOnScreen`
      // is the reading from its last frame, so a card that scrolled in from off-screen stays
      // put instead of flying in from wherever it used to sit.
      wasOnScreen &&
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
  /** The box this card last rendered, used to tell a position change from a re-render. */
  const initialBox = untrack(() => ({ x, y, w: width, h: height }));
  let lastBox = initialBox;
  $effect(() => {
    void x;
    void y;
    void width;
    void height;
    void fromBox;
    // Re-decide the transition class per POSITION CHANGE, not per mount: whether the move
    // may be animated depends on whether the card is on screen when the move lands.
    const moved = lastBox.x !== x || lastBox.y !== y || lastBox.w !== width || lastBox.h !== height;
    if (moved) {
      lastBox = { x, y, w: width, h: height };
      motionAllowed = smoothMotion;
    } else if (motionAllowed !== smoothMotion && !fromBox) {
      motionAllowed = smoothMotion;
    }
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
  // every sync keeps the loaded image visible; the browser caches decoding by URL itself.
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

  // Failed media renders the shared site mark below; the Lightbox additionally toasts, since
  // the card itself still opens into it. type=1 (animated image without an audio track) and
  // type=2 (video with sound) are both video media — a card plays them muted and looping.
  let isVideo = $derived(photo.type !== 0);
  /** The card's own `<video>`; its `volume` follows the shared playback level and its `muted`
   *  the shared open-sound state, so the slider never unmutes an autoplay element. */
  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  $effect(() => {
    if (videoEl) videoEl.volume = playbackVolume.value;
  });
  /** Band membership plus the sound exemption: a card whose media has its sound open keeps
   *  playing even after the band moves on — the page says its audio is open, and neither
   *  scrolling nor opening the viewer may cut it. The exemption is keyed on the MEDIA, not on
   *  this surface's ownership, so entering the Lightbox (which takes the unmute right for
   *  itself) does not pause the card underneath: that would stop and restart the same audio
   *  stream across the entry, which is the gap this avoids. */
  let playsHere = $derived(autoplayProp || isAudioMediaOpen(photo.url));
  // The band is a playback cap, not a source cap: the source is always attached, so leaving
  // the band pauses on the frame it reached and re-entering resumes from it — no reload, no
  // skeleton, no restart. The `autoplay` attribute is only honoured at load, so every
  // resumption is an explicit play().
  $effect(() => {
    if (!videoEl) return;
    if (!playsHere) {
      if (!videoEl.paused) videoEl.pause();
      return;
    }
    if (videoEl.paused) void videoEl.play().catch(() => undefined);
  });
  // Opening the sound is a user gesture; the explicit play() lets a card outside the band
  // (or one whose element mounted after the state flipped) actually start rolling.
  $effect(() => {
    if (videoEl && isAudioMediaOpen(photo.url)) void videoEl.play().catch(() => undefined);
  });
  /** Media is only in the DOM within the load band. Outside it the card keeps its box and
   *  paints the skeleton, which is what releases the decoded bitmap: an `<img>` element left in
   *  the document holds its full-resolution decode for as long as it exists.
   *
   *  A card whose media is already decoded keeps rendering it even outside the band. The band
   *  exists to bound decoded bitmaps, and the bitmap is already resident — refusing to mount
   *  it only produced a skeleton over media the page had plainly shown seconds earlier (the
   *  reported "Lightbox loaded instantly, card stuck on the skeleton"). "Decoded" is the
   *  page-wide record in `state/decode.svelte.ts`, not this card's own guess, so a preview
   *  that decoded in the viewer counts here too. The element still unmounts on a true
   *  teardown, which releases the decode as before. */
  let showMedia = $derived(photo.url !== '' && (mediaNear || hasDecoded(photo.url)));
  // Keep `loadedUrl` across band exits so a card that scrolls back in paints its media
  // immediately instead of flashing a skeleton. The media element itself still unmounts
  // (releasing the decode), and `loadedUrl === photo.url` makes the return paint straight
  // into the <video> — the browser re-fetches from its HTTP cache, no spinner.
  onDestroy(() => {
    // A detached <video> can keep decoding; an <img> keeps its decode until it is collected.
    // Detaching the source first tells the browser to let go of both.
    const video = videoEl;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    // An unmounted card cannot keep the sound open; another surface's sound is untouched.
    // `photo` is re-read from the each scope at teardown: when the card unmounts because
    // its photo left the map (a removed upload), the scope already reads undefined.
    releaseAudio(photo?.url ?? '', 'grid');
  });
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

  // A card whose media will not load reads as "cannot be shown". Media is fetched
  // cross-origin, where an <img>/<video> error event carries no HTTP status and fetch()
  // can only return an opaque response — that is the only thing the card knows.

  /**
   * A media element that cannot load its source. A local preview is a stand-in for bytes the
   * browser may still be able to decode, so a transient failure keeps the skeleton rather than
   * claiming the file is broken. It is only transient while the job is still running: a job that
   * has already failed has nothing left to wait for, and leaving it on the skeleton makes the
   * card read as "still loading" forever. A hosted URL is never retried, so it fails immediately.
   */
  function handleMediaError(): void {
    if (overlay?.preview && !overlay.failed) return;
    loadFailed = true;
    // The media that failed must stop counting as decoded, or a later remount would trust
    // the page-wide record, mount the same URL again, and fail in the same place.
    forgetDecoded(photo.url);
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
  class="absolute left-0 top-0 overflow-hidden rounded-[var(--radius-card)] bg-card cursor-pointer border {selected
    ? 'border-primary'
    : 'border-white/0 hover:border-white/10'}"
  class:card-motion={placed && motionAllowed}
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
  <!-- Media: on load failure render the site mark in muted grey. The failure is also reported
       by the Lightbox toast, which the card still opens; the grid shows this mark instead of
       silence. Empty URL (upload still in flight) keeps the skeleton instead of an <img>
       whose instant error would flip the card to the fallback. -->
  {#if loadFailed}
    <div class="flex h-full w-full items-center justify-center bg-card text-muted-foreground/50">
      <SiteIcon size={width < 140 ? 24 : 40} />
    </div>
  {:else if showMedia}
    {#if loadedUrl !== photo.url}
      <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
    {/if}
    {#if isVideo}
      <div class="absolute inset-0 overflow-hidden rounded-[var(--radius-card)]">
        <video
          bind:this={videoEl}
          src={photo.url}
          class="h-full w-full object-cover rounded-[var(--radius-card)] transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loadedUrl ===
          photo.url
            ? 'opacity-100'
            : 'opacity-0'}"
          muted={volumeMuted}
          loop
          preload="metadata"
          autoplay={playsHere}
          playsinline
          onloadeddata={() => {
            loadedUrl = photo.url;
            markDecoded(photo.url);
          }}
          onerror={handleMediaError}
        ></video>
      </div>
    {:else}
      <img
        src={photo.url}
        alt=""
        class="h-full w-full object-cover transition-opacity duration-[var(--duration-enter)] ease-[var(--ease-enter)] {loadedUrl ===
        photo.url
          ? 'opacity-100'
          : 'opacity-0'}"
        loading="lazy"
        decoding="async"
        draggable="false"
        onload={() => {
          loadedUrl = photo.url;
          markDecoded(photo.url);
        }}
        onerror={handleMediaError}
      />
    {/if}
  {:else}
    <div class="absolute inset-0 skeleton" aria-hidden="true"></div>
  {/if}

  <!-- Upload curtain overlay: lifts bottom-to-top with progress; failure returns to full cover + retry / dismiss -->
  {#if overlay}
    {#if overlay.failed}
      <!-- Failure cover with retry and dismiss controls. Semi-transparent on purpose: the
           card underneath is still a card to select, not a hole in the grid. -->
      <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/55">
        <!-- Multi-select owns the top-right corner here too: a failed card is selectable, so
             its dismiss control would cover the checkbox and swallow the tap. Retry stays —
             it is in the middle of the card, nowhere near the corner. -->
        {#if !multiMode}
          <TooltipIconButton
            text={copy.photoCard.dismiss}
            side="bottom"
            danger
            class="absolute top-2 right-2 size-8 rounded-full hover:text-destructive"
            onclick={(event) => {
              event.stopPropagation();
              onDismissUpload?.();
            }}
          >
            <X class="size-4" />
          </TooltipIconButton>
        {/if}
        <!-- Retry is the primary action on a failed card: a 56px target with a 28px
             glyph, so it is comfortable on touch and clearly the way out. -->
        <TooltipIconButton
          text={copy.photoCard.retry}
          side="bottom"
          class="size-14 rounded-full text-primary/70 hover:bg-primary/10 hover:text-primary"
          onclick={(event) => {
            event.stopPropagation();
            onRetryUpload?.();
          }}
        >
          <RotateCcw class="size-7" />
        </TooltipIconButton>
      </div>
    {:else}
      <!-- Reveal media with upload progress while keeping a cancellation veil until server completion. -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/70 transition-[height] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
        style="height: {Math.max(0, 1 - Math.min(overlay.fraction ?? 0, CURTAIN_MAX_OPEN)) * 100}%"
      ></div>
      <!-- Multi-select owns the top-right corner: its checkbox lives there, so the cancel
           control would sit on top of it and swallow the tap. It returns with the mode. -->
      {#if !multiMode}
        <TooltipIconButton
          text={copy.photoCard.dismiss}
          side="bottom"
          danger
          class="absolute top-2 right-2 z-30 size-8 rounded-full hover:text-destructive"
          onclick={(event) => {
            event.stopPropagation();
            onDismissUpload?.();
          }}
        >
          <X class="size-4" />
        </TooltipIconButton>
      {/if}
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

  <!-- Mark badges, hidden when the count is zero. Display only — the card reports the
       counts, the Lightbox is where a mark is made. The viewer's own mark is filled;
       others use the same hue at lower opacity. -->
  <div
    class="absolute z-10 flex flex-wrap items-center {tight
      ? 'bottom-1 left-1 max-w-[calc(100%-0.35rem)] gap-1'
      : 'bottom-2 left-2 max-w-[calc(100%-0.5rem)] gap-1.5'}"
  >
    {#if photo.likes.length > 0}
      <span
        class={badgeCls}
        role="img"
        aria-label={fmt(plural(photo.likes.length, copy.photoCard.likes), {
          count: photo.likes.length,
        })}
      >
        <ThumbsUp
          class="{tight ? 'size-2.5' : 'size-3'} {isLiked
            ? 'fill-current text-destructive'
            : 'text-destructive/60'}"
        />
        <span class="tabular-nums">{photo.likes.length}</span>
      </span>
    {/if}

    {#if photo.dislikes.length > 0}
      <span
        class={badgeCls}
        role="img"
        aria-label={fmt(plural(photo.dislikes.length, copy.photoCard.dislikes), {
          count: photo.dislikes.length,
        })}
      >
        <ThumbsDown
          class="{tight ? 'size-2.5' : 'size-3'} {isDisliked
            ? 'fill-current text-dislike'
            : 'text-dislike/60'}"
        />
        <span class="tabular-nums">{photo.dislikes.length}</span>
      </span>
    {/if}

    {#if photo.reports.length > 0}
      <span
        class={badgeCls}
        role="img"
        aria-label={fmt(plural(photo.reports.length, copy.photoCard.reports), {
          count: photo.reports.length,
        })}
      >
        <Flag
          class="{tight ? 'size-2.5' : 'size-3'} {isReported
            ? 'fill-current text-warning'
            : 'text-warning/60'}"
        />
        <span class="tabular-nums">{photo.reports.length}</span>
      </span>
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
        // A card whose upload is still in flight has no media URL yet; there is nothing to open.
        if (!photo.url) return;
        toggleAudio(photo.url, 'grid');
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
     restart-jumping. border-color/opacity ride along because a Tailwind transition
     utility would be overridden by this unlayered shorthand. */
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
