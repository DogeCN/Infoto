<script lang="ts">
  // Floating sidebar over the main content plus an overlay scrim; the main
  // content width never changes, so opening/closing does not reflow the
  // waterfall. Desktop drags the inner edge to resize (persisted to
  // localStorage); below 768px the sidebar covers the full width and cannot
  // be dragged.
  import type { Snippet } from "svelte";
  import { X } from "@lucide/svelte";
  import Tooltip from "./Tooltip.svelte";

  let {
    side = "left",
    open = $bindable(false),
    title = "",
    icon,
    children,
  }: {
    side?: "left" | "right";
    open?: boolean;
    title?: string;
    icon?: Snippet;
    children?: Snippet;
  } = $props();

  const MIN_W = 280;
  const MAX_W = 720;
  const DEFAULT_W = 360;
  // side is a reactive prop, so the key must be derived
  let storageKey = $derived(`infoto-sidebar-width-${side}`);

  function clamp(w: number): number {
    const viewportMax =
      typeof window === "undefined"
        ? MAX_W
        : Math.max(MIN_W, window.innerWidth - 48);
    return Math.round(Math.min(MAX_W, viewportMax, Math.max(MIN_W, w)));
  }

  function loadWidth(key: string): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return clamp(Number(raw));
    } catch {}
    return DEFAULT_W;
  }

  let width = $state(DEFAULT_W);
  let dragging = $state(false);

  // Read localStorage / viewport width after mount to avoid a wrong first frame
  $effect(() => {
    width = loadWidth(storageKey);
  });

  /** Drag the inner edge: left sidebar grows rightward, right sidebar leftward. */
  function startResize(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startW = width;
    const sign = side === "left" ? 1 : -1;
    const onMove = (ev: PointerEvent) => {
      width = clamp(startW + (ev.clientX - startX) * sign);
    };
    const onUp = () => {
      dragging = false;
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onResizeKey(e: KeyboardEvent) {
    const sign = side === "left" ? 1 : -1;
    if (e.key === "ArrowLeft") width = clamp(width - 16 * sign);
    else if (e.key === "ArrowRight") width = clamp(width + 16 * sign);
    else return;
    e.preventDefault();
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {}
  }

  function close() {
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- Scrim covers the full screen including the top bar; above the bar,
       below the sidebar itself -->
  <div
    class="fixed inset-0 z-[47] bg-black/50 backdrop-blur-sm"
    role="presentation"
    onclick={close}
  ></div>
{/if}

<aside
  class="fixed top-0 z-50 flex h-full w-full flex-col border-border bg-card shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:w-[var(--sidebar-w)]"
  class:left-0={side === "left"}
  class:right-0={side === "right"}
  class:translate-x-0={open}
  class:-translate-x-full={side === "left" && !open}
  class:translate-x-full={side === "right" && !open}
  style="--sidebar-w: {width}px"
>
  <!-- Inner-edge width drag (desktop); keyboard arrows also resize. -->
  <Tooltip text="拖动调整宽度" side="right">
    <button
      type="button"
      aria-label="调整侧栏宽度"
      class="absolute inset-y-0 hidden w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 md:block {dragging
        ? 'bg-primary/60'
        : ''} {side === 'left' ? 'right-0' : 'left-0'}"
      onpointerdown={startResize}
      onkeydown={onResizeKey}
    ></button>
  </Tooltip>

  <div
    class="flex items-center justify-between border-b border-border px-5 py-4"
  >
    <div class="flex items-center gap-2.5">
      {#if icon}
        {@render icon()}
      {/if}
      <h2 class="text-lg font-semibold tracking-tight">{title}</h2>
    </div>
    <Tooltip text="关闭">
      <button
        class="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-all duration-200 hover:bg-background hover:text-foreground hover:scale-105 active:scale-95"
        onclick={close}
      >
        <X class="size-5" />
      </button>
    </Tooltip>
  </div>

  <!-- Content scrolls independently; min-h-0 gives h-full / sticky children a
       definite height. Deliberately no bottom padding: padding-bottom would
       stop the sticky composer 16px early and let scrolling content show
       through the gap. Panels own their bottom padding instead. Selection is
       disabled while dragging. -->
  <div
    class="min-h-0 flex-1 overflow-y-auto px-4 pt-4"
    style="user-select: {dragging ? 'none' : 'auto'}"
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
</aside>
