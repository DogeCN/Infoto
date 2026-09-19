<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X, GripHorizontal } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  interface Props {
    open: boolean;
    onClose?: () => void;
    title?: string;
    class?: string;
    children: Snippet;
  }

  let {
    open = $bindable(false),
    onClose,
    title,
    class: className = '',
    children,
  }: Props = $props();

  let startY = $state(0);
  let currentY = $state(0);
  let isDragging = $state(false);

  function handlePointerDown(e: PointerEvent) {
    startY = e.clientY;
    currentY = e.clientY;
    isDragging = true;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    currentY = e.clientY;
  }

  function handlePointerUp() {
    if (!isDragging) return;
    isDragging = false;
    const delta = currentY - startY;
    if (delta > 100) {
      onClose?.();
    }
    startY = 0;
    currentY = 0;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose?.();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class={cn(
      'fixed inset-0 z-70 flex items-end justify-center bg-black/92 backdrop-blur-[8px] transition-opacity duration-280',
      open ? 'opacity-100 visibility-visible pointer-events-auto' : 'opacity-0 visibility-hidden pointer-events-none',
      className
    )}
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <!-- Panel -->
    <div
      class="relative w-full max-w-[min(28rem,calc(100vw-2rem))] rounded-t-2xl bg-popover border border-border shadow-2xl"
      style="transform: translateY({isDragging ? `${Math.max(0, currentY - startY)}px` : '0'}); transition: {isDragging ? 'none' : 'transform 0.3s cubic-bezier(.16,1,.3,1)'}"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      role="document"
    >
      <!-- Drag handle -->
      <div class="flex justify-center py-3 cursor-grab active:cursor-grabbing">
        <GripHorizontal class="size-5 text-muted-foreground" />
      </div>

      <!-- Header -->
      {#if title}
        <div class="px-6 pb-4">
          <h2 class="text-lg font-semibold">{title}</h2>
        </div>
      {/if}

      <!-- Content -->
      <div class="px-6 pb-6">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
