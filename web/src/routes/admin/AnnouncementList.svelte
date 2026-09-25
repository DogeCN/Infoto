<script lang="ts">
  import { tick } from 'svelte';
  import type { Announcement } from '$shared/types';
  import { GripVertical, Megaphone, Pencil, Trash2 } from '@lucide/svelte';
  import EmptyState from '$lib/components/custom/EmptyState.svelte';
  import Tooltip from '$lib/components/custom/Tooltip.svelte';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/time';
  import * as ops from '../../core/ops';
  import { reactionCounts } from '../../core/reactions';

  interface Props {
    announcements: Announcement[];
    pendingIds: ReadonlySet<number>;
    timeReference: number;
    onEdit: (announcement: Announcement) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => Promise<{ ok: boolean }>;
    onInvalidReorder: () => void;
  }

  let {
    announcements,
    pendingIds,
    timeReference,
    onEdit,
    onDelete,
    onReorder,
    onInvalidReorder,
  }: Props = $props();

  let dragId = $state<number | null>(null);
  let draft = $state<ops.AnnouncementReorderDraft | null>(null);
  let pointerX = 0;
  let pointerY = 0;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let draggedElement: HTMLElement | null = null;
  let flipToken = 0;
  const cardElements = new Map<number, HTMLElement>();
  const animations = new Map<number, Animation>();

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
    if (token !== flipToken || reducedMotion()) return;
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
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      animations.set(id, animation);
    }
  }

  function followPointer(x: number, y: number): void {
    const element = draggedElement;
    if (!element || dragId === null) return;
    element.style.transform = 'none';
    const base = element.getBoundingClientRect();
    element.style.transform = `translate3d(${x - grabOffsetX - base.left}px, ${y - grabOffsetY - base.top}px, 0)`;
  }

  function onPointerMove(event: PointerEvent): void {
    if (dragId === null) return;
    event.preventDefault();
    pointerX = event.clientX;
    pointerY = event.clientY;
    followPointer(pointerX, pointerY);
    const target = document
      .elementFromPoint(pointerX, pointerY)
      ?.closest<HTMLElement>('[data-announcement-id]');
    if (!target || target.id === 'dragged-announcement') return;
    const targetId = Number(target.dataset.announcementId);
    if (!Number.isInteger(targetId) || targetId === dragId || !draft) return;
    const next = ops.moveAnnouncementReorder(draft, targetId);
    if (next === draft) return;
    const first = captureRects();
    draft = next;
    void flipDisplaced(first).then(() => followPointer(pointerX, pointerY));
  }

  function onPointerDown(event: PointerEvent, id: number): void {
    if (event.button !== 0 || dragId !== null) return;
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    const element = cardElements.get(id);
    if (!element) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    dragId = id;
    draggedElement = element;
    draft = ops.beginAnnouncementReorder(announcements.map((announcement) => announcement.id), id);
    pointerX = event.clientX;
    pointerY = event.clientY;
    grabOffsetX = event.clientX - rect.left;
    grabOffsetY = event.clientY - rect.top;
    followPointer(pointerX, pointerY);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function removePointerListeners(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
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
    const { draft: finalized, op } = ops.finalizeAnnouncementReorder(activeDraft);
    draft = finalized;
    if (!op || !Array.isArray(op.payload)) {
      draft = null;
      return;
    }
    const ids = [...op.payload] as number[];
    if (ids.some((id) => id < 0)) {
      onInvalidReorder();
      await tick();
      draft = null;
      return;
    }
    void onReorder(ids).finally(async () => {
      await tick();
      draft = null;
    });
  }

  function onPointerUp(event: PointerEvent): void {
    if (dragId === null) return;
    event.preventDefault();
    removePointerListeners();
    const activeDraft = draft;
    dragId = null;
    settleDraggedCard();
    if (activeDraft) void commitDraft(activeDraft);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (dragId === null) return;
    event.preventDefault();
    removePointerListeners();
    const first = captureRects();
    dragId = null;
    draft = null;
    draggedElement?.style.setProperty('transform', '');
    draggedElement = null;
    void tick().then(() => flipDisplaced(first));
  }

  async function nudge(id: number, offset: number): Promise<void> {
    const ids = announcements.map((announcement) => announcement.id);
    const from = ids.indexOf(id);
    const targetId = ids[from + offset];
    if (from < 0 || targetId === undefined) return;
    let next = ops.beginAnnouncementReorder(ids, id);
    next = ops.moveAnnouncementReorder(next, targetId);
    const { op } = ops.finalizeAnnouncementReorder(next);
    if (!op || !Array.isArray(op.payload)) return;
    const orderedIds = [...op.payload] as number[];
    if (orderedIds.some((orderedId) => orderedId < 0)) {
      onInvalidReorder();
      return;
    }
    draft = next;
    void onReorder(orderedIds);
    await tick();
    draft = null;
  }
</script>

<div class="space-y-4" role="list">
  {#if announcements.length === 0}
    <EmptyState icon={Megaphone} text="暂无公告。" />
  {:else}
    {#each visibleAnnouncements as announcement (announcement.id)}
      {@const absoluteTime = formatAbsoluteTime(announcement.updatedAt)}
      {@const counts = reactionCounts(announcement, -1)}
      <div
        use:card={announcement.id}
        data-announcement-id={announcement.id}
        id={dragId === announcement.id ? 'dragged-announcement' : undefined}
        role="listitem"
        class="rounded-xl border border-border bg-card p-4 {dragId === announcement.id
          ? 'pointer-events-none relative z-10 opacity-50'
          : ''}"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <button
              type="button"
              aria-label="拖动排序：{announcement.title}"
              class="mt-0.5 shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
              onpointerdown={(event) => onPointerDown(event, announcement.id)}
              onkeydown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                void nudge(announcement.id, event.key === 'ArrowUp' ? -1 : 1);
              }}
            >
              <GripVertical class="size-4" />
            </button>
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{announcement.title}</h3>
              <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {announcement.contentMd}
              </p>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
                <span>排序: {announcement.sort}</span>
                <span>·</span>
                <Tooltip text={absoluteTime} side="top">
                  <span class="rounded-sm">
                    {formatRelativeTime(announcement.updatedAt, timeReference)}
                  </span>
                </Tooltip>
                {#if pendingIds.has(announcement.id)}
                  <span class="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                    同步中
                  </span>
                {/if}
                {#each counts as count (count.emoji)}
                  <span class="rounded-full border border-border px-2 py-0.5">
                    {count.emoji} {count.count}
                  </span>
                {/each}
              </div>
            </div>
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
      </div>
    {/each}
  {/if}
</div>
