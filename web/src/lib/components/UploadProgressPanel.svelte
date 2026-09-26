<script lang="ts">
  // Progress panel: one visual, two task kinds. kind='transcode' (default): the home waterfall
  // view of the image-host pipeline, hiding uploading/done/failed rows (the card curtain carries
  // that progress); kind='upload': editor upload, showing every stage since the editor has no curtain.
  import { Clapperboard, ImageUp, Check, LoaderCircle, X } from '@lucide/svelte';
  import { copy, fmt } from '$shared/copy';

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
    /** Cancel a queued job (album panel only; the SW broadcasts jobRemoved on success). */
    onCancelTask?: (jobId: string) => void;
  }

  let { tasks, kind = 'transcode', onCancelTask }: Props = $props();

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

  /** Stage label used when no progress fraction is available. */
  function phaseLabel(phase: string): string {
    switch (phase) {
      case 'queued':
      case 'lease-wait':
        return copy.uploadPanel.queued;
      case 'transcoding':
        return copy.uploadPanel.transcoding;
      case 'hashing':
        return copy.uploadPanel.hashing;
      case 'uploading':
        return copy.uploadPanel.uploading;
      default:
        return kind === 'upload' ? copy.uploadPanel.uploading : copy.uploadPanel.transcoding;
    }
  }
</script>

{#if taskList.length > 0}
  <div
    class="rounded-xl border border-border bg-card/95 p-4 shadow-lg shadow-black/30 backdrop-blur-xl"
    role="status"
    aria-live="polite"
    aria-busy={taskList.some((t) => t.phase !== 'duplicate')}
  >
    <div class="mb-2.5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        {#if kind === 'upload'}
          <ImageUp class="size-4 text-muted-foreground" />
          <span class="text-sm font-medium">{copy.uploadPanel.uploadTitle}</span>
        {:else}
          <Clapperboard class="size-4 text-muted-foreground" />
          <span class="text-sm font-medium">{copy.uploadPanel.transcodeTitle}</span>
        {/if}
      </div>
    </div>

    <!-- Row list is capped: picking a few dozen files must not push the panel
         past the viewport (it is pinned to a corner with no scrolling of its own). -->
    <div class="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
      {#each taskList as task (task.jobId)}
        {@const done = task.phase === 'duplicate'}
        {@const cancellable =
          !!onCancelTask && (task.phase === 'queued' || task.phase === 'lease-wait')}
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
              {done ? copy.uploadPanel.duplicate : pct != null ? `${pct}%` : phaseLabel(task.phase)}
            </span>
            {#if cancellable}
              <button
                type="button"
                class="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                title={copy.uploadPanel.cancel}
                aria-label={fmt(copy.uploadPanel.cancelFile, { fileName: task.fileName })}
                onclick={() => onCancelTask?.(task.jobId)}
              >
                <X class="size-3" />
              </button>
            {/if}
          </div>
          {#if pct != null}
            <div
              class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted-foreground/15"
              role="progressbar"
              aria-label={fmt(copy.uploadPanel.fileProgress, { fileName: task.fileName })}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={pct}
            >
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
