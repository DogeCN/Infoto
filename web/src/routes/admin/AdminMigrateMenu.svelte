<script lang="ts">
  import { Download, Upload } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import Popover from '$lib/components/custom/Popover.svelte';
  import Progress from '$lib/components/custom/Progress.svelte';
  import Tooltip from '$lib/components/custom/Tooltip.svelte';
  import { migrateSql } from '../../core/api/migrateClient';

  interface Props {
    onImported: () => Promise<{ ok: boolean; message: string }>;
  }

  let { onImported }: Props = $props();
  let importOpen = $state(false);
  let selectedFile = $state<File | null>(null);
  let importing = $state(false);
  let exporting = $state(false);
  let progress = $state(0);
  let status = $state<'idle' | 'uploading' | 'success' | 'error'>('idle');
  let message = $state('');

  function selectFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    selectedFile = file;
    progress = 0;
    status = 'idle';
    message = '';
  }

  function setError(nextMessage: string): void {
    status = 'error';
    message = nextMessage;
    toast.error('导入失败', { description: nextMessage });
  }

  async function importSelected(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (importing || !selectedFile) return;
    importing = true;
    status = 'uploading';
    message = '';
    progress = 0;

    try {
      const result = await migrateSql(selectedFile, {
        onProgress: (fraction) => (progress = fraction),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const completion = await onImported();
      if (completion.ok) {
        status = 'success';
        message = completion.message;
        toast.success('导入完成', { description: completion.message });
      } else {
        setError(completion.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入失败，请重试');
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
        throw new Error(detail ? `服务器返回 HTTP ${response.status}：${detail.slice(0, 180)}` : `服务器返回 HTTP ${response.status}`);
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
      toast.success('导出完成');
    } catch (error) {
      toast.error('导出失败', {
        description: error instanceof Error ? error.message : '请稍后重试',
      });
    } finally {
      exporting = false;
    }
  }
</script>

<div class="flex items-center gap-1">
  <Tooltip text={exporting ? '导出中' : '导出 SQL'}>
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
      aria-label="导出 SQL"
      disabled={exporting}
      onclick={exportSql}
    >
      <Download class="size-5" />
    </button>
  </Tooltip>

  <Popover bind:open={importOpen} widthClass="w-80">
    {#snippet trigger()}
      <button
        type="button"
        aria-label="导入 SQL"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <Upload class="size-5" />
      </button>
    {/snippet}
    <form class="w-72 max-w-[calc(100vw-2rem)] space-y-3" onsubmit={importSelected}>
      <div>
        <label for="sql-import-file" class="mb-1.5 block text-sm font-medium">SQL 文件</label>
        <input
          id="sql-import-file"
          type="file"
          accept=".sql"
          disabled={importing}
          class="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground"
          onchange={selectFile}
        />
      </div>
      {#if selectedFile}
        <Tooltip text={selectedFile.name}>
          <p class="truncate text-xs text-muted-foreground">已选择：{selectedFile.name}</p>
        </Tooltip>
      {/if}
      <p class="rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">导入前请先执行导出</p>
      {#if status === 'uploading'}
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>正在上传</span>
            <span class="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <Progress value={progress} label="SQL 导入进度" />
        </div>
      {:else if message}
        <p class="break-words text-xs {status === 'error' ? 'text-destructive' : 'text-success'}" aria-live="polite">
          {message}
        </p>
      {/if}
      <button
        type="submit"
        disabled={!selectedFile || importing}
        class="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {importing ? '导入中' : '开始导入'}
      </button>
    </form>
  </Popover>
</div>
