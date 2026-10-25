<script lang="ts">
  // Album progress panel with measured progress or an indeterminate sweep. A corner card
  // expands on hover; a full-width panel is a drawer toggled by its own header.
  import { onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { ChevronDown, ChevronUp, Clapperboard, X } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import { batchProgress, indeterminateRow, type UploadRow } from '../../transcode/pipeline';
  import { countHop, motionMs } from '$base/lib/motion';
  import { createHoverIntent } from '$base/lib/hover.svelte';
  import { canHover, prefersReducedMotion } from '$base/lib/device.svelte';
  import TooltipIconButton from './TooltipIconButton.svelte';

  interface Props {
    /** Already filtered by the caller: this panel is stage-agnostic. */
    tasks: UploadRow[];
    /** Remaining files for the header (`total − done`). */
    progress: { done: number; total: number };
    /** Remove one file's job (any phase). */
    onRemove: (jobId: string) => void;
    /** Multi-select owns the bottom of the screen: its bar is a full-width bottom bar on
     *  a layer above this panel, so the panel slides away while it is up. */
    hidden?: boolean;
    /** Report measured panel geometry for toast clearance and gallery clearance. `height`
     *  is the live shell height (0 while hidden); `restHeight` is its footprint with the
     *  drawer closed, which is the stable value a layout can reserve without reflowing
     *  during the drawer animation; `atLeftEdge` marks a panel flush with the viewport's
     *  left edge, where it sits under the bottom-left toast column. */
    onGeometry?: (geometry: { height: number; restHeight: number; atLeftEdge: boolean }) => void;
  }

  let { tasks, progress, onRemove, hidden = false, onGeometry }: Props = $props();

  // `$derived`, not a snapshot: the heading follows a language switch.
  const title = $derived(copy.uploadPanel.transcodeTitle);

  /** Matches the row's collapse transition, so the shell outlives the last collapse. */
  const ROW_EXIT_MS = motionMs('enter');

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
  /** The drawer's expanding region, measured only to subtract it from the shell height. */
  let bodyEl = $state<HTMLElement | undefined>(undefined);

  /** A panel within this many pixels of the viewport's left edge is the full-width mobile
   *  presentation (it also overlaps the bottom-left toast column); the right-aligned desktop
   *  panel is not. Measured from the shell, not assumed from a breakpoint or the input device. */
  const LEFT_EDGE_MAX = 8;
  let compact = $state(false);

  /** Closed header height, measured from the shell as `shell height − body height`. The two
   *  grow and shrink together, so the difference is the header in every state, including
   *  mid-animation. `HEADER_FALLBACK_H` only covers the render before the first measurement:
   *  py-3.5 (28px) + the `text-sm` counter's line box (20px). The label alone is `text-xs`
   *  (44px), which is why a hardcoded constant was four pixels wrong whenever the counter
   *  was hidden. */
  const HEADER_FALLBACK_H = 48;
  let headerH = $state(HEADER_FALLBACK_H);

  // Observe rendered geometry and visibility to update toast clearance.
  $effect(() => {
    if (!shellEl) {
      compact = false;
      onGeometry?.({ height: 0, restHeight: 0, atLeftEdge: false });
      return;
    }
    const report = () => {
      const rect = shellEl!.getBoundingClientRect();
      const shellH = shellEl!.offsetHeight;
      const bodyRenderedH = bodyEl?.offsetHeight ?? 0;
      const restH = Math.max(0, shellH - bodyRenderedH);
      compact = rect.left < LEFT_EDGE_MAX;
      headerH = restH;
      onGeometry?.({
        height: hidden ? 0 : shellH,
        restHeight: hidden ? 0 : restH,
        atLeftEdge: compact,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(shellEl);
    return () => ro.disconnect();
  });

  // ---- expansion mode ----------------------------------------------------
  const intent = createHoverIntent();

  // Hover capability is not the signal that decides the presentation: a narrow desktop
  // window renders this panel as the full-width bottom sheet while its pointer can still
  // hover. The drawer therefore also follows the panel's measured full-width form, so the
  // chevron is never missing from a mobile-looking panel. Both signals are shared:
  // `canHover` comes from `base/lib/device.svelte.ts`, `compact` from the shell's own rect.
  const drawer = $derived(!canHover() || compact);

  // Entering waits for nothing, so an intentional hover feels immediate. A keyboard or
  // click pins the panel open instead, because there is no pointer to hover with.
  let pinned = $state(false);
  onDestroy(intent.destroy);

  // The drawer is the mode without hover to expand with: a single tap on the header's
  // chevron opens or closes it, and no drag gesture competes with the list inside.
  let open = $state(false);
  let expanded = $derived(drawer ? open : pinned || intent.hovered);

  /** Row pitch: py-1.5 (12px) + text-xs line-height (16px) = 28px. */
  const ROW_H = 28;
  /** Share of the visible viewport the sheet may occupy. */
  const SHEET_MAX_FRACTION = 0.42;
  /** Visible viewport height. `visualViewport` excludes a mobile URL bar, so the open ceiling
   *  and the scroll container's max-height are one measured value rather than `innerHeight`
   *  in JS and `svh` in CSS. */
  let viewportH = $state(
    typeof window === 'undefined' ? 0 : (window.visualViewport?.height ?? window.innerHeight),
  );
  $effect(() => {
    const viewport = window.visualViewport;
    const sync = () => (viewportH = viewport?.height ?? window.innerHeight);
    sync();
    viewport?.addEventListener('resize', sync);
    window.addEventListener('resize', sync);
    return () => {
      viewport?.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  });
  const sheetMaxH = $derived(Math.max(headerH, Math.round(viewportH * SHEET_MAX_FRACTION)));
  /** Bottom padding of the list body (`pb-2`), so the last row is not flush with the edge. */
  const LIST_PAD_B = 8;
  /** Fully-open height for the current row count, capped to the viewport. Rows finish while
   *  the drawer is open, so this follows the shrinking list instead of leaving empty space. */
  const openH = $derived(
    Math.max(headerH, Math.min(headerH + tasks.length * ROW_H + LIST_PAD_B, sheetMaxH)),
  );
  const bodyH = $derived(Math.max(0, openH - headerH));

  // Collapse a departing row's slot instead of letting the list snap shut.
  function collapse(node: HTMLElement): { duration: number; css: (t: number) => string } {
    void node;
    const reduced = prefersReducedMotion();
    return {
      duration: reduced ? 0 : motionMs('enter'),
      css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t}`,
    };
  }

  /** Batch total across the rows, or null while any row's stage cannot measure itself —
   *  the bar then sweeps instead of naming a number the work does not support. */
  const totalFraction = $derived(batchProgress(tasks));

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
    onpointerenter={intent.enter}
    onpointerleave={intent.leave}
  >
    <div
      bind:this={shellEl}
      class="relative overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-lg shadow-black/30 backdrop-blur-xl md:rounded-xl md:border-b md:pb-0"
    >
      <!-- Hover devices expand on hover and click to pin; the drawer mode taps the chevron
           to open or close. The header is the single toggle in both. -->
      <button
        type="button"
        class="flex w-full items-center gap-2.5 px-4 py-3.5 text-left select-none"
        aria-expanded={expanded}
        aria-label={title}
        onclick={() => {
          if (drawer) open = !open;
          else pinned = !pinned;
        }}
      >
        <Clapperboard class="size-4 shrink-0 text-muted-foreground" />
        <span class="flex-1 text-xs text-muted-foreground">{title}</span>
        {#if progress && progress.total > 0}
          <!-- Remaining count only, one big number that fade-hops when it ticks down
               (user call): the done/total pair read as clutter at header size. Both keyed
               spans share one grid cell so the cross-fade never reflows the header. -->
          {@const remaining = progress.total - progress.done}
          <span
            class="inline-grid shrink-0 justify-items-end text-sm font-semibold tabular-nums text-foreground"
          >
            {#key remaining}
              <span
                class="col-start-1 row-start-1"
                in:fly={countHop}
                out:fly={{ ...countHop, y: -countHop.y }}
              >
                {remaining}
              </span>
            {/key}
          </span>
        {/if}
        {#if drawer}
          {#if expanded}
            <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {:else}
            <ChevronUp class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/if}
        {/if}
      </button>

      <!-- Animate expansion with grid rows on hover devices; the drawer animates its
           measured height between the header and the capped content height. -->
      <div
        bind:this={bodyEl}
        inert={!expanded}
        class="overflow-hidden {drawer
          ? 'transition-[height] duration-[var(--duration-enter)] ease-[var(--ease-enter)]'
          : 'grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)] ' +
            (expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}"
        style={drawer ? `height: ${expanded ? bodyH : 0}px` : ''}
      >
        <div
          class="min-h-0 overscroll-contain overflow-y-auto {drawer
            ? 'h-full'
            : 'max-h-[min(40vh,17.5rem)]'}"
          style={drawer ? `max-height: ${bodyH}px;` : ''}
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
                    aria-valuenow={indeterminateRow(task) ? undefined : pct(task)}
                  >
                    {#if indeterminateRow(task)}
                      <div class="sweep h-full rounded-full bg-primary/70"></div>
                    {:else}
                      <div
                        class="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
                        style="width: {pct(task)}%"
                      ></div>
                    {/if}
                  </div>
                  <TooltipIconButton
                    text={copy.uploadPanel.remove}
                    ariaLabel={fmt(copy.uploadPanel.removeFile, { fileName: task.fileName })}
                    side="top"
                    danger
                    class="size-4 shrink-0 rounded-full hover:text-destructive"
                    onclick={() => onRemove(task.jobId)}
                  >
                    <X class="size-3" />
                  </TooltipIconButton>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Batch total along the panel's bottom edge, shown while collapsed: with the rows
           out of sight, a live bar is what separates a hover collapse (the batch is still
           running) from a finished one (the panel unmounts entirely). -->
      {#if !expanded && tasks.length > 0}
        <div
          class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted-foreground/20"
          role="progressbar"
          aria-label={title}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={totalFraction == null ? undefined : Math.round(totalFraction * 100)}
        >
          {#if totalFraction == null}
            <div class="sweep h-full bg-primary/70"></div>
          {:else}
            <div
              class="h-full bg-primary transition-[width] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
              style="width: {Math.round(totalFraction * 100)}%"
            ></div>
          {/if}
        </div>
      {/if}
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
