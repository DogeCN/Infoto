<script lang="ts">
  // Album progress panel with measured progress or an indeterminate sweep. Pointer hover expands the list; touch dragging controls its height.
  import { onDestroy } from 'svelte';
  import { Clapperboard, X } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import type { UploadRow } from '../../transcode/pipeline';
  import { motionMs } from '$base/lib/motion';
  import { createHoverIntent } from '$base/lib/hover';

  interface Props {
    /** Already filtered by the caller: this panel is stage-agnostic. */
    tasks: UploadRow[];
    /** Batch counter for the header ({done}/{total}). */
    progress: { done: number; total: number };
    /** Remove one file's job (any phase). */
    onRemove: (jobId: string) => void;
    /** Multi-select owns the bottom of the screen: its bar is a full-width bottom bar on
     *  a layer above this panel, so the panel slides away while it is up. */
    hidden?: boolean;
    /** Report measured panel geometry for toast clearance; a hidden or collapsed panel
     *  reports zero height. `atLeftEdge` marks a panel flush with the viewport's left edge,
     *  where it sits under the bottom-left toast column. */
    onGeometry?: (geometry: { height: number; atLeftEdge: boolean }) => void;
  }

  let { tasks, progress, onRemove, hidden = false, onGeometry }: Props = $props();

  // `$derived`, not a snapshot: the heading follows a language switch.
  const title = $derived(copy.uploadPanel.transcodeTitle);

  /** Matches the row's collapse transition, so the shell outlives the last collapse. */
  const ROW_EXIT_MS = motionMs('duration-enter');

  // Keep the shell mounted for one transition after the last row leaves — tearing it
  // down on `tasks.length === 0` would cut that row's collapse in half.
  let mounted = $state(false);
  $effect(() => {
    if (tasks.length > 0) {
      mounted = true;
      return;
    }
    const timer = setTimeout(() => (mounted = false), ROW_EXIT_MS);
    return () => clearTimeout(timer);
  });

  let shellEl = $state<HTMLElement | undefined>(undefined);

  /** A panel within this many pixels of the viewport's left edge overlaps the bottom-left
   *  toast column; the right-aligned desktop panel does not. */
  const LEFT_EDGE_MAX = 8;

  // Observe rendered geometry and visibility to update toast clearance.
  $effect(() => {
    if (!shellEl) {
      onGeometry?.({ height: 0, atLeftEdge: false });
      return;
    }
    const report = () => {
      const rect = shellEl!.getBoundingClientRect();
      onGeometry?.({
        height: hidden ? 0 : shellEl!.offsetHeight,
        atLeftEdge: rect.left < LEFT_EDGE_MAX,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(shellEl);
    return () => ro.disconnect();
  });

  // ---- pointer devices: hover, debounced ---------------------------------
  let canHover = $state(false);
  let expanded = $state(false);
  const intent = createHoverIntent();

  // A touch device reports hover: none — it gets the drag instead. Kept reactive: a
  // tablet can gain or lose a mouse mid-session.
  $effect(() => {
    const mq = window.matchMedia('(hover: hover)');
    const sync = () => {
      canHover = mq.matches;
      if (!canHover) expanded = false;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  $effect(() => {
    expanded = intent.hovered() && canHover;
  });

  // Entering waits for nothing, so an intentional hover feels immediate.
  function onEnter(): void {
    intent.enter();
  }
  function onLeave(): void {
    intent.leave();
  }
  onDestroy(() => {
    intent.destroy();
  });

  // Touch dragging adjusts the bottom-anchored panel height; release chooses the nearest endpoint.
  const HEADER_H = 44;
  /** Row pitch: py-1.5 (12px) + text-xs line-height (16px) = 28px. */
  const ROW_H = 28;
  let dragging = $state(false);
  let dragStartY: number | null = null;
  let dragBaseH = 0;
  let sheetH = $state(HEADER_H);
  let lastPointerY = 0;
  let lastPointerAt = 0;
  let pointerVelocityY = 0;

  function naturalH(): number {
    return Math.max(
      HEADER_H,
      Math.min(HEADER_H + tasks.length * ROW_H + 8, window.innerHeight * 0.42),
    );
  }
  function onHeaderPointerDown(e: PointerEvent): void {
    if (canHover) return;
    dragging = true;
    dragStartY = e.clientY;
    sheetH =
      (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().height || HEADER_H;
    dragBaseH = sheetH;
    lastPointerY = e.clientY;
    lastPointerAt = performance.now();
    pointerVelocityY = 0;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onHeaderPointerMove(e: PointerEvent): void {
    if (!dragging || dragStartY === null) return;
    const now = performance.now();
    const elapsed = now - lastPointerAt;
    if (elapsed > 0) pointerVelocityY = (e.clientY - lastPointerY) / elapsed;
    sheetH = Math.min(naturalH(), Math.max(HEADER_H, dragBaseH - (e.clientY - dragStartY)));
    lastPointerY = e.clientY;
    lastPointerAt = now;
  }
  function onHeaderPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    const elapsed = performance.now() - lastPointerAt;
    if (e.type === 'pointerup' && dragStartY !== null) {
      sheetH = Math.min(naturalH(), Math.max(HEADER_H, dragBaseH - (e.clientY - dragStartY)));
    }
    const velocityY = e.type === 'pointerup' && elapsed <= 80 ? pointerVelocityY : 0;
    const glide = Math.max(-72, Math.min(72, -velocityY * 110));
    dragging = false;
    dragStartY = null;
    sheetH = Math.min(naturalH(), Math.max(HEADER_H, sheetH + glide));
  }

  /** Collapse a departing row's slot instead of letting the list snap shut. */
  function collapse(node: HTMLElement): { duration: number; css: (t: number) => string } {
    void node;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reduced ? 0 : motionMs('duration-enter'),
      css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t}`,
    };
  }

  /** Use an indeterminate sweep for queued jobs and stages without measurable progress. */
  function indeterminate(task: UploadRow): boolean {
    return task.phase === 'queued' || task.phase === 'lease-wait' || task.fraction == null;
  }

  function pct(task: UploadRow): number {
    const f = task.fraction;
    if (f == null || !Number.isFinite(f)) return 0;
    return Math.min(100, Math.max(0, Math.round(f * 100)));
  }
</script>

{#if mounted}
  <!-- role=presentation: this wrapper only owns the padded hit area around the panel. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="upload-panel fixed inset-x-0 bottom-0 z-30 md:inset-x-auto md:right-4 md:bottom-4 md:w-72
      transition-[transform,opacity] duration-[var(--duration-exit)] ease-[var(--ease-exit)] {hidden
      ? 'pointer-events-none translate-y-[150%] opacity-0'
      : 'translate-y-0 opacity-100'}"
    role="presentation"
    aria-hidden={hidden}
    inert={hidden}
    onpointerenter={onEnter}
    onpointerleave={onLeave}
  >
    <div
      bind:this={shellEl}
      class="relative overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-lg shadow-black/30 backdrop-blur-xl md:rounded-xl md:border-b md:pb-0"
    >
      <!-- No expand button: pointer devices hover, touch devices drag this header. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center gap-2.5 px-4 py-3.5 select-none {canHover
          ? 'cursor-pointer'
          : 'cursor-grab touch-none'}"
        role="button"
        tabindex="0"
        aria-expanded={canHover ? expanded : sheetH > HEADER_H}
        aria-label={title}
        onpointerdown={onHeaderPointerDown}
        onpointermove={onHeaderPointerMove}
        onpointerup={onHeaderPointerUp}
        onpointercancel={onHeaderPointerUp}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (canHover) expanded = !expanded;
            else sheetH = sheetH > HEADER_H ? HEADER_H : naturalH();
          }
        }}
      >
        <Clapperboard class="size-4 shrink-0 text-muted-foreground" />
        <span class="flex-1 text-xs text-muted-foreground">{title}</span>
        {#if progress && progress.total > 0}
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
            {progress.done}<span class="text-muted-foreground/50">/{progress.total}</span>
          </span>
        {/if}
      </div>

      <!-- Animate expansion with grid rows; pointer dragging sets height directly. -->
      <div
        inert={canHover ? !expanded : sheetH <= HEADER_H}
        class="overflow-hidden {canHover
          ? 'grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)] ' +
            (expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
          : dragging
            ? ''
            : 'transition-[height] duration-[var(--duration-enter)] ease-[var(--ease-enter)]'}"
        style={!canHover ? `height: ${Math.max(0, Math.min(naturalH(), sheetH) - HEADER_H)}px` : ''}
      >
        <div
          class="min-h-0 overscroll-contain overflow-y-auto {canHover
            ? 'max-h-[min(40vh,17.5rem)]'
            : 'h-full max-h-[calc(42svh-44px)]'}"
        >
          <div class="space-y-0.5 px-2 pb-2">
            {#each tasks as task (task.jobId)}
              <!-- one row, one line: filename left, bar right, remove at the end -->
              <div class="grid grid-rows-[1fr]" out:collapse>
                <div class="flex min-h-0 items-center gap-2 overflow-hidden px-2 py-1.5">
                  <!-- The name takes what it needs and no more (capped so a long one cannot
                       starve the bar); the bar then fills the rest of the row. -->
                  <span class="max-w-[55%] min-w-0 shrink truncate text-xs text-foreground/85">
                    {task.fileName}
                  </span>
                  <div
                    class="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/20"
                    role="progressbar"
                    aria-label={fmt(copy.uploadPanel.fileProgress, { fileName: task.fileName })}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={indeterminate(task) ? undefined : pct(task)}
                  >
                    {#if indeterminate(task)}
                      <div class="sweep h-full rounded-full bg-primary/70"></div>
                    {:else}
                      <div
                        class="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
                        style="width: {pct(task)}%"
                      ></div>
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="icon-button icon-button--danger size-4 shrink-0 rounded-full hover:text-destructive"
                    title={copy.uploadPanel.remove}
                    aria-label={fmt(copy.uploadPanel.removeFile, { fileName: task.fileName })}
                    onclick={() => onRemove(task.jobId)}
                  >
                    <X class="size-3" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Expand the hover boundary behind the interactive panel content. */
  .upload-panel::before {
    content: '';
    position: absolute;
    inset: -8px;
  }

  /* Indeterminate phases (queued / waiting for a video token) have no fraction yet —
     a sweep says "working" where a 0% bar would say "stuck". */
  .sweep {
    width: 33%;
    animation: sweep 1.3s linear infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(320%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep {
      width: 100%;
      opacity: 0.4;
      animation: none;
    }
  }
</style>
