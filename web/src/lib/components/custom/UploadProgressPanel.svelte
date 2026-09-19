<script lang="ts">
  import type { PipelineTaskSnapshot } from '../../../transcode/pipeline';
  import { humanSize } from '$base/lib/format';
  import { Check, XCircle, AlertCircle, Loader2, Upload, Copy } from '@lucide/svelte';

  interface Props {
    tasks: Map<string, PipelineTaskSnapshot>;
    onRetry?: (jobId: string) => void;
    onDismiss?: (jobId: string) => void;
  }

  let { tasks, onRetry, onDismiss }: Props = $props();

  let taskList = $derived(Array.from(tasks.values()));
  let activeTasks = $derived(taskList.filter((t) => !['done', 'failed', 'duplicate'].includes(t.phase)));
  let doneTasks = $derived(taskList.filter((t) => t.phase === 'done'));
  let failedTasks = $derived(taskList.filter((t) => t.phase === 'failed'));
  let duplicateTasks = $derived(taskList.filter((t) => t.phase === 'duplicate'));

  let overallProgress = $derived.by(() => {
    if (taskList.length === 0) return 0;
    const total = taskList.length;
    const completed = doneTasks.length + failedTasks.length + duplicateTasks.length;
    return Math.round((completed / total) * 100);
  });

  function phaseLabel(phase: string): string {
    switch (phase) {
      case 'queued': return '排队中';
      case 'transcoding': return '转码中';
      case 'uploading': return '上传中';
      case 'done': return '完成';
      case 'failed': return '失败';
      case 'duplicate': return '重复';
      default: return phase;
    }
  }

  function phaseIcon(phase: string) {
    switch (phase) {
      case 'done': return Check;
      case 'failed': return XCircle;
      case 'duplicate': return Copy;
      default: return Loader2;
    }
  }
</script>

{#if taskList.length > 0}
  <div class="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Upload class="size-4 text-muted-foreground" />
        <span class="text-sm font-medium">上传进度</span>
      </div>
      <span class="text-xs text-muted-foreground">{doneTasks.length}/{taskList.length}</span>
    </div>

    <!-- Overall progress bar -->
    <div class="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div
        class="h-full bg-primary transition-all duration-300"
        style="width: {overallProgress}%"
      ></div>
    </div>

    <!-- Task list (show active + recent done/failed, max 8) -->
    <div class="space-y-1.5 max-h-48 overflow-y-auto">
      {#each taskList.slice(0, 8) as task (task.jobId)}
        {@const Icon = phaseIcon(task.phase)}
        <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/50">
          <Icon
            class="size-3.5 shrink-0 {task.phase === 'done' ? 'text-green-500' : task.phase === 'failed' ? 'text-destructive' : task.phase === 'duplicate' ? 'text-muted-foreground' : 'text-primary animate-spin'}"
          />
          <span class="flex-1 truncate text-muted-foreground">{task.fileName}</span>
          <span class="shrink-0 text-[10px] text-muted-foreground/70">
            {#if task.phase === 'transcoding' || task.phase === 'uploading'}
              {task.fraction != null ? `${Math.round(task.fraction * 100)}%` : phaseLabel(task.phase)}
            {:else}
              {phaseLabel(task.phase)}
            {/if}
          </span>
          {#if task.phase === 'failed'}
            <button
              type="button"
              class="shrink-0 text-[10px] text-primary hover:underline"
              onclick={() => onRetry?.(task.jobId)}
            >
              重试
            </button>
          {/if}
        </div>
      {/each}

      {#if taskList.length > 8}
        <div class="text-center text-[10px] text-muted-foreground/50 py-1">
          还有 {taskList.length - 8} 项...
        </div>
      {/if}
    </div>
  </div>
{/if}
