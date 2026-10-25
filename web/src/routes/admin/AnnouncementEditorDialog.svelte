<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import EditorDialog from '$lib/components/EditorDialog.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import type { Poll } from '$shared/types';
  import { probeSourceSize, type UploadRow } from '../../transcode/pipeline';
  import { isImageFile } from '../../core/markdown';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    announcement: {
      id: number;
      title: string;
      contentMd: string;
      updatedAt: number;
    } | null;
    /** In-memory draft to seed the fields with; wins over `announcement`. */
    draft?: { title: string; contentMd: string } | null;
    polls?: Poll[];
    selfId?: number;
    onPickFile: (file: File) => Promise<string>;
    onSave: (title: string, contentMd: string) => void;
    onCancel: () => void;
    /** Live snapshot of the in-flight editor upload. */
    uploadTask?: UploadRow | null;
    /** Abort the in-flight editor upload (the editor stays open). */
    onCancelUpload?: () => void;
    /** Retry a failed editor upload; returns the hosted URL. */
    onRetryUpload?: (jobId: string) => Promise<string>;
  }

  let {
    announcement,
    draft = null,
    polls = [],
    selfId = -1,
    onPickFile,
    onSave,
    onCancel,
    uploadTask = null,
    onCancelUpload,
    onRetryUpload,
  }: Props = $props();
  let title = $state(untrack(() => draft?.title ?? announcement?.title ?? ''));
  let contentMd = $state(untrack(() => draft?.contentMd ?? announcement?.contentMd ?? ''));
  let fileInput: HTMLInputElement | undefined = $state(undefined);
  let uploadBusy = $state(false);
  /** Object URL for the picked file, so the live preview can show the real image (and its
   *  real box) while the upload is still running. The editor leg uploads the picked file
   *  as-is, so these bytes are the bytes the hosted URL will serve — this is the editor's
   *  equivalent of the card's OPFS preview, and it needs no upload to exist first. */
  let previewUrl = $state<string | null>(null);
  /** Measured source dimensions, so the preview reserves the true box instead of the 16:10 guess. */
  let previewSize = $state<{ width: number; height: number } | null>(null);
  // Track the in-flight editor job id so we can cancel it if the dialog closes
  // mid-upload (otherwise the artifact is uploaded and immediately discarded).
  let currentJobId: string | null = null;
  let finishPicker: (() => void) | undefined;
  let destroyed = false;
  $effect(() => {
    if (uploadTask) currentJobId = uploadTask.jobId;
  });

  /** Drop the local preview and release its blob URL. Clearing the state alone leaves the
   *  object URL alive until the document unloads, and a teardown-only cleanup would only
   *  release the URL current at unmount — every finished upload would leak one. */
  function clearPreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewSize = null;
  }

  onDestroy(() => {
    destroyed = true;
    clearPreview();
    finishPicker?.();
    if (currentJobId) onCancelUpload?.();
  });
  const canSave = $derived(title.trim().length > 0 && contentMd.trim().length > 0 && !uploadBusy);

  /** Live draft snapshot, captured by the tab switch so the editor can be parked unmounted. */
  export function getDraft(): { title: string; contentMd: string } {
    return { title, contentMd };
  }

  async function pickFile() {
    const input = fileInput;
    if (!input) return null;
    await new Promise<void>((resolve) => {
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (grace !== undefined) clearTimeout(grace);
        input.removeEventListener('change', finish);
        input.removeEventListener('cancel', finish);
        window.removeEventListener('focus', onFocus);
        finishPicker = undefined;
        resolve();
      };
      // Settle file selection on change or cancel. Window focus provides a delayed completion signal for browsers without cancel events.
      const onFocus = () => {
        grace = setTimeout(finish, 400);
      };
      finishPicker = finish;
      input.addEventListener('change', finish, { once: true });
      input.addEventListener('cancel', finish, { once: true });
      window.addEventListener('focus', onFocus);
      input.click();
    });
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file || destroyed) return null;
    uploadBusy = true;
    // Show the picked file immediately and measure it, so the preview renders the real
    // image at its real size from the first frame. Probing and creating the object URL
    // are both cheap and independent, so neither gates the other.
    if (!isImageFile(file)) {
      clearPreview();
    } else {
      clearPreview();
      previewUrl = URL.createObjectURL(file);
      void probeSourceSize(file).then((size) => {
        if (destroyed || !size) return;
        previewSize = size;
      });
    }
    try {
      return await onPickFile(file);
    } catch (error) {
      // A cancel is not a failure: the editor handles AbortError silently.
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      if (!cancelled) console.error('[admin] editor upload failed', error);
      throw error;
    } finally {
      uploadBusy = false;
      // The hosted URL is now in the markdown, so the local stand-in has done its job.
      // Leaving it would double-render the same image; clearPreview releases the blob URL.
      clearPreview();
    }
  }

  /**
   * Cancel means "abort the transfer" while one is running — the draft must survive, so
   * the dialog stays open. With nothing in flight it is the plain "close the editor".
   */
  function handleCancel(): void {
    if (uploadBusy) {
      onCancelUpload?.();
      return;
    }
    onCancel();
  }

  function submit(): void {
    onSave(title.trim(), contentMd.trim());
  }
</script>

<input bind:this={fileInput} type="file" class="hidden" />

<EditorDialog
  label={copy.admin.editor.titlePlaceholder}
  {canSave}
  saveLabel={uploadBusy ? copy.admin.editor.uploading : copy.admin.editor.save}
  onSave={submit}
  onCancel={handleCancel}
>
  {#snippet body()}
    <div class="flex h-full flex-col gap-5">
      <div class="shrink-0">
        <input
          id="announcement-title"
          bind:value={title}
          required
          type="text"
          placeholder={copy.admin.editor.titlePlaceholder}
          aria-label={copy.admin.editor.titlePlaceholder}
          class="field-control"
        />
      </div>
      <div class="min-h-0 flex-1">
        <MarkdownEditor
          bind:value={contentMd}
          onPickFile={pickFile}
          {polls}
          {selfId}
          {uploadTask}
          {previewUrl}
          {previewSize}
          {onRetryUpload}
        />
      </div>
    </div>
  {/snippet}
</EditorDialog>
