<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    leftSidebar,
    rightSidebar,
    topBar,
    children,
  }: {
    leftSidebar?: Snippet;
    rightSidebar?: Snippet;
    topBar?: Snippet;
    children?: Snippet;
  } = $props();

  let leftOpen = $state(false);
  let rightOpen = $state(false);

  function toggleLeft() {
    leftOpen = !leftOpen;
    if (leftOpen) rightOpen = false;
  }

  function toggleRight() {
    rightOpen = !rightOpen;
    if (rightOpen) leftOpen = false;
  }

  function closeLeft() {
    leftOpen = false;
  }

  function closeRight() {
    rightOpen = false;
  }
</script>

<div class="flex h-screen overflow-hidden bg-background">
  {#if leftSidebar}
    <div
      class="flex-shrink-0 overflow-y-auto transition-all duration-300 ease-in-out"
      class:w-[360px]={leftOpen}
      class:w-0={!leftOpen}
      class:opacity-0={!leftOpen}
    >
      {@render leftSidebar()}
    </div>
  {/if}

  <div class="flex flex-1 flex-col overflow-hidden">
    {#if topBar}
      {@render topBar()}
    {/if}

    <main class="flex-1 overflow-y-auto p-4 pt-20 md:p-6 md:pt-20">
      {#if children}
        {@render children()}
      {/if}
    </main>
  </div>

  {#if rightSidebar}
    <div
      class="flex-shrink-0 overflow-y-auto transition-all duration-300 ease-in-out"
      class:w-[360px]={rightOpen}
      class:w-0={!rightOpen}
      class:opacity-0={!rightOpen}
    >
      {@render rightSidebar()}
    </div>
  {/if}
</div>
