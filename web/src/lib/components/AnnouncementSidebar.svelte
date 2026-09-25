<script lang="ts">
  import type { Announcement } from '$shared/types';
  import { ChevronDown, ChevronsUpDown, Eye, Pencil } from '@lucide/svelte';
  import { parseVote } from '../../core/vote';
  import MarkdownView from './MarkdownView.svelte';
  import VoteBlock from './VoteBlock.svelte';
  import ReactionBar from './ReactionBar.svelte';

  interface Props {
    announcements: Announcement[];
    selfId?: number;
    onReact?: (annId: number, emoji: string | null) => void;
    onVote?: (annId: number, option: number | null) => void;
    onFeedback?: (contentMd: string) => void;
  }

  let { announcements, selfId = -1, onReact, onVote, onFeedback }: Props = $props();

  let feedbackText = $state('');
  let previewMode = $state(false);
  // 输入框高度（右上角手柄拖拽调整：向上拖增高）
  let taH = $state(190);
  /** 已展开的公告 id（默认空 = 全部收起，避免一屏全被长公告占满）。 */
  let expandedIds = $state<Set<number>>(new Set());

  function toggle(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = taH;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      taH = Math.min(480, Math.max(120, startH - (ev.clientY - startY)));
    };
    const onUp = () => {
      el.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleSend() {
    const text = feedbackText.trim();
    if (!text) return;
    onFeedback?.(text);
    feedbackText = '';
    previewMode = false;
  }
</script>

<div class="flex min-h-full flex-col gap-4">
  <!-- 公告列表：全部平铺，内容常显（无展开收起）；滚动由 OverlaySidebar 内容区承担 -->
  <div class="flex-1 space-y-4">
    {#if announcements.length === 0}
      <p class="py-8 text-center text-sm text-muted-foreground">暂无公告</p>
    {/if}

    {#each announcements as ann (ann.id)}
      {@const vote = parseVote(ann.contentMd)}
      {@const expanded = expandedIds.has(ann.id)}

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <!-- 标题行即开关：整行可点，右侧箭头指示展开态 -->
        <h3 class="m-0">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted/40"
            aria-expanded={expanded}
            onclick={() => toggle(ann.id)}
          >
            <span class="flex-1 text-sm font-medium leading-snug">{ann.title}</span>
            <ChevronDown
              class="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-exit)] ease-[var(--ease-exit)] {expanded
                ? ''
                : '-rotate-90'}"
            />
          </button>
        </h3>

        <!-- 收起/展开：grid-template-rows 0fr↔1fr 动画，内容保持挂载
             （MarkdownView 不重挂、投票与反应状态不丢）；min-h-0 是 0fr 能压扁的前提 -->
        <div
          class="grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
          style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
        >
          <div class="min-h-0 overflow-hidden">
            <div class="space-y-3 px-4 pb-4 pt-0.5">
              {#if vote.body.trim()}
                <MarkdownView content={vote.body} class="text-muted-foreground" />
              {/if}

              {#if vote.options.length >= 2}
                <VoteBlock
                  options={vote.options}
                  votes={ann.votes}
                  {selfId}
                  onVote={(option) => onVote?.(ann.id, option)}
                />
              {/if}

              <!-- 表情反应条 -->
              <ReactionBar
                announcement={ann}
                {selfId}
                onReact={(emoji) => onReact?.(ann.id, emoji)}
              />
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>

  <!-- 反馈输入区：贴侧边栏底部，公告滚动时悬浮于内容之上。
       背景与侧栏同色（card），避免比内容区亮出一圈形似"溢出"的观感。
       z-20：卡片内部可能出现带 z-index 的内层（投票条等），sticky 必须稳压它们 -->
  <div class="sticky bottom-0 z-20 mt-auto bg-card pb-4 pt-4">
    <!-- wrapper 负责圆角/边框/裁剪：textarea 的背景永远关在圆角内 -->
    <div
      class="relative overflow-hidden rounded-xl border border-input bg-muted transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] focus-within:border-primary/50"
    >
      {#if previewMode}
        <div class="min-h-[7.5rem] px-4 py-3" style="height: {taH}px">
          {#if feedbackText.trim()}
            <MarkdownView content={feedbackText} class="text-muted-foreground" />
          {:else}
            <p class="text-sm text-muted-foreground">暂无内容</p>
          {/if}
        </div>
      {:else}
        <textarea
          bind:value={feedbackText}
          style="height: {taH}px"
          placeholder="写下你的建议"
          class="block w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        ></textarea>
      {/if}

      <!-- 最右上角拖高把手：向上拖增高、向下拖收起 -->
      <div
        role="presentation"
        class="absolute right-1 top-1 flex h-5 w-5 cursor-ns-resize items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        title="拖动调整高度"
        onpointerdown={startResize}
      >
        <ChevronsUpDown class="size-3.5" />
      </div>

      <button
        type="button"
        class="absolute right-8 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-background hover:text-foreground"
        title={previewMode ? '编辑' : '预览'}
        onclick={() => (previewMode = !previewMode)}
      >
        {#if previewMode}
          <Pencil class="size-4" />
        {:else}
          <Eye class="size-4" />
        {/if}
      </button>

      {#if feedbackText.trim()}
        <button
          type="button"
          class="absolute bottom-3 right-3 inline-flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90"
          onclick={handleSend}
        >
          发送
        </button>
      {/if}
    </div>
  </div>
</div>
