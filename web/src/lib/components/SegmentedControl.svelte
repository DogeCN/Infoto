<script lang="ts" generics="T extends string = string">
  // Generic segmented pill (shared by the home SortTabs and the admin page): rounded shell
  // plus a cyan sliding indicator pill. Activation uses --ease-enter / --duration-enter
  // (pill translation), text color uses --ease-exit / --duration-exit, like other site controls.
  import type { Component } from 'svelte';
  import { cn } from '$base/lib/ui';
  import Tooltip from './Tooltip.svelte';
  import { measurePillWidths, type PillWidths } from './pillMeasure';

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
    /**
     * Label density contract shared with the top bar:
     * - 'all'   every item shows icon + label
     * - 'current' only the active item shows icon + label, others show icon only
     * - 'none'  every item shows icon only
     * The tooltip / `data-label` always retain the name.
     */
    labelMode?: 'all' | 'current' | 'none';
    size?: 'sm' | 'md';
    ariaLabel?: string;
    onWidths?: (widths: PillWidths) => void;
  }

  let {
    items,
    value,
    onChange,
    onReselect,
    labelMode = 'all',
    size = 'md',
    ariaLabel,
    onWidths,
  }: Props<T> = $props();

  // Sliding indicator: tracks the geometry of the active item's button. An action records the
  // element (in Svelte 5, bind:this onto a plain object property warns).
  const btnEls: Partial<Record<string, HTMLButtonElement>> = {};
  let indicator = $state({ x: 0, w: 0 });

  function track(el: HTMLButtonElement, v: string) {
    btnEls[v] = el;
    const observer = new ResizeObserver(() => {
      if (value !== undefined) syncIndicator(value);
    });
    observer.observe(el);
    if (v === value) syncIndicator(v);
    return {
      destroy() {
        observer.disconnect();
        delete btnEls[v];
      },
    };
  }

  function syncIndicator(v: string) {
    const el = btnEls[v];
    if (el) indicator = { x: el.offsetLeft, w: el.offsetWidth };
  }

  // Density contract for the bar: measured by the shared clone probe, so the admin tabs and
  // the gallery sort pill report comparable widths.
  const measure = $derived.by(() => {
    void value;
    void items;
    void labelMode;
    void size;
    return {
      deps: JSON.stringify([items, value, labelMode, size, document.documentElement.lang]),
      onWidths: (info: PillWidths) => onWidths?.(info),
    };
  });

  $effect(() => {
    void measure;
    if (value !== undefined) syncIndicator(value);
  });

  // Label hidden for every item when the density contract hides labels entirely; per-item
  // override when only the current item keeps its label. A hidden span is aria-hidden, so
  // every mode that can hide a label also names its button via aria-label — 'all' is the
  // only mode whose buttons are named by their visible content alone.
  function labelHidden(active: boolean): boolean {
    if (labelMode === 'none') return true;
    if (labelMode === 'current') return !active;
    return false;
  }

  function onKeydown(event: KeyboardEvent, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = (index + items.length - 1) % items.length;
        break;
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    btnEls[item.value]?.focus();
    if (item.value !== value) onChange?.(item.value);
  }

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
  use:measurePillWidths={measure}
  class="relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1"
>
  <!-- Sliding indicator pill: smoothly translates to the current item when it changes -->
  <div
    class="pointer-events-none absolute bottom-1 left-0 top-1 rounded-full bg-primary transition-[transform,width,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:opacity-0={indicator.w === 0}
    style="width: {indicator.w}px; transform: translateX({indicator.x}px)"
  ></div>
  {#each items as item, index (item.value)}
    {@const active = item.value === value}
    {@const Icon = item.icon}
    <Tooltip text={item.label} side="bottom">
      <button
        use:track={item.value}
        type="button"
        role="tab"
        aria-selected={active}
        tabindex={active || (value === undefined && index === 0) ? 0 : -1}
        onkeydown={(event) => onKeydown(event, index)}
        class={cn(
          'relative z-10 inline-flex items-center rounded-full py-1.5 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
          size === 'md' ? 'px-3.5' : 'px-3',
          'gap-2',
          active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        data-label={item.label}
        aria-label={labelMode === 'all' ? undefined : item.label}
        onclick={() => pick(item.value)}
      >
        {#if Icon}<Icon class="size-[var(--bar-badge)]" />{/if}
        <span
          data-tab-label
          aria-hidden={labelHidden(active)}
          class={labelHidden(active)
            ? 'absolute left-0 top-full invisible whitespace-nowrap'
            : 'relative'}
        >
          {item.label}
        </span>
      </button>
    </Tooltip>
  {/each}
</div>
