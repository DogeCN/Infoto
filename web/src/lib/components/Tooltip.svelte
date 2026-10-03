<script lang="ts">
  // Accessible tooltip for a single trigger element. Visible on hover and keyboard focus.
  // Portaled above <body> so overflow clipping and transformed ancestors can't trap it; placement flips to the opposite side near a viewport edge.
  // Touch deliberately gets no tooltip (user call): the long-press copy blocked the view
  // on phones, and the labelled control itself is the touch affordance.
  import { onDestroy, type Snippet } from 'svelte';
  import { portal } from '$base/lib/portal';

  type Side = 'top' | 'bottom' | 'left' | 'right';

  interface Props {
    text?: string | null;
    side?: Side;
    children: Snippet;
  }

  let { text = '', side = 'top', children }: Props = $props();

  const tooltipId = $props.id();
  let wrapper = $state<HTMLSpanElement | undefined>(undefined);
  let tipEl = $state<HTMLDivElement | undefined>(undefined);
  let open = $state(false);
  let x = $state(0);
  let y = $state(0);
  let placedSide = $state<Side>('top');

  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  });

  const SHOW_DELAY_MS = 350;
  const HIDE_DELAY_MS = 80;
  const GAP_PX = 6;

  const OPPOSITE: Record<Side, Side> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const TIP_TRANSLATE: Record<Side, string> = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-y-1/2 -translate-x-full',
    right: '-translate-y-1/2',
  };

  function triggerEl(): Element | undefined {
    return wrapper?.firstElementChild ?? undefined;
  }

  function position(): void {
    const t = triggerEl();
    if (!t) return;
    const r = t.getBoundingClientRect();
    const w = tipEl?.offsetWidth ?? 80;
    const h = tipEl?.offsetHeight ?? 24;
    // Flip to the opposite side when the preferred side leaves no room.
    const noRoom =
      (side === 'top' && r.top - h - GAP_PX < 0) ||
      (side === 'bottom' && r.bottom + h + GAP_PX > window.innerHeight) ||
      (side === 'left' && r.left - w - GAP_PX < 0) ||
      (side === 'right' && r.right + w + GAP_PX > window.innerWidth);
    const ps = noRoom ? OPPOSITE[side] : side;
    placedSide = ps;
    const nextX =
      ps === 'left' || ps === 'right'
        ? ps === 'left'
          ? r.left - GAP_PX
          : r.right + GAP_PX
        : r.left + r.width / 2;
    const nextY =
      ps === 'top' || ps === 'bottom'
        ? ps === 'top'
          ? r.top - GAP_PX
          : r.bottom + GAP_PX
        : r.top + r.height / 2;
    x =
      ps === 'top' || ps === 'bottom'
        ? Math.max(w / 2 + 8, Math.min(window.innerWidth - w / 2 - 8, nextX))
        : nextX;
    y =
      ps === 'left' || ps === 'right'
        ? Math.max(h / 2 + 8, Math.min(window.innerHeight - h / 2 - 8, nextY))
        : nextY;
  }

  function show(immediate = false): void {
    if (!text) return;
    if (hideTimer) clearTimeout(hideTimer);
    if (showTimer) clearTimeout(showTimer);
    if (immediate) {
      position();
      open = true;
    } else {
      showTimer = setTimeout(() => {
        position();
        open = true;
      }, SHOW_DELAY_MS);
    }
  }

  function hide(): void {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (open = false), HIDE_DELAY_MS);
  }

  function onPointerOver(): void {
    if (window.matchMedia('(hover: none)').matches) return;
    show();
  }
  function onPointerOut(): void {
    hide();
  }
  function onFocusIn(): void {
    show(true);
  }
  function onFocusOut(): void {
    hide();
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') open = false;
  }

  $effect(() => {
    const trigger = triggerEl();
    if (!open || !trigger) return;
    const previous = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', [previous, tooltipId].filter(Boolean).join(' '));
    return () => {
      if (previous) trigger.setAttribute('aria-describedby', previous);
      else trigger.removeAttribute('aria-describedby');
    };
  });

  // Follow the trigger while open (scroll, resize, sidebar drag).
  $effect(() => {
    if (!open) return;
    position();
    const ro = new ResizeObserver(() => position());
    const t = triggerEl();
    if (t) ro.observe(t);
    if (tipEl) ro.observe(tipEl);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  });
</script>

<span
  bind:this={wrapper}
  role="none"
  style="display: contents"
  onpointerover={onPointerOver}
  onpointerout={onPointerOut}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
  onkeydown={onKeyDown}
>
  {@render children()}
</span>

{#if open}
  <div
    use:portal
    bind:this={tipEl}
    role="tooltip"
    id={tooltipId}
    class="pointer-events-none fixed z-[100] w-max max-w-[calc(100vw-1rem)] break-words text-center rounded-md bg-surface-top px-2 py-1 text-[11px] font-medium text-foreground shadow-md {TIP_TRANSLATE[
      placedSide
    ]}"
    style:left={`${x}px`}
    style:top={`${y}px`}
  >
    {text}
  </div>
{/if}
