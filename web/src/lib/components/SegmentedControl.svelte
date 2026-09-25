<script lang="ts" generics="T extends string = string">
  // Generic segmented pill (shared by the home SortTabs and the admin page): rounded shell
  // plus a cyan sliding indicator pill. Activation uses --ease-enter / --duration-enter
  // (pill translation), text color uses --ease-exit / --duration-exit, like other site controls.
  import type { Component } from 'svelte';
  import { cn } from '$lib/utils';

  export type SegmentedItem<T extends string = string> = {
    value: T;
    label: string;
    icon?: Component;
  };

  interface Props<T extends string = string> {
    items: ReadonlyArray<SegmentedItem<T>>;
    value?: T;
    onChange?: (value: T) => void;
    /** Fired when the already-active item is clicked again (e.g. "random" reshuffle). */
    onReselect?: (value: T) => void;
    /** Hide the label on narrow screens (icon only); the native title supplies the name. */
    responsiveHideLabel?: boolean;
    size?: 'sm' | 'md';
    ariaLabel?: string;
  }

  let {
    items,
    value,
    onChange,
    onReselect,
    responsiveHideLabel = false,
    size = 'md',
    ariaLabel,
  }: Props<T> = $props();

  // Sliding indicator: tracks the geometry of the active item's button. An action records the
  // element (in Svelte 5, bind:this onto a plain object property warns).
  const btnEls: Partial<Record<string, HTMLButtonElement>> = {};
  let indicator = $state({ x: 0, w: 0, ready: true });

  function track(el: HTMLButtonElement, v: string) {
    btnEls[v] = el;
    syncIndicator(v);
    return {
      destroy() {
        delete btnEls[v];
      },
    };
  }

  function syncIndicator(v: string) {
    const el = btnEls[v];
    if (el) indicator = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }

  $effect(() => {
    // Depends on value and items: recompute when the item switches or when label width changes
    // with state (e.g. newest↔oldest). These bare statements are the "touch the dependency" idiom so $effect subscribes to them.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    value;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    items;
    if (value !== undefined) syncIndicator(value);
  });

  $effect(() => {
    const onResize = () => {
      if (value !== undefined) syncIndicator(value);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  function pick(v: string) {
    if (v === value) {
      onReselect?.(v as T);
      return;
    }
    onChange?.(v as T);
  }
</script>

<div
  role="tablist"
  aria-label={ariaLabel}
  class="relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1"
>
  <!-- Sliding indicator pill: smoothly translates to the current item when it changes -->
  <div
    class="pointer-events-none absolute bottom-1 left-0 top-1 rounded-full bg-primary transition-[transform,width,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:opacity-0={!indicator.ready}
    style="width: {indicator.w}px; transform: translateX({indicator.x}px)"
  ></div>
  {#each items as item (item.value)}
    {@const active = item.value === value}
    {@const Icon = item.icon}
    <button
      use:track={item.value}
      type="button"
      role="tab"
      aria-selected={active}
      class={cn(
        'relative z-10 inline-flex items-center rounded-full py-1.5 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
        size === 'md' ? 'px-3.5' : 'px-3',
        responsiveHideLabel ? 'gap-1.5' : 'gap-2',
        active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
      title={item.label}
      onclick={() => pick(item.value)}
    >
      {#if Icon}<Icon class="size-4" />{/if}
      <span class={cn(responsiveHideLabel && 'hidden sm:inline')}>{item.label}</span>
    </button>
  {/each}
</div>
