<script lang="ts">
  // Sanitized Markdown rendering. External images are enabled only for trusted content.
  import { onDestroy } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import { markdownImageRule } from '../../core/markdown';

  // Two independent renderers: the default one blocks images (public sidebar
  // must not render arbitrary external image hosts); the trusted one allows them.
  const mdSafe = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable(['image']);
  const mdFull = new MarkdownIt({ html: false, linkify: true, breaks: true });
  // The trusted renderer emits the final media element itself: the extension decides whether
  // `![alt](url)` becomes an image, a video, an audio player or a download link. Nothing has to
  // be replaced after parsing, so the browser never fetches a placeholder `<img>` first.
  mdFull.renderer.rules.image = markdownImageRule;

  let {
    content,
    class: className = '',
    allowImages = false,
  }: { content: string; class?: string; allowImages?: boolean } = $props();

  const renderer = $derived(allowImages ? mdFull : mdSafe);

  let el: HTMLDivElement | undefined = $state(undefined);
  let html = $derived(DOMPurify.sanitize(renderer.render(content)));

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
   *  change inserts after mount. */
  function mediaLifecycle(node: HTMLElement) {
    const onEvent = (event: Event) => {
      const target = event.target;
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

  /** Video autoplays muted; a click toggles the sound. Delegated for the same reason. */
  function mediaClick(node: HTMLElement) {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      const video = target instanceof Element ? target.closest('video.markdown-video') : null;
      if (!(video instanceof HTMLVideoElement)) return;
      video.muted = !video.muted;
      // Unmuting a playing element can pause it in some browsers.
      void video.play().catch(() => undefined);
    };
    node.addEventListener('click', onClick);
    return { destroy: () => node.removeEventListener('click', onClick) };
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
  use:mediaClick
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
     broken image, which is what an <img> pointing at a PDF would be. */
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
