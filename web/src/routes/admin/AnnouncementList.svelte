<script lang="ts">
  import { tick } from 'svelte';
  import type { Announcement } from '$shared/types';
  import { Megaphone, Pencil, Trash2 } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/time';
  import * as ops from '../../core/ops';
  import { reactionCounts } from '../../core/reactions';

  interface Props {
    announcements: Announcement[];
    /** Per-row write state: 'saving' while in flight, 'error' when it failed. */
    saveState: Record<number, 'saving' | 'error'>;
    timeReference: number;
    onEdit: (announcement: Announcement) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
  }

  let { announcements, saveState, timeReference, onEdit, onDelete, onReorder }: Props = $props();

  let dragId = $state<number | null>(null);
  let draft = $state<ops.AnnouncementReorderDraft | null>(null);
  // Candidate drag id recorded on pointerdown before the threshold, so a plain click never drags.
  let pressId: number | null = null;
  let pressX = 0;
  let pressY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  // Natural position of the dragged card (viewport coords); remeasured only on press, reorder or scroll.
  let baseLeft = 0;
  let baseTop = 0;
  let draggedElement: HTMLElement | null = null;
  let flipToken = 0;
  const cardElements = new Map<number, HTMLElement>();
  const animations = new Map<number, Animation>();

  const DRAG_THRESHOLD = 4;

  const visibleAnnouncements = $derived.by(() =>
    draft ? ops.applyAnnReorder(announcements, draft.orderedIds) : announcements,
  );

  function card(node: HTMLElement, id: number) {
    cardElements.set(id, node);
    return {
      destroy() {
        cardElements.delete(id);
      },
    };
  }

  function reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function captureRects(): Map<number, DOMRect> {
    const rects = new Map<number, DOMRect>();
    for (const [id, element] of cardElements) rects.set(id, element.getBoundingClientRect());
    return rects;
  }

  async function flipDisplaced(first: Map<number, DOMRect>): Promise<void> {
    const token = ++flipToken;
    await tick();
    if (token !== flipToken) return;
    // The dragged card moved in the document: rebase it first, then FLIP the others.
    rebaseDraggedCard();
    if (reducedMotion()) return;
    for (const [id, element] of cardElements) {
      if (id === dragId) continue;
      const previous = first.get(id);
      const current = element.getBoundingClientRect();
      if (!previous) continue;
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      animations.get(id)?.cancel();
      if (dx === 0 && dy === 0) continue;
      const animation = element.animate(
        [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      animations.set(id, animation);
    }
  }

  function followPointer(x: number, y: number): void {
    const element = draggedElement;
    if (!element || dragId === null) return;
    element.style.transform = `translate3d(${x - grabOffsetX - baseLeft}px, ${y - grabOffsetY - baseTop}px, 0)`;
  }

  /** Remeasure the dragged card's natural position (clear transform briefly, same frame, no flicker) and stick it back to the pointer. */
  function rebaseDraggedCard(): void {
    const element = draggedElement;
    if (!element || dragId === null) return;
    element.style.transform = 'none';
    const rect = element.getBoundingClientRect();
    baseLeft = rect.left;
    baseTop = rect.top;
    followPointer(pointerX, pointerY);
  }

  /**
   * Slot (0…n in the final order) where the pointer should insert. Hit-tests with
   * offsetTop/offsetHeight — immune to FLIP transforms — and only swaps after the
   * pointer crosses the target card's midpoint, the hysteresis that kills jitter.
   */
  function reorderTarget(docY: number): number | null {
    if (!draft) return null;
    const order = draft.orderedIds;
    for (let index = 0; index < order.length; index += 1) {
      const id = order[index];
      if (id === dragId) continue;
      const element = cardElements.get(id);
      if (!element) continue;
      let top = 0;
      let node: HTMLElement | null = element;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      const height = element.offsetHeight;
      if (docY < top || docY >= top + height) continue;
      return docY < top + height / 2 ? index : index + 1;
    }
    return null;
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
    const slot = reorderTarget(pointerY + window.scrollY);
    if (slot === null || !draft) return;
    const next = ops.moveAnnouncementReorderToIndex(draft, slot);
    if (next === draft) return;
    const first = captureRects();
    draft = next;
    void flipDisplaced(first);
  }

  function activateDrag(): void {
    const id = pressId;
    const element = id === null ? undefined : cardElements.get(id);
    if (id === null || !element) return;
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    const rect = element.getBoundingClientRect();
    dragId = id;
    draggedElement = element;
    draft = ops.beginAnnouncementReorder(
      announcements.map((announcement) => announcement.id),
      id,
    );
    grabOffsetX = pointerX - rect.left;
    grabOffsetY = pointerY - rect.top;
    baseLeft = rect.left;
    baseTop = rect.top;
  }

  function onPointerDown(event: PointerEvent, id: number): void {
    if (event.button !== 0 || dragId !== null || pressId !== null) return;
    // Interactions on the edit/delete buttons never start a drag
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    pressId = id;
    pressX = event.clientX;
    pressY = event.clientY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }

  function removePointerListeners(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('scroll', onScroll, { capture: true });
  }

  function onScroll(): void {
    // Scrolling shifts layout relative to the viewport: rebase the dragged card so it follows the pointer
    if (dragId !== null) rebaseDraggedCard();
  }

  function settleDraggedCard(): void {
    const element = draggedElement;
    if (!element) return;
    if (reducedMotion()) element.style.transform = '';
    else {
      const animation = element.animate(
        [{ transform: element.style.transform }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      const clearTransform = () => {
        if (dragId === null) element.style.transform = '';
      };
      animation.finished.then(clearTransform, clearTransform);
    }
  }

  async function commitDraft(activeDraft: ops.AnnouncementReorderDraft): Promise<void> {
    const { draft: finalized, orderedIds } = ops.finalizeAnnouncementReorder(activeDraft);
    draft = finalized;
    if (!orderedIds) {
      draft = null;
      return;
    }
    // Reorder is never blocked: a row created moments ago still carries a temp
    // id, and the store flushes the order once the real id arrives.
    onReorder([...orderedIds]);
    await tick();
    draft = null;
  }

  function onPointerUp(event: PointerEvent): void {
    if (pressId === null) return;
    event.preventDefault();
    removePointerListeners();
    if (dragId === null) {
      // Never crossed the threshold: treat as a plain click and do nothing
      pressId = null;
      return;
    }
    const activeDraft = draft;
    pressId = null;
    dragId = null;
    settleDraggedCard();
    draggedElement = null;
    if (activeDraft) void commitDraft(activeDraft);
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
    pressId = null;
    dragId = null;
    draft = null;
    draggedElement?.style.setProperty('transform', '');
    draggedElement = null;
    void tick().then(() => flipDisplaced(first));
  }
</script>

<div class="space-y-4" role="list">
  {#if announcements.length === 0}
    <EmptyState icon={Megaphone} text="暂无公告" />
  {:else}
    {#each visibleAnnouncements as announcement (announcement.id)}
      {@const absoluteTime = formatAbsoluteTime(announcement.updatedAt)}
      {@const counts = reactionCounts(announcement, -1)}
      <div
        use:card={announcement.id}
        data-announcement-id={announcement.id}
        role="listitem"
        class="touch-none cursor-grab select-none rounded-xl border border-border bg-card p-4 active:cursor-grabbing {dragId ===
        announcement.id
          ? 'pointer-events-none relative z-10 opacity-50'
          : ''}"
        onpointerdown={(event) => onPointerDown(event, announcement.id)}
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-medium">{announcement.title}</h3>
            <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {announcement.contentMd}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <Tooltip text="编辑">
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                aria-label="编辑公告"
                onclick={() => onEdit(announcement)}
              >
                <Pencil class="size-4" />
              </button>
            </Tooltip>
            <Tooltip text="删除">
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="删除公告"
                onclick={() => onDelete(announcement.id)}
              >
                <Trash2 class="size-4" />
              </button>
            </Tooltip>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground/70">
          <div class="flex flex-wrap items-center gap-2">
            {#if saveState[announcement.id] === 'saving'}
              <span
                class="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary"
              >
                保存中
              </span>
            {:else if saveState[announcement.id] === 'error'}
              <span
                class="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive"
              >
                保存失败
              </span>
            {/if}
            {#each counts as count (count.emoji)}
              <span class="rounded-full border border-border px-2 py-0.5">
                {count.emoji}
                {count.count}
              </span>
            {/each}
          </div>
          <Tooltip text={absoluteTime} side="top">
            <span class="shrink-0 rounded-sm">
              {formatRelativeTime(announcement.updatedAt, timeReference)}
            </span>
          </Tooltip>
        </div>
      </div>
    {/each}
  {/if}
</div>
