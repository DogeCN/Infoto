<script lang="ts">
  // Sanitized Markdown rendering. External images are enabled only for trusted content.
  import { onDestroy } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';
  import { upgradeMarkdownMedia } from '../../core/markdown';

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
      // `complete` alone is not "loaded": an image parsed into a `<template>` has never started
      // a load, and Chromium reports `complete === true` with `naturalWidth === 0` for it. The
      // shortcut would then run `done()` with no dimensions, leave the holder on its 16:10
      // placeholder, and letterbox every image. Requiring a real intrinsic size keeps the
      // shortcut for a cached image and falls through to the listeners for a template one.
      if (media instanceof HTMLImageElement && media.complete && media.naturalWidth > 0) {
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
    // Build and upgrade inside an inert `<template>`, then attach once.
    //
    // A `<template>`'s content has no browsing context, so an `<img src>` inside it does not
    // fetch — unlike a detached document (`createHTMLDocument` + `innerHTML` fetches anyway).
    // That matters because markdown-it emits every `![]()` as `<img src>`: assigning the HTML
    // straight into the live element starts the download before anything can replace it, which
    // cost a video two requests (once as the `<img>`, once as the `<video>` it becomes) and made
    // a non-media URL download in full to render a download button.
    const scratch = document.createElement('template');
    scratch.innerHTML = html;
    // ![alt](url) always renders as <img> — swap it for the element its extension names so a
    // video plays and a sound file gets a player.
    upgradeMarkdownMedia(scratch.content);
    wrapPendingMedia(scratch.content);
    el.replaceChildren(...Array.from(scratch.content.childNodes));
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
