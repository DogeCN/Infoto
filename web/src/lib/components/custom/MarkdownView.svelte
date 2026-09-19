<script lang="ts">
  // 公告 Markdown 渲染内核（spec: "公告侧边栏" / "自定义组件清单 MarkdownView"）。
  // markdown-it 渲染 HTML + DOMPurify 消毒；:::vote 行由外层解析成 VoteBlock。
  import { onDestroy } from 'svelte';
  import MarkdownIt from 'markdown-it';
  import DOMPurify from 'dompurify';

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
  }).disable(['image']);

  let { content, class: className = '' }: { content: string; class?: string } = $props();

  let el: HTMLDivElement | undefined = $state(undefined);
  let html = $derived(DOMPurify.sanitize(md.render(content)));

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