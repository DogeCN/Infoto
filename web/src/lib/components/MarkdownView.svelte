<script lang="ts">
  // Sanitized Markdown rendering. External images are enabled only for trusted content.
  import { onDestroy } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import { upgradeAnimatedMedia } from '../../core/markdown';

  // Two independent renderers: the default one blocks images (public sidebar
  // must not render arbitrary external image hosts); the trusted one allows them.
  const mdSafe = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable(['image']);
  const mdFull = new MarkdownIt({ html: false, linkify: true, breaks: true });

  let {
    content,
    class: className = '',
    allowImages = false,
  }: { content: string; class?: string; allowImages?: boolean } = $props();

  const renderer = $derived(allowImages ? mdFull : mdSafe);

  let el: HTMLDivElement | undefined = $state(undefined);
  let html = $derived(DOMPurify.sanitize(renderer.render(content)));

  /** Reserve media space with a shared shimmer until loading succeeds or fails. */
  function wrapPendingMedia(root: ParentNode): void {
    for (const media of Array.from(root.querySelectorAll('img, video'))) {
      if (media.closest('.md-media')) continue;
      const holder = document.createElement('span');
      holder.className = 'md-media skeleton';
      media.replaceWith(holder);
      holder.appendChild(media);
      // Once the intrinsic size is known, the box hugs the content instead of the 16:10
      // guess: object-fit then has no letterbox, so the card radius lands on the actual
      // image corners rather than on empty bars.
      const done = () => {
        holder.classList.remove('skeleton');
        const w =
          media instanceof HTMLImageElement
            ? media.naturalWidth
            : media instanceof HTMLVideoElement
              ? media.videoWidth
              : 0;
        const h =
          media instanceof HTMLImageElement
            ? media.naturalHeight
            : media instanceof HTMLVideoElement
              ? media.videoHeight
              : 0;
        if (w > 0 && h > 0) holder.style.aspectRatio = `${w} / ${h}`;
      };
      if (media instanceof HTMLImageElement && media.complete) {
        done();
        continue;
      }
      media.addEventListener('load', done, { once: true });
      media.addEventListener('loadeddata', done, { once: true });
      media.addEventListener('error', done, { once: true });
    }
  }

  function apply() {
    if (!el) return;
    el.innerHTML = html;
    // ![alt](*.webm) renders as <img> — swap in a <video> so GIF/video plays.
    upgradeAnimatedMedia(el);
    wrapPendingMedia(el);
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
