<script lang="ts">
  import { Download, Upload } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import Progress from '$lib/components/Progress.svelte';
  import TooltipIconButton from '$lib/components/TooltipIconButton.svelte';
  import { portal } from '$base/lib/portal';
  import { migrateSql } from '../../core/api/migrateClient';

  interface Props {
    onImported: () => Promise<{ ok: boolean; message: string }>;
  }

  let { onImported }: Props = $props();
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  // Display measured import progress and disable repeated imports while a request is active.
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
  <TooltipIconButton
    text={exporting ? copy.migrate.exporting : copy.migrate.exportSql}
    class="p-2"
    disabled={exporting}
    onclick={exportSql}
  >
    <Download class="size-5" />
  </TooltipIconButton>

  <TooltipIconButton
    text={importing ? copy.migrate.importing : copy.migrate.importSql}
    class="p-2"
    disabled={importing}
    onclick={() => fileInput?.click()}
  >
    <Upload class="size-5" />
  </TooltipIconButton>
  <input bind:this={fileInput} type="file" accept=".sql" class="hidden" onchange={importSelected} />

  {#if importing}
    <!-- Portaled and pinned under the bar: the header clips overflow and its backdrop
         filter would capture a fixed child, so this panel cannot live inside it. -->
    <div
      use:portal
      class="fixed top-[calc(var(--bar-h,3.5rem)+8px)] right-4 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 shadow-lg"
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
