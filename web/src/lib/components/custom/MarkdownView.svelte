<script lang="ts">
  // Markdown rendering core. markdown-it produces HTML, DOMPurify sanitizes it;
  // :::vote lines are parsed by the host into a VoteBlock. Images are off by
  // default (the public sidebar must not render arbitrary external image hosts,
  // which would enable tracking pixels); trusted contexts — the editor preview
  // and the root-only feedback detail — opt in via allowImages.
  import { onDestroy } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';

  // Two independent renderers: the default one blocks images (public sidebar
  // must not render arbitrary external image hosts); the trusted one allows them.
  const mdSafe = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable(['image']);
  const mdFull = new MarkdownIt({ html: false, linkify: true, breaks: true });

  let { content, class: className = '', allowImages = false }: { content: string; class?: string; allowImages?: boolean } = $props();

  const renderer = $derived(allowImages ? mdFull : mdSafe);

  let el: HTMLDivElement | undefined = $state(undefined);
  let html = $derived(DOMPurify.sanitize(renderer.render(content)));

  function apply() {
    if (el) el.innerHTML = html;
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