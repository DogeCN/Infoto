<script lang="ts">
  // Lightweight popover (spec: "SQL 导入的 UI"). The content panel is portaled
  // to <body> and anchored to the trigger, so overflow/transform ancestors
  // cannot clip it. Closes on outside click or Escape. Only popovers/dialogs
  // may carry a shadow.
  import type { Snippet } from "svelte";
  import { scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  interface Props {
    open: boolean;
    /** Anchor element snippet. */
    trigger: Snippet;
    /** Popover body snippet. */
    children: Snippet;
    side?: "top" | "bottom";
    align?: "start" | "center" | "end";
    /** Width utility for the panel. */
    widthClass?: string;
  }

  let {
    open = $bindable(false),
    trigger,
    children,
    side = "bottom",
    align = "start",
    widthClass = "w-64",
  }: Props = $props();

  let anchor: HTMLElement | undefined = $state(undefined);
  let panel: HTMLElement | undefined = $state(undefined);
  let triggerButton: HTMLSpanElement | null = null;
  let x = $state(0);
  let y = $state(0);
  const contentId = `popover-content-${crypto.randomUUID().slice(0, 8)}`;

  const GAP = 8;
  // Asymmetric motion token: enter 280ms, exit 160ms.
  const ENTER_MS = 280;
  const EXIT_MS = 160;

  function place() {
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = r.left;
    if (align === "center") nx = r.left + r.width / 2 - w / 2;
    else if (align === "end") nx = r.right - w;
    nx = Math.max(GAP, Math.min(nx, vw - w - GAP));
    let ny = side === "bottom" ? r.bottom + GAP : r.top - h - GAP;
    ny = Math.max(GAP, Math.min(ny, vh - h - GAP));
    x = nx;
    y = ny;
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    if (open) void Promise.resolve().then(() => panel?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]')?.focus());
    else triggerButton?.focus();
  }

  function onTriggerClick(): void {
    setOpen(!open);
  }

  function onDocPointer(e: PointerEvent) {
    const t = e.target as Node;
    if (panel?.contains(t) || anchor?.contains(t)) return;
    setOpen(false);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  $effect(() => {
    if (!open) return;
    void Promise.resolve().then(place);
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<span bind:this={anchor} class="contents">
  <span
    bind:this={triggerButton}
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={contentId}
    onclick={onTriggerClick}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onTriggerClick();
      }
    }}
  >
    {@render trigger()}
  </span>
</span>

{#if open}
  <div
    use:portal
    bind:this={panel}
    id={contentId}
    role="dialog"
    tabindex="-1"
    class="fixed z-[80] {widthClass} rounded-xl border border-border bg-popover p-3 shadow-lg"
    style="left: {x}px; top: {y}px"
    in:scale={{ duration: ENTER_MS, start: 0.97, easing: cubicOut }}
    out:scale={{ duration: EXIT_MS, start: 0.97, easing: cubicOut }}
  >
    {@render children()}
  </div>
{/if}
