<script lang="ts">
  // Modal dialog with an optional fullscreen mode (used by the announcement editor). The overlay
  // closes on click; Tab cycles inside the panel and Escape closes it. Body scrolling is locked
  // while open and focus returns to the previously focused element on close.
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Tooltip from './Tooltip.svelte';

  interface Props {
    open: boolean;
    title?: string;
    fullscreen?: boolean;
    onClose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let { open, title = '', fullscreen = false, onClose, children, footer }: Props = $props();

  let panelEl = $state<HTMLElement | undefined>(undefined);
  let previouslyFocused: HTMLElement | null = null;

  const ENTER_MS = 280;
  const EXIT_MS = 160;

  function close(): void {
    onClose?.();
  }

  function focusable(): HTMLElement[] {
    if (!panelEl) return [];
    return Array.from(
      panelEl.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      previouslyFocused?.focus?.();
    };
  });

  // Portal the overlay to <body>: a transformed or overflow:auto ancestor must
  // not clip a fixed layer or break its stacking context.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    use:portal
    class="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
    role="presentation"
    transition:fade={{ duration: EXIT_MS }}
    onclick={close}
  >
    {#snippet panelInner()}
      <header class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 class="m-0 text-sm font-medium">{title}</h2>
        <Tooltip text="关闭" side="bottom">
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
            onclick={close}
          >
            <X class="size-4" />
          </button>
        </Tooltip>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {@render children()}
      </div>

      {#if footer}
        <footer class="shrink-0 border-t border-border px-4 py-3">
          {@render footer()}
        </footer>
      {/if}
    {/snippet}

    {#if fullscreen}
      <div
        bind:this={panelEl}
        role="dialog"
        tabindex={-1}
        aria-modal="true"
        aria-label={title}
        class="fixed inset-0 flex flex-col overflow-hidden bg-background"
        in:fly={{
          y: 16,
          duration: ENTER_MS,
          easing: cubicOut,
        }}
        out:fly={{ y: 16, duration: EXIT_MS, easing: cubicOut }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={onKeydown}
      >
        {@render panelInner()}
      </div>
    {:else}
      <div
        bind:this={panelEl}
        role="dialog"
        tabindex={-1}
        aria-modal="true"
        aria-label={title}
        class="fixed inset-6 flex flex-col overflow-hidden rounded-2xl bg-background md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2"
        in:scale={{
          duration: ENTER_MS,
          start: 0.97,
          easing: cubicOut,
        }}
        out:scale={{ duration: EXIT_MS, start: 0.97 }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={onKeydown}
      >
        {@render panelInner()}
      </div>
    {/if}
  </div>
{/if}
