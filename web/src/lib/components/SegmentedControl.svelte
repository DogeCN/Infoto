<script lang="ts" generics="T extends string = string">
  // Generic segmented pill (shared by the home SortTabs and the admin page): rounded shell
  // plus a cyan sliding indicator pill. Activation uses --ease-enter / --duration-enter
  // (pill translation), text color uses --ease-exit / --duration-exit, like other site controls.
  import type { Component } from 'svelte';
  import { cn } from '$base/lib/ui';

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
    /** Show icons without labels when the parent selects compact density; titles retain accessible names. */
    hideLabel?: boolean;
    size?: 'sm' | 'md';
    ariaLabel?: string;
    onWidths?: (info: { shown: number; shownIsLabelled: boolean; labelDelta: number }) => void;
  }

  let {
    items,
    value,
    onChange,
    onReselect,
    hideLabel = false,
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

  let rootEl: HTMLDivElement | undefined = $state(undefined);

  function measureWidths(): void {
    const root = rootEl;
    if (!root || !onWidths) return;
    const labelDelta = [...root.querySelectorAll<HTMLElement>('[data-tab-label]')].reduce(
      (sum, label) => {
        const button = label.closest('button');
        const gap = button ? Number.parseFloat(getComputedStyle(button).columnGap) || 0 : 0;
        const hasIcon = !!button?.querySelector('svg');
        return sum + label.offsetWidth + (hasIcon ? gap : 0);
      },
      0,
    );
    onWidths({ shown: root.offsetWidth, shownIsLabelled: !hideLabel, labelDelta });
  }

  $effect(() => {
    void value;
    void items;
    void hideLabel;
    void size;
    if (value !== undefined) syncIndicator(value);
    const root = rootEl;
    if (!root) return;
    let raf = requestAnimationFrame(measureWidths);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureWidths);
    });
    observer.observe(root);
    for (const label of root.querySelectorAll('[data-tab-label]')) observer.observe(label);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  });

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
  bind:this={rootEl}
  role="tablist"
  aria-label={ariaLabel}
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
      title={item.label}
      aria-label={hideLabel ? item.label : undefined}
      onclick={() => pick(item.value)}
    >
      {#if Icon}<Icon class="size-[calc(var(--bar-h)*0.25)]" />{/if}
      <span
        data-tab-label
        aria-hidden={hideLabel}
        class={hideLabel ? 'absolute left-0 top-full invisible whitespace-nowrap' : 'relative'}
      >
        {item.label}
      </span>
    </button>
  {/each}
</div>
