<script lang="ts">
  // Tri-state icon toggle: off -> only (primary cyan) -> exclude (amber) -> off.
  import type { Component } from 'svelte';
  import { cn } from '$lib/utils';
  import Tooltip from './Tooltip.svelte';
  import type { TriState } from '../../settings';

  interface Props {
    label: string;
    icon: Component;
    state?: TriState;
    onCycle?: () => void;
  }

  let { label, icon: Icon, state = 'off', onCycle }: Props = $props();

  const STATE_CLASS: Record<TriState, string> = {
    off: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    only: 'bg-primary text-primary-foreground',
    exclude: 'bg-[#f59e0b] text-white',
  };
</script>

<Tooltip text={label} side="bottom">
  <button
    type="button"
    class={cn(
      'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all duration-200 active:scale-95',
      STATE_CLASS[state],
    )}
    aria-pressed={state !== 'off'}
    onclick={onCycle}
  >
    <Icon class="size-3.5" />
    <span class="truncate">{label}</span>
  </button>
</Tooltip>
