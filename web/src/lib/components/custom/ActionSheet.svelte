<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cn } from '$lib/utils';

  interface Props {
    open: boolean;
    onClose?: () => void;
    title?: string;
    class?: string;
    children: Snippet;
  }

  let { open = $bindable(false), onClose, title, class: className = '', children }: Props = $props();

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
    class={cn('fixed inset-0 z-70 bg-black/50 md:backdrop-blur-sm', className)}
    transition:fade={{ duration: 180 }}
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <!-- Panel：移动端贴底全宽，桌面端底部居中悬浮（v1 语言）。
         拖动下拉关闭已砍掉：与面板内的按钮/滚动争抢指针事件，得不偿失。 -->
    <div
      class="absolute inset-x-0 bottom-0 md:inset-x-auto md:left-1/2 md:bottom-6 md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2 rounded-t-[1.5rem] md:rounded-[1.5rem] bg-popover pt-2 shadow-2xl"
      transition:fly={{ y: 120, duration: 300, opacity: 1 }}
      role="document"
    >
      <!-- Header -->
      {#if title}
        <div class="px-6 pt-3 pb-3">
          <h2 class="text-lg font-semibold">{title}</h2>
        </div>
      {/if}

      <!-- Content -->
      <div class="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
