<script lang="ts">
  import { EMOJI_SET } from '../../core/reactions';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    id: string;
    anchor?: HTMLButtonElement;
    onPick?: (emoji: string) => void;
  }

  let { id, anchor, onPick }: Props = $props();
  let picker: HTMLDivElement;

  /** Keep the top-layer picker anchored and inside the viewport while its sidebar moves. */
  function position(node: HTMLElement) {
    let frame = 0;
    function update() {
      if (!node.matches(':popover-open')) return;
      if (!anchor?.isConnected || anchor.closest('[inert]')) {
        node.hidePopover();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const x = Math.max(left + 8, Math.min(rect.left, right - width - 8));
      const preferredY = rect.top - height - 8 >= top + 8 ? rect.top - height - 8 : rect.bottom + 8;
      const y = Math.max(top + 8, Math.min(preferredY, bottom - height - 8));
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.visibility = 'visible';
      frame = requestAnimationFrame(update);
    }
    function beforeToggle(event: Event) {
      cancelAnimationFrame(frame);
      if ((event as ToggleEvent).newState === 'open') {
        node.style.visibility = 'hidden';
        frame = requestAnimationFrame(() => {
          update();
          node.querySelector('button')?.focus({ preventScroll: true });
        });
      }
    }
    node.addEventListener('beforetoggle', beforeToggle);
    return {
      destroy() {
        cancelAnimationFrame(frame);
        node.removeEventListener('beforetoggle', beforeToggle);
      },
    };
  }
</script>

<div
  {id}
  bind:this={picker}
  popover="auto"
  role="dialog"
  aria-label={copy.reactions.add}
  use:position
  class="fixed m-0 w-[168px] rounded-lg border border-border bg-popover p-1 text-foreground shadow-md"
>
  <div class="grid grid-cols-4 gap-1">
    {#each EMOJI_SET as emoji (emoji)}
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-md text-base transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-foreground/10 focus-visible:bg-foreground/10"
        onclick={() => {
          onPick?.(emoji);
          picker.hidePopover();
        }}
      >
        {emoji}
      </button>
    {/each}
  </div>
</div>
