<script lang="ts">
  // Progress panel: one visual, two task kinds. kind='transcode' (default): the home waterfall
  // view of the image-host pipeline, hiding uploading/done/failed rows — the waterfall card
  // curtain carries that progress (contract). kind='upload': editor image upload on the same SharedWorker pipeline (queue → transcode → hash → upload), showing every stage since the editor has no card curtain.
  import { Clapperboard, ImageUp, Check, LoaderCircle } from '@lucide/svelte';

  /** Structured task shape shared by pipeline snapshots and synthetic editor tasks. */
  export interface PanelTask {
    jobId: string;
    fileName: string;
    phase: string;
    fraction?: number | null;
  }

  interface Props {
    tasks: Map<string, PanelTask>;
    /** 'transcode' (default, image-host progress) or 'upload' (editor image upload). */
    kind?: 'transcode' | 'upload';
  }

  let { tasks, kind = 'transcode' }: Props = $props();

  const TRANSCODE_STAGES = new Set(['queued', 'lease-wait', 'transcoding', 'hashing', 'duplicate']);
  // Editor uploads show the whole leg, transcode included.
  const UPLOAD_STAGES = new Set([
    'queued',
    'lease-wait',
    'transcoding',
    'hashing',
    'uploading',
    'duplicate',
  ]);
  let stages = $derived(kind === 'upload' ? UPLOAD_STAGES : TRANSCODE_STAGES);
  let taskList = $derived(Array.from(tasks.values()).filter((t) => stages.has(t.phase)));

  let completedCount = $derived(taskList.filter((t) => t.phase === 'duplicate').length);

  /** Stage label used when no progress fraction is available. */
  function phaseLabel(phase: string): string {
    switch (phase) {
      case 'queued':
      case 'lease-wait':
        return '排队中';
      case 'transcoding':
        return '转码中';
      case 'hashing':
        return '校验中';
      case 'uploading':
        return '上传中';
      default:
        return kind === 'upload' ? '上传中' : '转码中';
    }
  }
</script>

{#if taskList.length > 0}
  <div
    class="rounded-xl border border-border bg-card/95 p-4 shadow-lg shadow-black/30 backdrop-blur-xl"
  >
    <div class="mb-2.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        {#if kind === 'upload'}
          <ImageUp class="size-4 text-muted-foreground" />
          <span class="text-sm font-medium">上传进度</span>
        {:else}
          <Clapperboard class="size-4 text-muted-foreground" />
          <span class="text-sm font-medium">转码进度</span>
        {/if}
      </div>
      {#if kind === 'transcode'}
        <span class="text-xs tabular-nums text-muted-foreground">
          {completedCount}/{taskList.length}
        </span>
      {/if}
    </div>

    <div class="space-y-1">
      {#each taskList as task (task.jobId)}
        {@const done = task.phase === 'duplicate'}
        {@const pct =
          !done && task.fraction != null && task.fraction > 0
            ? Math.round(task.fraction * 100)
            : null}
        <div
          class="rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted/50"
        >
          <div class="flex items-center gap-2">
            {#if done}
              <Check class="size-3.5 shrink-0 text-success" />
            {:else}
              <LoaderCircle class="size-3.5 shrink-0 animate-spin text-primary" />
            {/if}
            <span class="flex-1 truncate {done ? 'text-muted-foreground' : 'text-foreground/85'}">
              {task.fileName}
            </span>
            <span
              class="shrink-0 text-[10px] tabular-nums {done
                ? 'text-success'
                : 'text-muted-foreground/70'}"
            >
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
