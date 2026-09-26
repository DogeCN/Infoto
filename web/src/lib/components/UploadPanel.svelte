<script lang="ts">
  // Upload progress panel for the home waterfall. It shows the leg the caller hands in:
  // the album feeds it the transcode rows (queue / token wait / transcode) and the moment
  // a file is transcoded its row collapses out and the waterfall card carries the rest
  // under its curtain. There is no second panel — the editor's upload feedback is its save
  // button (Save → uploading), so a floating panel there would be a duplicate readout.
  //
  // One file is ONE row: filename left, bar filling whatever is left of the row, and a
  // remove button at the far end. No icon, no stage word, no percentage — the bar is the
  // whole message and runs 0→1 in one piece rather than resetting per stage. A phase with
  // no progress to report yet (queued, waiting for a video token) sweeps instead of
  // sitting dead at zero.
  //
  // Expansion has no button. A pointer-capable device reveals the list while the pointer
  // rests on the panel — entering is instant, leaving waits out a wobble (the TimeLabel
  // debounce) and the hit area is padded so the edge is not a knife edge. Touch devices
  // have no hover, so there the header drags the sheet open and closed: the height
  // follows the finger 1:1 and only the release decides, past the midpoint being "open".
  import { onDestroy } from 'svelte';
  import { Clapperboard, X } from '@lucide/svelte';
  import { copy, fmt } from '$shared/copy';
  import type { UploadRow } from '../../transcode/pipeline';

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
  }

  let { tasks, progress, onRemove, hidden = false }: Props = $props();

  const title = copy.uploadPanel.transcodeTitle;

  /** Matches the row's exit transition, so the shell outlives the last collapse. */
  const ROW_EXIT_MS = 280;

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

  // ---- pointer devices: hover, debounced ---------------------------------
  /** Leaving waits; entering does not, so an intentional hover feels immediate. */
  const LEAVE_DELAY_MS = 160;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let canHover = $state(false);
  let expanded = $state(false);

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

  function onEnter(): void {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = undefined;
    }
    if (canHover) expanded = true;
  }
  function onLeave(): void {
    if (!canHover) return;
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      expanded = false;
      leaveTimer = undefined;
    }, LEAVE_DELAY_MS);
  }
  onDestroy(() => {
    if (leaveTimer) clearTimeout(leaveTimer);
  });

  // ---- touch devices: drag the header ------------------------------------
  // The sheet is bottom-anchored, so it grows upward and the finger delta is applied
  // inverted. Nothing is decided mid-drag: pointerdown anchors the current rendered
  // height (grabbing a half-open sheet continues smoothly), pointermove only clamps to
  // the two physical ends, and pointerup picks the end by the midpoint.
  const HEADER_H = 44;
  /** Row pitch: py-1.5 (12px) + text-xs line-height (16px) = 28px. */
  const ROW_H = 28;
  let dragging = $state(false);
  let dragStartY: number | null = null;
  let dragBaseH = 0;
  let sheetH = $state(0);

  function naturalH(): number {
    return HEADER_H + tasks.length * ROW_H + 8;
  }
  function onHeaderPointerDown(e: PointerEvent): void {
    if (canHover) return;
    dragging = true;
    dragStartY = e.clientY;
    sheetH =
      (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().height || HEADER_H;
    dragBaseH = sheetH;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onHeaderPointerMove(e: PointerEvent): void {
    if (!dragging || dragStartY === null) return;
    sheetH = Math.min(naturalH(), Math.max(HEADER_H, dragBaseH - (e.clientY - dragStartY)));
  }
  function onHeaderPointerUp(): void {
    if (!dragging) return;
    const open = sheetH > (HEADER_H + naturalH()) / 2;
    dragging = false;
    dragStartY = null;
    sheetH = 0;
    expanded = open;
  }

  /** Collapse a departing row's slot instead of letting the list snap shut. */
  function collapse(node: HTMLElement): { duration: number; css: (t: number) => string } {
    void node;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reduced ? 0 : 240,
      css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t}`,
    };
  }

  /**
   * Nothing measurable to show — the bar sweeps instead of claiming a percentage. Two
   * cases: the job has not started (queued, waiting for a video token), or the leg it is
   * on cannot measure itself (image transcoding is three indivisible steps; only video
   * encoding and the upload transfer report real fractions).
   */
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
    onpointerenter={onEnter}
    onpointerleave={onLeave}
  >
    <div
      class="relative overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-lg shadow-black/30 backdrop-blur-xl md:rounded-xl md:border-b md:pb-0"
    >
      <!-- No expand button: pointer devices hover, touch devices drag this header. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center gap-2.5 px-4 py-3.5 select-none {canHover
          ? ''
          : 'cursor-grab touch-none'}"
        role="button"
        tabindex="0"
        aria-expanded={expanded}
        aria-label={title}
        onpointerdown={onHeaderPointerDown}
        onpointermove={onHeaderPointerMove}
        onpointerup={onHeaderPointerUp}
        onpointercancel={onHeaderPointerUp}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            expanded = !expanded;
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

      <!-- The list collapses via grid-template-rows 1fr↔0fr, not max-h-0: a max-height
           clip gives its children a zero-width content box in some engines and the bars
           vanish. While dragging the grid is dropped and the height is inline, so the
           sheet tracks the finger with no transition lag. -->
      <div
        class="overflow-hidden {dragging
          ? ''
          : 'grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)] ' +
            (expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}"
      >
        <div
          class="min-h-0 max-h-[60vh] overscroll-contain overflow-y-auto md:max-h-[min(40vh,17.5rem)]"
          style={dragging ? `height: ${Math.max(0, sheetH - HEADER_H)}px` : ''}
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
                    class="flex size-4 shrink-0 items-center justify-center rounded-full text-destructive/70 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:text-destructive"
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
  /* The collapsed panel is a thin bar, so a pointer wobbling across its edge must not
     flip the list open and shut: pad the hover boundary. The card itself is `relative`
     so it paints above this pseudo-element — a positioned ::before would otherwise
     swallow every click meant for the row's remove button. */
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
