<script lang="ts">
  // Sanitized Markdown rendering. External images are enabled only for trusted content.
  import { onDestroy } from 'svelte';
  import DOMPurify from 'dompurify';
  import {
    createMarkdownRenderer,
    MARKDOWN_PUBLIC,
    MARKDOWN_TRUSTED,
    renderMarkdown,
  } from '../../core/markdown';
  import { audio, playbackVolume, toggleAudio } from '../../state/playback.svelte';
  import { copy } from '$lib/i18n.svelte';

  // Two independent renderers. The public one (sidebar feedback, admin feedback) drops images
  // to their alt text and refuses raw HTML, because a visitor authors that text; the trusted
  // one (announcements, editor preview) renders media in place and accepts HTML — behind the
  // same sanitizer, which is the only thing standing between an owner-authored style element
  // and every reader's page.
  const mdSafe = createMarkdownRenderer(MARKDOWN_PUBLIC);
  // The trusted renderer emits the final media element itself: the extension decides whether
  // `![alt](url)` becomes an image, a video, an audio player or a download link. Nothing has to
  // be replaced after parsing, so the browser never fetches a placeholder `<img>` first.
  const mdFull = createMarkdownRenderer(MARKDOWN_TRUSTED);

  // Inline SVG icons, byte-identical geometry to the @lucide/svelte volume-x / volume-2
  // icons the card and Lightbox render (this button is built imperatively, so it cannot
  // host Svelte components).
  const VOLUME_OFF =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"></path><path d="m16.5 14.5 5-5"></path><path d="m16.5 9.5 5 5"></path></svg>';
  const VOLUME_ON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"></path><path d="M16 9a5 5 0 0 1 0 6"></path><path d="M19.364 18.364a9 9 0 0 0 0-12.728"></path></svg>';

  // Base classes shared by the muted/unmuted states; only the colour tier changes — same
  // rule set as the waterfall card and Lightbox corner button.
  const VOLUME_BTN_BASE =
    'absolute bottom-2 right-2 z-10 flex size-8 items-center justify-center rounded-full border backdrop-blur-[4px] transition-[background-color,border-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:scale-105 active:scale-95';
  const VOLUME_BTN_MUTED = 'border-white/15 bg-black/55 text-white/70 hover:bg-primary/20';
  const VOLUME_BTN_UNMUTED = 'border-primary/50 bg-primary/20 text-primary';

  let {
    content,
    class: className = '',
    allowImages = false,
  }: { content: string; class?: string; allowImages?: boolean } = $props();

  const renderer = $derived(allowImages ? mdFull : mdSafe);

  let el: HTMLDivElement | undefined = $state(undefined);
  let html = $derived(renderMarkdown(renderer, DOMPurify, content));

  /** Drop the shimmer and reserve the media's real ratio once its intrinsic size is known. */
  function settleMedia(media: HTMLImageElement | HTMLVideoElement): void {
    const holder = media.closest('.md-media');
    if (!(holder instanceof HTMLElement)) return;
    holder.classList.remove('skeleton');
    const width = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
    const height = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
    // `complete` alone is not enough: it can be true with naturalWidth 0. A real intrinsic
    // size is what keeps the holder from staying on its 16:10 placeholder.
    if (width > 0 && height > 0) holder.style.aspectRatio = `${width} / ${height}`;
  }

  /** One delegated listener set covers every media element, including the ones a content
   *  change inserts after mount. `volume` is a property, so the shared playback level is
   *  written here as each video reports its metadata. */
  function mediaLifecycle(node: HTMLElement) {
    const onEvent = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLVideoElement) target.volume = playbackVolume.value;
      if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
        settleMedia(target);
      }
    };
    const events = ['load', 'loadedmetadata', 'error'] as const;
    for (const name of events) node.addEventListener(name, onEvent, true);
    return {
      destroy: () => {
        for (const name of events) node.removeEventListener(name, onEvent, true);
      },
    };
  }

  function apply() {
    if (!el) return;
    // The renderer already produced the final elements and DOMPurify sanitized them, so a
    // direct assignment starts exactly one request per media file — never one per `<img>`.
    el.innerHTML = html;
    // A cached image can report complete before its load event is dispatched.
    for (const img of el.querySelectorAll<HTMLImageElement>('.md-media img')) {
      if (img.complete && img.naturalWidth > 0) settleMedia(img);
    }
  }
  $effect(() => {
    if (!el) return;
    apply();
  });

  // The playback slider retunes the videos already on screen; a video rendered later picks
  // the level up from the delegated load listener in `mediaLifecycle`.
  $effect(() => {
    const level = playbackVolume.value;
    if (!el) return;
    for (const video of el.querySelectorAll('video')) video.volume = level;
  });
  // One open sound for the whole page: a click on a card's button or the viewer silences
  // these videos, and the button here silences a card or the viewer. Keyed by media URL;
  // `html` keeps the pass running for elements a content change inserts. Each video gets
  // the same corner volume button as the waterfall card and Lightbox — clicking the picture
  // itself does nothing; only the button toggles sound.
  $effect(() => {
    void html;
    const { url, surface } = audio;
    if (!el) return;
    for (const video of el.querySelectorAll('video')) {
      const key = video.currentSrc || video.src;
      const muted = !(surface === 'markdown' && url !== null && key === url);
      video.muted = muted;

      const holder = video.closest('.md-media');
      if (!(holder instanceof HTMLElement)) continue;
      holder.style.position = 'relative';
      let btn = holder.querySelector('.md-volume-btn') as HTMLButtonElement | null;
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = VOLUME_BTN_BASE;
        holder.appendChild(btn);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleAudio(video.currentSrc || video.src, 'markdown');
        });
      }
      const open = !muted;
      btn.setAttribute('aria-label', open ? copy.lightbox.mute : copy.lightbox.unmute);
      btn.innerHTML = open ? VOLUME_ON : VOLUME_OFF;
      btn.className = `${VOLUME_BTN_BASE} ${open ? VOLUME_BTN_UNMUTED : VOLUME_BTN_MUTED}`;
    }
  });
  onDestroy(() => {
    if (el) el.innerHTML = '';
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="prose prose-invert prose-sm max-w-none break-words {className}"
  role="presentation"
  use:mediaLifecycle
></div>

<style>
  /* Rendered media (announcements only, allowImages) follows the site's
     rounded-card language. */
  div :global(img),
  div :global(video.markdown-video) {
    border-radius: 0.5rem;
  }

  /* <video> has no prose sizing of its own (unlike img) — cap it to the column.
     Intrinsic track size drives the height. */
  div :global(video.markdown-video) {
    display: block;
    max-width: 100%;
    height: auto;
  }

  /* A sound file renders as the browser's own player, full width of the column. */
  div :global(audio.markdown-audio) {
    display: block;
    width: 100%;
  }

  /* A file Markdown has no element for (a PDF, a zip) renders as a download link — not a
     broken image, which is what an `<img>` pointing at a PDF would be. */
  div :global(a.markdown-file) {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-foreground);
    text-decoration: none;
    word-break: break-all;
  }
  div :global(a.markdown-file:hover) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  /* Loading placeholder: reserves a 16:10 box until the media reports its real aspect
     (then the holder resizes to hug the content), and carries the shared shimmer.
     The radius lives here with the clip, so it always rounds the visible media. */
  div :global(.md-media) {
    display: block;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-radius: 0.5rem;
  }

  div :global(.md-media img),
  div :global(.md-media video) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
