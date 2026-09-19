<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    class: className = '',
    children,
  }: {
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<h3 class={cn('text-2xl font-semibold leading-none tracking-tight', className)}>
  {#if children}
    {@render children()}
  {/if}
</h3>
