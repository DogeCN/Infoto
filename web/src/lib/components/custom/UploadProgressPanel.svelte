<script lang="ts">
  // 转码进度面板：只负责阶段一（排队/转码/哈希）与哈希去重。
  // 上传阶段不在面板呈现——转码完成的条目以乐观条目插入瀑布流，
  // 由卡片上的"窗帘"遮罩表达上传进度（契约「上传期间的瀑布流呈现」）。
  // 重复（sha256 命中）也算完成项。
  import type { PipelineTaskSnapshot } from '../../../transcode/pipeline';
  import { Clapperboard, Check, LoaderCircle } from '@lucide/svelte';

  interface Props {
    tasks: Map<string, PipelineTaskSnapshot>;
  }

  let { tasks }: Props = $props();

  /** 转码相关阶段：面板的展示范围（uploading/done/failed 交给瀑布流卡片）。 */
  const STAGES = new Set(['queued', 'lease-wait', 'transcoding', 'hashing', 'duplicate']);
  let taskList = $derived(Array.from(tasks.values()).filter((t) => STAGES.has(t.phase)));

  let completedCount = $derived(
    taskList.filter((t) => t.phase === 'duplicate').length,
  );

  /** 阶段中文名（进度未知时的兜底文案）。 */
  function phaseLabel(phase: string): string {
    switch (phase) {
      case 'queued':
      case 'lease-wait':
        return '排队中';
      case 'hashing':
        return '校验中';
      default:
        return '转码中';
    }
  }
</script>

{#if taskList.length > 0}
  <div class="rounded-xl border border-border bg-card/95 p-4 shadow-lg shadow-black/30 backdrop-blur-xl">
    <div class="mb-2.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Clapperboard class="size-4 text-muted-foreground" />
        <span class="text-sm font-medium">转码进度</span>
      </div>
      <span class="text-xs tabular-nums text-muted-foreground">
        {completedCount}/{taskList.length}
      </span>
    </div>

    <div class="space-y-1">
      {#each taskList as task (task.jobId)}
        {@const done = task.phase === 'duplicate'}
        {@const pct =
          !done && task.fraction != null && task.fraction > 0
            ? Math.round(task.fraction * 100)
            : null}
        <div class="rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted/50">
          <div class="flex items-center gap-2">
            {#if done}
              <Check class="size-3.5 shrink-0 text-success" />
            {:else}
              <LoaderCircle class="size-3.5 shrink-0 animate-spin text-primary" />
            {/if}
            <span class="flex-1 truncate {done ? 'text-muted-foreground' : 'text-foreground/85'}">
              {task.fileName}
            </span>
            <span class="shrink-0 text-[10px] tabular-nums {done ? 'text-success' : 'text-muted-foreground/70'}">
              {done ? '重复' : pct != null ? `${pct}%` : phaseLabel(task.phase)}
            </span>
          </div>
          {#if pct != null}
            <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted-foreground/15">
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
                style="width: {pct}%"
              ></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
