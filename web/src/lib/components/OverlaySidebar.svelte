<script lang="ts">
  // Overlay sidebar with persisted desktop resizing and a full-width mobile layout.
  import { onDestroy, type Snippet } from 'svelte';
  import { overlay } from '$base/lib/overlay';
  import { startPointerResize } from '$base/lib/pointer';
  import { copy } from '$lib/i18n.svelte';
  import { X } from '@lucide/svelte';

  let {
    side = 'left',
    open = $bindable(false),
    title = '',
    icon,
    children,
    previewTransparent = false,
  }: {
    side?: 'left' | 'right';
    open?: boolean;
    title?: string;
    icon?: Snippet;
    children?: Snippet;
    previewTransparent?: boolean;
  } = $props();

  const MIN_W = 280;
  const MAX_W = 720;
  const DEFAULT_W = 360;
  // side is a reactive prop, so the key must be derived rather than a top-level constant
  let storageKey = $derived(`infoto-sidebar-width-${side}`);

  function clamp(w: number): number {
    const viewportMax =
      typeof window === 'undefined' ? MAX_W : Math.max(MIN_W, window.innerWidth - 48);
    return Math.round(
      Math.min(MAX_W, viewportMax, Math.max(MIN_W, Number.isFinite(w) ? w : DEFAULT_W)),
    );
  }

  function loadWidth(key: string): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return clamp(Number(raw));
    } catch {
      /* noop */
    }
    return DEFAULT_W;
  }

  let width = $state(DEFAULT_W);
  let dragging = $state(false);

  // Load the stored width after mounting.
  $effect(() => {
    width = loadWidth(storageKey);
  });

  function saveWidth() {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      /* Storage is optional. */
    }
  }

  let stopResize: (() => void) | undefined;
  onDestroy(() => stopResize?.());
  $effect(() => {
    if (!open) stopResize?.();
  });

  /** Resize from the inner edge with pointer cancellation and teardown cleanup. */
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    stopResize?.();
    stopResize = startPointerResize({
      event,
      axis: 'x',
      sign: side === 'left' ? 1 : -1,
      start: width,
      clamp,
      onStart: () => (dragging = true),
      onMove: (value) => (width = value),
      onEnd: saveWidth,
      onStop: () => (dragging = false),
    });
  }

  function onResizeKey(event: KeyboardEvent) {
    const sign = side === 'left' ? 1 : -1;
    if (event.key === 'ArrowLeft') width = clamp(width - 16 * sign);
    else if (event.key === 'ArrowRight') width = clamp(width + 16 * sign);
    else return;
    event.preventDefault();
    saveWidth();
  }

  function close() {
    open = false;
  }
</script>

<svelte:window onresize={() => (width = clamp(width))} />

{#if open}
  <!-- Full-screen scrim (covers the top bar): dims everything while open, layered above the
       top bar but below the sidebar itself -->
  <div
    class="fixed inset-0 z-[47] bg-black/50 backdrop-blur-sm transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
    data-layout-scrim
    style="opacity: {previewTransparent ? 0 : 1}"
    role="presentation"
    onclick={close}
  ></div>
{/if}

<!-- Layout-preview transparency is carried by the background alpha, never by `opacity` on
     this panel. An ancestor opacity multiplies through the whole subtree, so a slider thumb
     inside it could not stay solid while the panel faded, and the thumb is exactly the cue
     that tells the user the drag is still live while they watch the waterfall reflow. -->
<div
  role="dialog"
  aria-modal={open ? true : undefined}
  aria-label={title}
  aria-hidden={!open}
  inert={!open}
  tabindex="-1"
  use:overlay={{ enabled: open, onClose: close }}
  class="fixed top-0 z-50 flex h-full w-full flex-col border-border shadow-2xl shadow-black/40 transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] md:w-[var(--sidebar-w)] {previewTransparent
    ? 'bg-card/45'
    : 'bg-card'}"
  class:left-0={side === 'left'}
  class:right-0={side === 'right'}
  class:translate-x-0={open}
  class:-translate-x-full={side === 'left' && !open}
  class:translate-x-full={side === 'right' && !open}
  style="--sidebar-w: {width}px"
>
  <!-- Drag the inner edge to resize (desktop). The button carries the interaction semantics;
       arrow keys adjust the width too. -->
  <button
    type="button"
    aria-label={copy.sidebar.resizeAria}
    title={copy.sidebar.resizeTitle}
    class="absolute inset-y-0 hidden w-1.5 cursor-col-resize transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-primary/40 md:block {dragging
      ? 'bg-primary/60'
      : ''} {side === 'left' ? 'right-0' : 'left-0'}"
    onpointerdown={startResize}
    onkeydown={onResizeKey}
  ></button>

  <div class="flex items-center justify-between border-b border-border px-5 py-4">
    <div class="flex items-center gap-2.5">
      {#if icon}
        {@render icon()}
      {/if}
      <h2 class="text-lg font-semibold tracking-tight">{title}</h2>
    </div>
    <button
      class="icon-button rounded-lg p-1.5 hover:scale-105 active:scale-95"
      onclick={close}
      title={copy.sidebar.close}
      aria-label={copy.sidebar.close}
      data-autofocus
    >
      <X class="size-5" />
    </button>
  </div>

  <!-- Independent scroll area; child panels provide bottom spacing for sticky controls.
       Nothing here fades: an ancestor `opacity` multiplies through the whole subtree, so
       the slider under the pointer could not stay solid while the panel receded — and that
       slider is the cue that tells the user the drag is still live. SettingsPanel fades
       its own idle controls instead, which leaves this layer untouched. -->
  <div
    class="min-h-0 flex-1 overflow-y-auto px-4 pt-4"
    style="user-select: {dragging ? 'none' : 'auto'}"
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>
