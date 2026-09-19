<script lang="ts">
  // 公告表情反应条（spec: "自定义组件清单" / "公告侧边栏"）——GitHub 风格计数按钮组
  // + 添加反应按钮。无任何回应时仅显示「添加反应」。
  import { SmilePlus } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { reactionCounts } from '../../../core/reactions';
  import type { Announcement } from '$shared/types';
  import ReactionPicker from './ReactionPicker.svelte';

  interface Props {
    announcement: Announcement;
    selfId?: number;
    onReact?: (emoji: string | null) => void;
  }

  let { announcement, selfId = -1, onReact }: Props = $props();

  let counts = $derived(reactionCounts(announcement, selfId));
  let pickerOpen = $state(false);

  function toggle(emoji: string, selfReacted: boolean) {
    // 已回应 → 再点取消（payload emoji 为空即清除）
    onReact?.(selfReacted ? null : emoji);
    pickerOpen = false;
  }
</script>

<div class="relative flex flex-wrap items-center gap-1.5">
  {#each counts as { emoji, count, selfReacted } (emoji)}
    <button
      type="button"
      class={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        selfReacted
          ? 'border-primary text-primary'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
      onclick={() => toggle(emoji, selfReacted)}
    >
      <span>{emoji}</span>
      <span>{count}</span>
    </button>
  {/each}

  <button
    type="button"
    class="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    title="添加反应"
    onclick={() => (pickerOpen = !pickerOpen)}
  >
    <SmilePlus class="size-4" />
  </button>

  {#if pickerOpen}
    <div class="absolute bottom-9 left-0 z-50">
      <ReactionPicker onPick={(emoji) => toggle(emoji, false)} />
    </div>
  {/if}
</div>
