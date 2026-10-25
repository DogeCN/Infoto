<script lang="ts">
  // Centered empty state: an icon, a line of text and an optional hint.
  import type { Component } from 'svelte';

  interface Props {
    text: string;
    hint?: string;
    icon?: Component;
    class?: string;
  }

  let { text, hint, icon: Icon, class: className = '' }: Props = $props();
</script>

<div
  class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center {className}"
  style="animation: fadeInUp var(--duration-enter) var(--ease-enter) both"
>
  {#if Icon}
    <div class="mb-3 text-muted-foreground/60">
      <Icon class="size-12" />
    </div>
  {/if}
  <p class="text-lg font-medium tracking-[-0.02em] text-foreground/85">{text}</p>
  {#if hint}
    <p class="text-sm text-muted-foreground">{hint}</p>
  {/if}
</div>
