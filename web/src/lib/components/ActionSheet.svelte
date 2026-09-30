<script lang="ts">
  import { overlay } from '$base/lib/overlay';
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cn } from '$base/lib/ui';

  interface Props {
    open: boolean;
    onClose?: () => void;
    ariaLabel: string;
    class?: string;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    onClose,
    ariaLabel,
    class: className = '',
    children,
  }: Props = $props();

  let activeOverlay: ReturnType<typeof overlay> | undefined;
  function mountOverlay(node: HTMLElement) {
    const action = overlay(node, { onClose: close });
    activeOverlay = action;
    return {
      destroy() {
        action.destroy();
        if (activeOverlay === action) activeOverlay = undefined;
      },
    };
  }

  // Release focus before the outgoing transition pauses its subtree effects.
  $effect(() => {
    const enabled = open;
    activeOverlay?.update({ enabled, onClose: close });
  });

  function close() {
    open = false;
    onClose?.();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class={cn('fixed inset-0 z-70 bg-black/50 md:backdrop-blur-sm', className)}
    transition:fade={{ duration: 180 }}
    onclick={handleBackdropClick}
    tabindex="-1"
    use:mountOverlay
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel}
  >
    <!-- Panel: full-width flush to the bottom on mobile, bottom-centered floating on desktop -->
    <div
      class="absolute inset-x-0 bottom-0 md:inset-x-auto md:left-1/2 md:bottom-6 md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2 rounded-t-[1.5rem] md:rounded-[1.5rem] bg-popover pt-3 shadow-2xl"
      transition:fly={{ y: 120, duration: 300, opacity: 1 }}
      role="document"
    >
      <!-- Content -->
      <div class="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
