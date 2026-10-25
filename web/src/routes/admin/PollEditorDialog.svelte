<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { CheckSquare, Eraser, GripVertical, Plus, Trash2 } from '@lucide/svelte';
  import { fmt, plural } from '$shared/copy';
  import { MAX_POLL_OPTIONS, type Poll, type Vote } from '$shared/types';
  import { countHop, countHopOut, motionEase, motionMs } from '$base/lib/motion';
  import { prefersReducedMotion } from '$base/lib/device.svelte';
  import TriStateToggle from '$lib/components/TriStateToggle.svelte';
  import EditorDialog from '$lib/components/EditorDialog.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface DraftOption {
    id: number;
    value: string;
    /** Voters on this option; they move with it when the rows are reordered. */
    votes: Vote[];
  }

  interface Props {
    poll: Poll | null;
    /** In-memory draft to seed the fields with; wins over `poll`. */
    draft?: { options: string[]; votes: Vote[]; allowMultiple: boolean } | null;
    selfId?: number;
    onSave: (options: string[], allowMultiple: boolean, votes: Vote[]) => void;
    onCancel: () => void;
  }

  let { poll, draft = null, selfId = -1, onSave, onCancel }: Props = $props();
  let nextOptionId = 0;
  let options = $state<DraftOption[]>(
    untrack(() => {
      const values = draft?.options ?? poll?.options ?? ['', ''];
      const votes = draft?.votes ?? poll?.votes ?? [];
      return values.map((value, index) => ({
        id: nextOptionId++,
        value,
        votes: votes
          .filter((vote) => vote.option === index)
          .map((vote) => ({ userId: vote.userId, option: index })),
      }));
    }),
  );
  let allowMultiple = $state(untrack(() => draft?.allowMultiple ?? poll?.allowMultiple ?? false));
  let canSave = $derived(
    options.length >= 2 &&
      options.length <= MAX_POLL_OPTIONS &&
      options.every((option) => option.value.trim().length > 0),
  );

  /** Votes addressed by the editor's current option order: nothing is remapped on save,
   *  the rows already carry their own voters. A single-choice poll shows one vote per user. */
  let liveVotes = $derived.by(() => {
    const rows: Vote[] = [];
    options.forEach((option, index) => {
      for (const vote of option.votes) rows.push({ userId: vote.userId, option: index });
    });
    const kept = allowMultiple
      ? rows
      : rows.filter((vote, index) => rows.findIndex((row) => row.userId === vote.userId) === index);
    return kept.sort((a, b) => a.userId - b.userId || a.option - b.option);
  });
  let counts = $derived.by(() => {
    const result = new Array<number>(options.length).fill(0);
    for (const vote of liveVotes) {
      if (vote.option >= 0 && vote.option < result.length) result[vote.option]! += 1;
    }
    return result;
  });
  let total = $derived(counts.reduce((sum, count) => sum + count, 0));
  let max = $derived(counts.length ? Math.max(...counts) : 0);
  let chosen = $derived(
    new Set(liveVotes.filter((vote) => vote.userId === selfId).map((vote) => vote.option)),
  );
  let hasVotes = $derived(liveVotes.length > 0);

  /** Live draft snapshot, captured by the tab switch so the editor can be parked unmounted. */
  export function getDraft(): { options: string[]; votes: Vote[]; allowMultiple: boolean } {
    return {
      options: options.map((option) => option.value),
      votes: options.flatMap((option, index) =>
        option.votes.map((vote) => ({ userId: vote.userId, option: index })),
      ),
      allowMultiple,
    };
  }

  function addOption(): void {
    if (options.length >= MAX_POLL_OPTIONS) return;
    options = [...options, { id: nextOptionId++, value: '', votes: [] }];
  }

  function removeOption(id: number): void {
    if (options.length <= 2) return;
    options = options.filter((option) => option.id !== id);
  }

  /** Stage a full reset; Save commits the empty vote set through the same overwrite call. */
  function clearVotes(): void {
    options = options.map((option) => ({ ...option, votes: [] }));
  }

  function submit(): void {
    onSave(
      options.map((option) => option.value.trim()),
      allowMultiple,
      liveVotes,
    );
  }

  // ---- Handle drag-sort ----------------------------------------------------------------
  // Only the handle starts a drag: the row is a text field, so a drag surface over the
  // whole row would steal caret placement. The dragged row is lifted out of the flow with
  // a pointer-following transform (the same shadow ReorderableList gives a card) and the
  // displaced rows FLIP into place. Reordering moves the option object itself, so each
  // option's votes travel with its label and no index remapping is needed.

  const DRAG_THRESHOLD = 4;
  let rowsEl = $state<HTMLElement | undefined>(undefined);
  const rowElements = new Map<number, HTMLElement>();
  const animations = new Map<number, Animation>();
  let pressId: number | null = null;
  let pressX = 0;
  let pressY = 0;
  let dragId = $state<number | null>(null);
  let pointerX = 0;
  let pointerY = 0;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let baseLeft = 0;
  let baseTop = 0;
  let draggedElement: HTMLElement | null = null;
  let dragStartOptions: DraftOption[] | null = null;
  let flipToken = 0;

  function row(node: HTMLElement, id: number) {
    rowElements.set(id, node);
    return {
      destroy() {
        rowElements.delete(id);
      },
    };
  }

  function captureRects(): Map<number, DOMRect> {
    const rects = new Map<number, DOMRect>();
    for (const [id, element] of rowElements) rects.set(id, element.getBoundingClientRect());
    return rects;
  }

  async function flipDisplaced(first: Map<number, DOMRect>): Promise<void> {
    const token = ++flipToken;
    await tick();
    if (token !== flipToken) return;
    rebaseDraggedCard();
    if (prefersReducedMotion()) return;
    for (const [id, element] of rowElements) {
      if (id === dragId) continue;
      const previous = first.get(id);
      if (!previous) continue;
      const current = element.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      animations.get(id)?.cancel();
      if (dx === 0 && dy === 0) continue;
      animations.set(
        id,
        element.animate(
          [
            { transform: `translate3d(${dx}px, ${dy}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: motionMs('exit'), easing: motionEase('exit') },
        ),
      );
    }
  }

  function followPointer(x: number, y: number): void {
    const element = draggedElement;
    if (!element || dragId === null) return;
    element.style.transform = `translate3d(${x - grabOffsetX - baseLeft}px, ${y - grabOffsetY - baseTop}px, 0)`;
  }

  /** Remeasure the dragged row's natural position (clear transform briefly, same frame,
   *  no flicker) and stick it back under the pointer. */
  function rebaseDraggedCard(): void {
    const element = draggedElement;
    if (!element || dragId === null) return;
    element.style.transform = 'none';
    const rect = element.getBoundingClientRect();
    baseLeft = rect.left;
    baseTop = rect.top;
    followPointer(pointerX, pointerY);
  }

  /** Slot (0…n) the pointer would insert into. `offsetTop` is layout-based, so the
   *  dragged row's transform and the FLIP animations on its neighbours cannot skew it. */
  function insertionSlot(clientY: number): number {
    const containerTop = rowsEl?.getBoundingClientRect().top ?? 0;
    const y = clientY - containerTop;
    for (let index = 0; index < options.length; index += 1) {
      const element = rowElements.get(options[index]!.id);
      if (!element) continue;
      if (y < element.offsetTop + element.offsetHeight / 2) return index;
    }
    return options.length;
  }

  function activateDrag(): void {
    const id = pressId;
    const element = id === null ? undefined : rowElements.get(id);
    if (id === null || !element) return;
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    const rect = element.getBoundingClientRect();
    dragId = id;
    draggedElement = element;
    dragStartOptions = options;
    grabOffsetX = pointerX - rect.left;
    grabOffsetY = pointerY - rect.top;
    baseLeft = rect.left;
    baseTop = rect.top;
  }

  function onPointerMove(event: PointerEvent): void {
    if (pressId === null) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (dragId === null) {
      if (Math.hypot(pointerX - pressX, pointerY - pressY) < DRAG_THRESHOLD) return;
      activateDrag();
    } else {
      event.preventDefault();
    }
    followPointer(pointerX, pointerY);
    const from = options.findIndex((option) => option.id === dragId);
    if (from < 0) return;
    const slot = insertionSlot(pointerY);
    const without = options.filter((option) => option.id !== dragId);
    const insert = Math.max(0, Math.min(slot > from ? slot - 1 : slot, without.length));
    if (insert === from) return;
    const first = captureRects();
    options = [...without.slice(0, insert), options[from]!, ...without.slice(insert)];
    void flipDisplaced(first);
  }

  function onScroll(): void {
    if (dragId !== null) rebaseDraggedCard();
  }

  function removePointerListeners(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('scroll', onScroll, { capture: true });
  }

  function settleDraggedCard(): void {
    const element = draggedElement;
    if (!element) return;
    if (prefersReducedMotion()) element.style.transform = '';
    else {
      const animation = element.animate(
        [{ transform: element.style.transform }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: motionMs('exit'), easing: motionEase('exit') },
      );
      const clearTransform = () => {
        if (dragId === null) element.style.transform = '';
      };
      animation.finished.then(clearTransform, clearTransform);
    }
  }

  function startDrag(event: PointerEvent, id: number): void {
    if (event.button !== 0 || pressId !== null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pressId = id;
    pressX = event.clientX;
    pressY = event.clientY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }

  function onPointerUp(event: PointerEvent): void {
    if (pressId === null) return;
    event.preventDefault();
    removePointerListeners();
    if (dragId === null) {
      // Never crossed the threshold: a plain press on the handle does nothing.
      pressId = null;
      return;
    }
    pressId = null;
    dragId = null;
    settleDraggedCard();
    draggedElement = null;
    dragStartOptions = null;
  }

  function onPointerCancel(event: PointerEvent): void {
    if (pressId === null) return;
    event.preventDefault();
    removePointerListeners();
    if (dragId === null) {
      pressId = null;
      return;
    }
    const first = captureRects();
    const original = dragStartOptions;
    pressId = null;
    dragId = null;
    draggedElement?.style.setProperty('transform', '');
    draggedElement = null;
    dragStartOptions = null;
    if (original) options = original;
    void tick().then(() => flipDisplaced(first));
  }
</script>

<EditorDialog
  label={poll ? copy.admin.poll.edit : copy.admin.newPoll}
  {canSave}
  saveLabel={copy.admin.editor.save}
  onSave={submit}
  {onCancel}
>
  {#snippet body()}
    <div class="mx-auto flex max-w-3xl flex-col gap-5">
      <fieldset class="space-y-3">
        <legend class="sr-only">{copy.admin.editor.pollOptions}</legend>
        <div bind:this={rowsEl} class="relative space-y-2">
          {#each options as option, index (option.id)}
            {@const count = counts[index] ?? 0}
            {@const pct = total ? (count / total) * 100 : 0}
            {@const isChosen = chosen.has(index)}
            {@const isWinner = max > 0 && count === max}
            <div
              use:row={option.id}
              class="flex items-center gap-2 {dragId === option.id
                ? 'relative z-10 opacity-60'
                : ''}"
            >
              <button
                type="button"
                class="icon-button size-9 shrink-0 touch-none cursor-grab active:cursor-grabbing"
                aria-label={fmt(copy.admin.editor.movePollOption, { number: index + 1 })}
                onpointerdown={(event) => startDrag(event, option.id)}
              >
                <GripVertical class="size-4" />
              </button>
              <!-- The vote result lives in the field itself: the fill bar behind a transparent
                   input, the count at its right edge — the same fill/count pair VoteBlock uses,
                   so the count stays on the option it belongs to while the row is edited. -->
              <div class="relative min-w-0 flex-1">
                <span
                  class="vote-fill pointer-events-none absolute inset-y-0 left-0 rounded-md bg-primary/10 transition-[width] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
                  style="width: {pct.toFixed(1)}%"
                ></span>
                <input
                  bind:value={option.value}
                  required
                  maxlength="200"
                  type="text"
                  aria-label={fmt(copy.admin.editor.pollOptionLabel, { number: index + 1 })}
                  placeholder={fmt(copy.admin.editor.pollOptionLabel, { number: index + 1 })}
                  class="field-control relative z-10 w-full min-w-0 bg-transparent {total > 0
                    ? 'pr-14'
                    : ''}"
                />
                {#if total > 0}
                  <span
                    class="pointer-events-none absolute inset-y-0 right-3 z-20 flex items-center"
                  >
                    <span
                      class="inline-grid justify-items-end text-sm font-semibold tabular-nums {isChosen ||
                      isWinner
                        ? 'text-primary'
                        : 'text-foreground'}"
                      aria-label={fmt(plural(count, copy.vote.count), { count })}
                    >
                      {#key count}
                        <span
                          class="col-start-1 row-start-1"
                          in:fly={countHop}
                          out:fly={countHopOut}
                        >
                          {count}
                        </span>
                      {/key}
                    </span>
                  </span>
                {/if}
              </div>
              <button
                type="button"
                class="icon-button icon-button--danger size-9 shrink-0"
                aria-label={fmt(copy.admin.editor.removePollOption, { number: index + 1 })}
                disabled={options.length <= 2}
                onclick={() => removeOption(option.id)}
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          {/each}
        </div>
        <!-- Add, multi-select and clear share one row: three controls of the same box, aligned
             with each other instead of the clear action dropping to its own line. -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            class="action-button action-button--secondary"
            aria-label={copy.admin.editor.addPollOption}
            disabled={options.length >= MAX_POLL_OPTIONS}
            onclick={addOption}
          >
            <Plus class="size-4" />
            {copy.admin.editor.addPollOption}
          </button>
          <div class="flex items-center gap-2">
            <TriStateToggle
              label={copy.admin.editor.pollAllowMultiple}
              icon={CheckSquare}
              state={allowMultiple ? 'only' : 'off'}
              class="gap-2 rounded-md px-4 text-sm [&_svg]:size-4"
              onCycle={() => (allowMultiple = !allowMultiple)}
            />
            {#if poll}
              <button
                type="button"
                class="action-button action-button--secondary text-destructive"
                disabled={!hasVotes}
                onclick={clearVotes}
              >
                <Eraser class="size-4" />
                {copy.admin.poll.clearVotes}
              </button>
            {/if}
          </div>
        </div>
      </fieldset>
    </div>
  {/snippet}
</EditorDialog>
