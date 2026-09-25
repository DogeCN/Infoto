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
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onPickImage,
    onChange,
    uploadName = '',
    uploadTask = null,
  }: Props = $props();

  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);
  let imageUploading = $state(false);
  let imageError = $state('');
  let pendingImageCaret: number | null = null;

  /**
   * Row shown by UploadProgressPanel (kind='upload'). Prefers the real pipeline
   * snapshot so the shared transcode → hash → upload stages are visible; the
   * synthetic row only covers the window before the first snapshot arrives.
   */
  let uploadTasks = $derived.by(() => {
    const m = new Map<string, PanelTask>();
    const live = uploadTask;
    if (imageUploading && live && live.phase !== 'done' && live.phase !== 'failed') {
      m.set(live.jobId, live);
    } else if (imageUploading) {
      m.set('editor-image', {
        jobId: 'editor-image',
        fileName: uploadName || '图片',
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
    imageUploading = true;
    pendingImageCaret = selection().start;
    try {
      const url = await onPickImage();
      if (url) {
        const caret = pendingImageCaret ?? selection().start;
        applyTransform(insertImageAt(value, caret, url));
      }
    } catch (error) {
      console.error('[editor] image upload failed', error);
      // The pipeline already translates engine error codes into localized copy.
      imageError = error instanceof Error && error.message ? error.message : '图片上传失败，请重试';
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
    { icon: Bold, title: '粗体', run: () => surround('**', '**', '粗体') },
    { icon: Italic, title: '斜体', run: () => surround('*', '*', '斜体') },
    { icon: Strikethrough, title: '删除线', run: () => surround('~~', '~~', '删除线') },
    { icon: Quote, title: '引用', run: () => prefixSelected('> ') },
    { icon: Code, title: '代码块', run: () => insertBlock('```\n\n```', 4) },
    { icon: List, title: '列表', run: () => prefixSelected('- ') },
    { icon: Link, title: '链接', run: () => surround('[', '](https://)', '链接') },
    { icon: ImagePlus, title: '图片', run: () => void pickImage(), image: true },
    { icon: Vote, title: '投票', run: () => insertBlock(':::vote 选项A | 选项B') },
  ];

  let previewVote = $derived(splitVote(value));
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
  <div class="flex min-h-0 min-w-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/60 p-1">
      {#each TOOLS as tool (tool.title)}
        <Tooltip text={imageUploading && tool.image ? '上传中' : tool.title} side="bottom">
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
        <UploadProgressPanel tasks={uploadTasks} kind="upload" />
      </div>
    {:else if imageError}
      <p class="text-xs text-destructive" aria-live="polite">{imageError}</p>
    {/if}
  </div>

  <div
    class="min-h-[12rem] min-w-0 h-full overflow-y-auto rounded-md border border-border bg-card px-4 py-3"
    aria-label="实时预览"
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
      <p class="text-sm text-muted-foreground">预览</p>
    {/if}
  </div>
</div>
