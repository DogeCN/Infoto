<script lang="ts">
  import { Download, Upload } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { copy, fmt } from '$shared/copy';
  import Progress from '$lib/components/Progress.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { migrateSql } from '../../core/api/migrateClient';

  interface Props {
    onImported: () => Promise<{ ok: boolean; message: string }>;
  }

  let { onImported }: Props = $props();
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  // Pick-to-import leaves no confirm step, so the progress row below the buttons
  // is the ONLY feedback an import gives — without it a slow or hung upload looks
  // exactly like a dead button (the import button stays disabled throughout).
  let progress = $state(0);
  let importName = $state('');

  function setError(nextMessage: string): void {
    toast.error(copy.migrate.importFailed, { description: nextMessage });
  }

  /** Picking a file starts the import immediately — no confirm dialog. */
  async function importSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (importing || !file) return;
    importing = true;
    importName = file.name;
    progress = 0;
    try {
      const result = await migrateSql(file, { onProgress: (fraction) => (progress = fraction) });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const completion = await onImported();
      if (completion.ok) {
        toast.success(copy.migrate.importComplete, { description: completion.message });
      } else {
        setError(completion.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : copy.migrate.importRetry);
    } finally {
      importing = false;
    }
  }

  async function exportSql(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      const response = await fetch('/admin/migrate', { credentials: 'include' });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim();
        throw new Error(
          detail
            ? fmt(copy.migrate.httpErrorWithDetail, {
                status: response.status,
                detail: detail.slice(0, 180),
              })
            : fmt(copy.migrate.httpError, { status: response.status }),
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `infoto-export-${Date.now()}.sql`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(copy.migrate.exportComplete);
    } catch (error) {
      toast.error(copy.migrate.exportFailed, {
        description: error instanceof Error ? error.message : copy.migrate.tryAgainLater,
      });
    } finally {
      exporting = false;
    }
  }
</script>

<div class="relative flex items-center gap-1">
  <Tooltip text={exporting ? copy.migrate.exporting : copy.migrate.exportSql}>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
      aria-label={copy.migrate.exportSql}
      disabled={exporting}
      onclick={exportSql}
    >
      <Download class="size-5" />
    </button>
  </Tooltip>

  <Tooltip text={importing ? copy.migrate.importing : copy.migrate.importSql}>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
      aria-label={copy.migrate.importSql}
      disabled={importing}
      onclick={() => fileInput?.click()}
    >
      <Upload class="size-5" />
    </button>
  </Tooltip>
  <input bind:this={fileInput} type="file" accept=".sql" class="hidden" onchange={importSelected} />

  {#if importing}
    <div
      class="absolute top-full right-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span class="truncate text-muted-foreground">
          {fmt(copy.migrate.importingFile, { importName })}
        </span>
        <span class="shrink-0 tabular-nums">{Math.round(progress * 100)}%</span>
      </div>
      <Progress value={progress} label={copy.migrate.progressLabel} />
    </div>
  {/if}
</div>
