<script lang="ts">
  import { tick } from 'svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';

  interface Props {
    announcement: {
      id: number;
      title: string;
      contentMd: string;
      updatedAt: number;
    } | null;
    onPickImage: (file: File) => Promise<string>;
    onSave: (title: string, contentMd: string) => void;
    onCancel: () => void;
  }

  let { announcement, onPickImage, onSave, onCancel }: Props = $props();
  let title = $state('');
  let contentMd = $state('');
  let titleInput: HTMLInputElement | undefined = $state(undefined);
  let imageInput: HTMLInputElement | undefined = $state(undefined);
  let initialized = false;
  let wasOpen = false;
  let session = 0;
  let uploadBusy = $state(false);
  const canSave = $derived(title.trim().length > 0 && contentMd.trim().length > 0 && !uploadBusy);

  // Mount-once semantics: Admin.svelte renders this only inside
  // `{#if editorOpen}`, so the dialog is always "open" while mounted and state
  // resets happen via destroy/re-create — no open/close transition tracking.
  $effect(() => {
    const key = `${announcement?.id ?? 'new'}:${announcement?.updatedAt ?? 0}:${session}`;
    if (!initialized || (initialized && !wasOpen)) session += 1;
    wasOpen = true;
    if (
      initialized &&
      key === `${announcement?.id ?? 'new'}:${announcement?.updatedAt ?? 0}:${session}` &&
      announcement
    )
      return;
    initialized = true;
    title = announcement?.title ?? '';
    contentMd = announcement?.contentMd ?? '';
    uploadBusy = false;
    void tick().then(() => titleInput?.focus());
  });

  async function pickImage() {
    const input = imageInput;
    if (!input) return null;
    await new Promise<void>((resolve) => {
      const finish = () => {
        input.removeEventListener('change', finish);
        input.removeEventListener('cancel', finish);
        resolve();
      };
      input.addEventListener('change', finish, { once: true });
      input.addEventListener('cancel', finish, { once: true });
      input.click();
    });
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return null;
    uploadBusy = true;
    try {
      return await onPickImage(file);
    } catch (error) {
      console.error('[admin] editor image upload failed', error);
      throw error;
    } finally {
      uploadBusy = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSave) return;
    onSave(title.trim(), contentMd.trim());
  }
</script>

<input bind:this={imageInput} type="file" accept="image/*" class="hidden" />

<!-- 不做全屏 Dialog（会盖住管理页顶栏）：改为固定面板，从顶栏下缘填满到页底，
     开关与高亮由 Admin.svelte 的「新增公告」按钮承担。 -->
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="announcement-title"
  tabindex={-1}
  class="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-background md:top-16"
  onkeydown={onKeydown}
>
  <form class="flex min-h-0 flex-1 flex-col" onsubmit={submit}>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-4 md:px-8 md:pt-6">
      <div class="flex h-full flex-col gap-5">
        <div class="shrink-0">
          <input
            id="announcement-title"
            bind:this={titleInput}
            bind:value={title}
            required
            type="text"
            placeholder="标题"
            aria-label="标题"
            class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div class="min-h-0 flex-1">
          <MarkdownEditor bind:value={contentMd} onPickImage={pickImage} />
        </div>
      </div>
    </div>

    <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
      <button
        type="button"
        class="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        onclick={onCancel}
      >
        取消
      </button>
      <button
        type="submit"
        disabled={!canSave || uploadBusy}
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploadBusy ? '上传中' : '保存'}
      </button>
    </div>
  </form>
</div>
