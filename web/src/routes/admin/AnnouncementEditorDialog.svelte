<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import EditorDialog from '$lib/components/EditorDialog.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import type { Poll } from '$shared/types';
  import type { UploadRow } from '../../transcode/pipeline';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    announcement: {
      id: number;
      title: string;
      contentMd: string;
      updatedAt: number;
    } | null;
    polls?: Poll[];
    selfId?: number;
    onPickImage: (file: File) => Promise<string>;
    onSave: (title: string, contentMd: string) => void;
    onCancel: () => void;
    /** Live snapshot of the in-flight editor image upload. */
    uploadTask?: UploadRow | null;
    /** Abort the in-flight editor image upload (the editor stays open). */
    onCancelUpload?: () => void;
    /** Retry a failed editor image upload; returns the hosted URL. */
    onRetryUpload?: (jobId: string) => Promise<string>;
  }

  let {
    announcement,
    polls = [],
    selfId = -1,
    onPickImage,
    onSave,
    onCancel,
    uploadTask = null,
    onCancelUpload,
    onRetryUpload,
  }: Props = $props();
  let title = $state(untrack(() => announcement?.title ?? ''));
  let contentMd = $state(untrack(() => announcement?.contentMd ?? ''));
  let titleInput: HTMLInputElement | undefined = $state(undefined);
  let imageInput: HTMLInputElement | undefined = $state(undefined);
  let uploadBusy = $state(false);
  let uploadName = $state('');
  // Track the in-flight editor job id so we can cancel it if the dialog closes
  // mid-upload (otherwise the artifact is uploaded and immediately discarded).
  let currentJobId: string | null = null;
  let finishPicker: (() => void) | undefined;
  let destroyed = false;
  $effect(() => {
    if (uploadTask) currentJobId = uploadTask.jobId;
  });
  onDestroy(() => {
    destroyed = true;
    finishPicker?.();
    if (currentJobId) onCancelUpload?.();
  });
  const canSave = $derived(title.trim().length > 0 && contentMd.trim().length > 0 && !uploadBusy);

  async function pickImage() {
    const input = imageInput;
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
    uploadName = file.name;
    uploadBusy = true;
    try {
      return await onPickImage(file);
    } catch (error) {
      // A cancel is not a failure: the editor handles AbortError silently.
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      if (!cancelled) console.error('[admin] editor image upload failed', error);
      throw error;
    } finally {
      uploadBusy = false;
      // `uploadName` is kept: the editor reads it *after* the await to build the
      // alt text / aria-label, so clearing it here (before the caller resumes)
      // yields an empty `![](url)`.
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

<input bind:this={imageInput} type="file" accept="image/*,video/*" class="hidden" />

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
          bind:this={titleInput}
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
          onPickImage={pickImage}
          {polls}
          {selfId}
          {uploadName}
          {uploadTask}
          {onRetryUpload}
        />
      </div>
    </div>
  {/snippet}
</EditorDialog>
