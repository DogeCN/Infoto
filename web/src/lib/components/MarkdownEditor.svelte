<script lang="ts">
  // Markdown editor with a toolbar and a split live preview. Images go through
  // the shared upload pipeline; the returned URL is inserted at the remembered
  // caret so edits made while an upload is in flight do not move it.
  import {
    Bold,
    Italic,
    Strikethrough,
    Quote,
    Code,
    List,
    Link,
    ImagePlus,
    Vote,
  } from '@lucide/svelte';
  import { copy } from '$shared/copy';
  import { cn } from '$lib/utils';
  import MarkdownView from './MarkdownView.svelte';
  import Tooltip from './Tooltip.svelte';
  import VoteBlock from './VoteBlock.svelte';
  import UploadProgressPanel, { type PanelTask } from './UploadProgressPanel.svelte';
  import { splitVote } from '../../core/vote';
  import {
    insertImageAt,
    insertMarkdownBlock,
    mapOffsetThroughEdit,
    prefixSelectedLines,
    wrapSelection,
    type TextSelection,
    type TextTransform,
  } from './markdownTransforms';

  interface Props {
    value: string;
    placeholder?: string;
    /** Pick and upload an image; returns the hosted URL (via /upload proxy). */
    onPickImage?: () => Promise<string | null>;
    onChange?: (v: string) => void;
    /** File name shown on the in-flight upload card (defaults to "image"). */
    uploadName?: string;
    /** Live pipeline snapshot (queue/transcode/hash/upload) of that upload. */
    uploadTask?: PanelTask | null;
    /** Cancel the in-flight editor upload (the parent knows the job id). */
    onCancelUpload?: () => void;
    /** Retry a failed editor upload; the parent calls pipeline.retryEditorUpload(jobId). */
    onRetryUpload?: (jobId: string) => Promise<string>;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onPickImage,
    onChange,
    uploadName = '',
    uploadTask = null,
    onCancelUpload,
    onRetryUpload,
  }: Props = $props();

  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);
  let imageUploading = $state(false);
  let imageError = $state('');
  let pendingImageCaret: number | null = null;
  // True once a real pipeline snapshot arrived this upload — the synthetic 'queued'
  // row only covers the window before it. Without this flag a terminal snapshot would
  // fall through to the synthetic branch and flash a bogus "queued" row.
  let sawLiveSnapshot = $state(false);
  // Captured from the failed snapshot so the retry button can call pipeline.retry(jobId).
  let failedJobId = $state<string | null>(null);
  $effect(() => {
    if (uploadTask) sawLiveSnapshot = true;
    if (uploadTask?.phase === 'failed') failedJobId = uploadTask.jobId;
  });

  /** Row shown by UploadProgressPanel (kind='upload'): the real pipeline snapshot when
   *  live, else the synthetic row covering the window before the first one arrives. */
  let uploadTasks = $derived.by(() => {
    const m = new Map<string, PanelTask>();
    if (!imageUploading) return m;
    const live = uploadTask;
    if (live && live.phase !== 'done' && live.phase !== 'failed') {
      m.set(live.jobId, live);
    } else if (!sawLiveSnapshot) {
      m.set('editor-image', {
        jobId: 'editor-image',
        fileName: uploadName || copy.editor.defaultUploadName,
        phase: 'queued',
        fraction: null,
      });
    }
    return m;
  });

  function selection(): TextSelection {
    return {
      start: textareaEl?.selectionStart ?? value.length,
      end: textareaEl?.selectionEnd ?? value.length,
    };
  }

  function applyTransform(transform: TextTransform): void {
    value = transform.value;
    onChange?.(value);
    queueMicrotask(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(transform.selection.start, transform.selection.end);
    });
  }

  function surround(before: string, after: string, fallback: string): void {
    applyTransform(wrapSelection(value, selection(), before, after, fallback));
  }

  function prefixSelected(prefix: string): void {
    applyTransform(prefixSelectedLines(value, selection(), prefix));
  }

  function insertBlock(text: string, caretOffset = text.length): void {
    applyTransform(insertMarkdownBlock(value, selection(), text, caretOffset));
  }

  function handleInput(event: Event): void {
    const next = (event.currentTarget as HTMLTextAreaElement).value;
    if (pendingImageCaret !== null) {
      pendingImageCaret = mapOffsetThroughEdit(pendingImageCaret, value, next);
    }
    value = next;
    onChange?.(next);
  }

  async function pickImage(): Promise<void> {
    if (!onPickImage || imageUploading) return;
    imageError = '';
    failedJobId = null;
    imageUploading = true;
    sawLiveSnapshot = false;
    pendingImageCaret = selection().start;
    try {
      const url = await onPickImage();
      if (url) {
        const caret = pendingImageCaret ?? selection().start;
        // File name (minus extension) becomes the alt text / video aria-label.
        const alt = (uploadName || '').replace(/\.[^.]+$/, '');
        applyTransform(insertImageAt(value, caret, url, alt));
      }
    } catch (error) {
      console.error('[editor] image upload failed', error);
      // The pipeline already translates engine error codes into localized copy.
      imageError =
        error instanceof Error && error.message ? error.message : copy.editor.imageUploadFailed;
    } finally {
      imageUploading = false;
      pendingImageCaret = null;
    }
  }

  const TOOLS: Array<{
    icon: typeof Bold;
    title: string;
    run: () => void;
    image?: boolean;
  }> = [
    {
      icon: Bold,
      title: copy.editor.tools.bold,
      run: () => surround('**', '**', copy.editor.tools.bold),
    },
    {
      icon: Italic,
      title: copy.editor.tools.italic,
      run: () => surround('*', '*', copy.editor.tools.italic),
    },
    {
      icon: Strikethrough,
      title: copy.editor.tools.strikethrough,
      run: () => surround('~~', '~~', copy.editor.tools.strikethrough),
    },
    { icon: Quote, title: copy.editor.tools.quote, run: () => prefixSelected('> ') },
    { icon: Code, title: copy.editor.tools.code, run: () => insertBlock('```\n\n```', 4) },
    { icon: List, title: copy.editor.tools.list, run: () => prefixSelected('- ') },
    {
      icon: Link,
      title: copy.editor.tools.link,
      run: () => surround('[', '](https://)', copy.editor.tools.link),
    },
    { icon: ImagePlus, title: copy.editor.tools.image, run: () => void pickImage(), image: true },
    { icon: Vote, title: copy.editor.tools.vote, run: () => insertBlock(':::vote 选项A | 选项B') },
  ];

  let previewVote = $derived(splitVote(value));
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
  <div class="flex min-h-0 min-w-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/60 p-1">
      {#each TOOLS as tool (tool.title)}
        <Tooltip
          text={imageUploading && tool.image ? copy.editor.uploading : tool.title}
          side="bottom"
        >
          <button
            type="button"
            aria-label={tool.title}
            disabled={imageUploading && tool.image}
            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            onclick={tool.run}
          >
            <tool.icon class="size-4" />
          </button>
        </Tooltip>
      {/each}
    </div>

    <textarea
      bind:this={textareaEl}
      {value}
      oninput={handleInput}
      {placeholder}
      rows={14}
      class={cn(
        'min-h-[12rem] w-full flex-1 resize-none rounded-md border border-input bg-muted px-3 py-2 text-sm leading-relaxed',
        'ring-offset-background placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}></textarea>
    {#if imageUploading}
      <!-- Same floating spot as the home transcode progress card (fixed bottom-right); bottom-16 clears the editor's bottom cancel/save bar -->
      <div class="fixed right-4 bottom-16 z-40 w-72">
        <UploadProgressPanel
          tasks={uploadTasks}
          kind="upload"
          onCancelTask={() => onCancelUpload?.()}
        />
      </div>
    {:else if imageError}
      <div class="flex items-center gap-2" aria-live="polite">
        <p class="text-xs text-destructive">{imageError}</p>
        {#if failedJobId && onRetryUpload}
          <button
            type="button"
            class="text-xs font-medium text-primary underline-offset-2 hover:underline"
            onclick={async () => {
              const id = failedJobId;
              if (!id || !onRetryUpload) return;
              imageError = '';
              failedJobId = null;
              imageUploading = true;
              sawLiveSnapshot = false;
              pendingImageCaret = selection().start;
              try {
                const url = await onRetryUpload(id);
                if (url) {
                  const caret = pendingImageCaret ?? selection().start;
                  const alt = (uploadName || '').replace(/\.[^.]+$/, '');
                  applyTransform(insertImageAt(value, caret, url, alt));
                }
              } catch (error) {
                console.error('[editor] image upload retry failed', error);
                imageError =
                  error instanceof Error && error.message
                    ? error.message
                    : copy.editor.imageUploadFailed;
              } finally {
                imageUploading = false;
                pendingImageCaret = null;
              }
            }}>{copy.editor.retry}</button
          >
        {/if}
      </div>
    {/if}
  </div>

  <div
    class="min-h-[12rem] min-w-0 h-full overflow-y-auto rounded-md border border-border bg-card px-4 py-3"
    aria-label={copy.editor.previewAria}
  >
    {#if value.trim()}
      <div class="flex flex-col gap-4">
        {#if previewVote.before.trim()}
          <MarkdownView content={previewVote.before} allowImages class="text-muted-foreground" />
        {/if}
        {#if previewVote.options.length >= 2}
          <VoteBlock options={previewVote.options} votes={[]} selfId={-1} />
        {/if}
        {#if previewVote.after.trim()}
          <MarkdownView content={previewVote.after} allowImages class="text-muted-foreground" />
        {/if}
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">{copy.editor.previewEmpty}</p>
    {/if}
  </div>
</div>
