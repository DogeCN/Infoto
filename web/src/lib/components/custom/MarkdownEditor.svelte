<script lang="ts">
  // Markdown 编辑器（spec: "Markdown 编辑器"）——工具栏 ToggleGroup 风格 + 分屏实时预览。
  // 工具栏：粗体、斜体、下划线、删除线、引用、代码块、列表、链接、图片、投票。
  // 图片走同一上传管线：由上层传入 onPickFile（经 /upload 代理）后把 URL 嵌入光标处。
  import {
    Bold,
    Italic,
    Underline,
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

  interface Props {
    value: string;
    placeholder?: string;
    /** 触发选文件上传；返回上传后的图床 URL（由上层走 /upload 代理）。 */
    onPickImage?: () => Promise<string | null>;
    onChange?: (v: string) => void;
  }

  let { value = $bindable(''), placeholder = '', onPickImage, onChange }: Props = $props();

  let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);

  /** 在光标处包裹 / 插入标记，并恢复选区。 */
  function surround(before: string, after = before, placeholderText = '') {
    const el = textareaEl;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    value = next;
    onChange?.(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  /** 行首插入前缀（引用 / 列表）。 */
  function prefixLine(prefix: string) {
    const el = textareaEl;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    value = next;
    onChange?.(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  function insertBlock(text: string) {
    const el = textareaEl;
    if (!el) return;
    const start = el.selectionStart;
    const needsNl = start > 0 && value[start - 1] !== '\n';
    const block = `${needsNl ? '\n' : ''}${text}\n`;
    const next = value.slice(0, start) + block + value.slice(el.selectionEnd);
    value = next;
    onChange?.(next);
    queueMicrotask(() => {
      el.focus();
      const pos = start + block.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** 投票：插入 `:::vote 选项A | 选项B`（至少 2 项，契约语法）。 */
  function insertVote() {
    insertBlock(':::vote 选项A | 选项B');
  }

  async function pickImage() {
    const url = await onPickImage?.();
    if (url) surround(`![`, `](${url})`, '图片');
  }

  const TOOLS = [
    { icon: Bold, title: '粗体', run: () => surround('**', '**', '粗体') },
    { icon: Italic, title: '斜体', run: () => surround('*', '*', '斜体') },
    { icon: Underline, title: '下划线', run: () => surround('<u>', '</u>', '下划线') },
    { icon: Strikethrough, title: '删除线', run: () => surround('~~', '~~', '删除线') },
    { icon: Quote, title: '引用', run: () => prefixLine('> ') },
    { icon: Code, title: '代码块', run: () => insertBlock('```\n\n```') },
    { icon: List, title: '列表', run: () => prefixLine('- ') },
    { icon: Link, title: '链接', run: () => surround('[', '](https://)', '链接') },
    { icon: ImagePlus, title: '图片', run: () => void pickImage() },
    { icon: Vote, title: '投票', run: insertVote },
  ];
</script>

<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
  <!-- 左：编辑区 -->
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-card/60 p-0.5">
      {#each TOOLS as tool (tool.title)}
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={tool.title}
          onclick={tool.run}
        >
          <tool.icon class="size-4" />
        </button>
      {/each}
    </div>

    <textarea
      bind:this={textareaEl}
      bind:value
      oninput={() => onChange?.(value)}
      {placeholder}
      rows={14}
      class={cn(
        'w-full resize-y rounded-md border border-input bg-muted px-3 py-2 text-sm leading-relaxed',
        'ring-offset-background placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    ></textarea>
  </div>

  <!-- 右：实时预览 -->
  <div class="min-h-[10rem] rounded-md border border-border bg-card px-4 py-3">
    {#if value.trim()}
      <MarkdownView content={value} class="text-muted-foreground" />
    {:else}
      <p class="text-sm text-muted-foreground">预览</p>
    {/if}
  </div>
</div>
