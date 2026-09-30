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
      const done = () => holder.classList.remove('skeleton');
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

  /* Loading placeholder: reserves a 16:10 box so the paragraph does not jump, and
     carries the shared shimmer until the media reports it is ready. */
  div :global(.md-media) {
    display: block;
    aspect-ratio: 16 / 10;
    overflow: hidden;
  }

  div :global(.md-media img),
  div :global(.md-media video) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
