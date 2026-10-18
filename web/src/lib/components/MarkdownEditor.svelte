<script lang="ts">
  // Markdown editor with a toolbar and a split live preview. Images go through
  // the shared upload pipeline; the returned URL is inserted at the remembered
  // caret so edits made while an upload is in flight do not move it.
  import { Bold, Italic, Strikethrough, Quote, Code, List, Link, FileUp } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import { cn } from '$base/lib/ui';
  import Tooltip from './Tooltip.svelte';
  import PollReferences from './PollReferences.svelte';
  import type { Poll } from '$shared/types';
  import {
    insertMediaAt,
    insertMarkdownBlock,
    mapOffsetThroughEdit,
    prefixSelectedLines,
    wrapSelection,
    type TextSelection,
    type TextTransform,
  } from '../../core/markdown';
  import type { UploadRow } from '../../transcode/pipeline';

  interface Props {
    value: string;
    placeholder?: string;
    /** Pick and upload an image; returns the hosted URL (via /upload proxy). */
    onPickImage?: () => Promise<string | null>;
    onChange?: (v: string) => void;
    /** Current language's poll registry powers embedded live previews. */
    polls?: Poll[];
    selfId?: number;
    /** Live snapshot of that upload (its phase drives the failed-state retry link). */
    uploadTask?: UploadRow | null;
    /** Object URL of the picked file, shown in the preview while the upload runs so the
     *  image and its box are real from the first frame instead of a 16:10 guess. */
    previewUrl?: string | null;
    /** Measured source dimensions; reserves the true box before the image decodes. */
    previewSize?: { width: number; height: number } | null;
    /** Retry a failed editor upload; the parent calls pipeline.retryEditorUpload(jobId). */
    onRetryUpload?: (jobId: string) => Promise<string>;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onPickImage,
    onChange,
    polls = [],
    selfId = -1,
    uploadTask = null,
    previewUrl = null,
    previewSize = null,
    onRetryUpload,
  }: Props = $props();

  /** The preview's reserved ratio: the measured source when known, else nothing (the shared
   *  16:10 placeholder). Derived, so the box follows the measurement as it lands. */
  let previewRatio = $derived(
    previewSize && previewSize.width > 0 && previewSize.height > 0
      ? `${previewSize.width} / ${previewSize.height}`
      : null,
  );

  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);
  let imageUploading = $state(false);
  let imageError = $state('');
  let pendingImageCaret: number | null = null;
  // Captured from the failed snapshot so the retry button can call pipeline.retry(jobId).
  let failedJobId = $state<string | null>(null);
  $effect(() => {
    if (uploadTask?.phase === 'failed') failedJobId = uploadTask.jobId;
  });

  /** A deliberate cancel (the panel's remove button) rejects the pending upload too —
   *  that is not a failure to report. */
  function isCancelled(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

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

  /**
   * Run one editor upload from whichever path started it — a fresh pick or a retry. The caret
   * is captured before the transfer, the returned URL is inserted at it, and the error/uploading
   * state is owned in one place so the two paths cannot drift.
   */
  async function runUpload(start: () => Promise<string | null>): Promise<void> {
    imageError = '';
    failedJobId = null;
    imageUploading = true;
    pendingImageCaret = selection().start;
    try {
      const url = await start();
      if (url) {
        const caret = pendingImageCaret ?? selection().start;
        // Media renders in place; anything else becomes a link to the hosted file.
        // No alt text: the browser paints alt as broken-image text while the image
        // decodes, so a file name there reads as an ugly caption over the placeholder.
        applyTransform(insertMediaAt(value, caret, url));
      }
    } catch (error) {
      // A deliberate cancel is not a failure: no error line, no message under the editor.
      if (isCancelled(error)) return;
      console.error('[editor] upload failed', error);
      // The pipeline already translates engine error codes into localized copy.
      imageError =
        error instanceof Error && error.message ? error.message : copy.editor.imageUploadFailed;
    } finally {
      imageUploading = false;
      pendingImageCaret = null;
    }
  }

  async function pickImage(): Promise<void> {
    const pick = onPickImage;
    if (!pick || imageUploading) return;
    await runUpload(pick);
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
    {
      icon: FileUp,
      title: copy.editor.tools.file,
      run: () => void pickImage(),
      image: true,
    },
  ];
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
            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground"
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
    {#if !imageUploading && imageError}
      <div class="flex items-center gap-2" aria-live="polite">
        <p class="text-xs text-destructive">{imageError}</p>
        {#if failedJobId && onRetryUpload}
          <button
            type="button"
            class="text-xs font-medium text-primary underline-offset-2 hover:underline"
            onclick={() => {
              const id = failedJobId;
              if (!id || !onRetryUpload) return;
              void runUpload(() => onRetryUpload(id));
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
    <!-- The picked file is on screen from the first frame, at its real size: the object URL
         shows the same bytes the hosted URL will serve, and the probed ratio reserves the
         true box. So there is no 16:10 guess and no snap when the real image decodes — the
         card's curtain, applied to the editor. The shimmer only covers the brief window
         before the probe lands; `object-contain` means the picture never letterboxes. -->
    {#if previewUrl}
      <div
        class="mb-3 overflow-hidden rounded-[0.5rem] {previewRatio ? '' : 'skeleton'}"
        style={previewRatio ? `aspect-ratio: ${previewRatio};` : 'aspect-ratio: 16 / 10;'}
      >
        <img src={previewUrl} alt="" class="size-full object-contain" />
      </div>
    {/if}
    {#if value.trim()}
      <PollReferences content={value} {polls} {selfId} />
    {:else if !previewUrl}
      <p class="text-sm text-muted-foreground">{copy.editor.previewEmpty}</p>
    {/if}
  </div>
</div>
