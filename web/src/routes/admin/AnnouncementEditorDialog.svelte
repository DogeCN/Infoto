<script lang="ts">
  import { tick } from "svelte";
  import MarkdownEditor from "$lib/components/custom/MarkdownEditor.svelte";
  import Dialog from "$lib/components/custom/Dialog.svelte";
  import { formatAbsoluteTime } from "$lib/time";

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
  let title = $state("");
  let contentMd = $state("");
  let titleInput: HTMLInputElement | undefined = $state(undefined);
  let imageInput: HTMLInputElement | undefined = $state(undefined);
  let initialized = false;
  let wasOpen = false;
  let session = 0;
  let uploadBusy = $state(false);
  const canSave = $derived(
    title.trim().length > 0 && contentMd.trim().length > 0 && !uploadBusy,
  );

  $effect(() => {
    const key = `${announcement?.id ?? "new"}:${announcement?.updatedAt ?? 0}:${session}`;
    if (!initialized || (initialized && !wasOpen)) session += 1;
    wasOpen = true;
    if (
      initialized &&
      key ===
        `${announcement?.id ?? "new"}:${announcement?.updatedAt ?? 0}:${session}` &&
      announcement
    )
      return;
    if (initialized && session > 1 && !open) return;
    initialized = true;
    title = announcement?.title ?? "";
    contentMd = announcement?.contentMd ?? "";
    uploadBusy = false;
    void tick().then(() => titleInput?.focus());
  });

  $effect(() => {
    if (!open && wasOpen) {
      initialized = false;
      wasOpen = false;
      session = 0;
      uploadBusy = false;
    } else if (open) {
      wasOpen = true;
    }
  });

  async function pickImage() {
    const input = imageInput;
    if (!input) return null;
    await new Promise<void>((resolve) => {
      const finish = () => {
        input.removeEventListener("change", finish);
        input.removeEventListener("cancel", finish);
        resolve();
      };
      input.addEventListener("change", finish, { once: true });
      input.addEventListener("cancel", finish, { once: true });
      input.click();
    });
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return null;
    uploadBusy = true;
    try {
      return await onPickImage(file);
    } catch (error) {
      console.error("[admin] editor image upload failed", error);
      throw error;
    } finally {
      uploadBusy = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSave) return;
    onSave(title.trim(), contentMd.trim());
  }
</script>

<input bind:this={imageInput} type="file" accept="image/*" class="hidden" />

<Dialog open fullscreen onClose={onCancel}>
  <form class="flex h-dvh min-h-0 flex-col bg-background" onsubmit={submit}>
    <div
      class="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6"
    >
      <div class="min-w-0">
        <h2 id="announcement-editor-title" class="text-lg font-medium">
          {announcement ? "编辑公告" : "新增公告"}
        </h2>
        {#if announcement}
          <p class="mt-1 text-xs text-muted-foreground">
            上次更新于 {formatAbsoluteTime(announcement.updatedAt)}
          </p>
        {/if}
      </div>
      <button
        type="button"
        class="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onclick={onCancel}
      >
        取消
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
      <div class="mx-auto flex h-full max-w-6xl flex-col gap-4">
        <div>
          <label
            for="announcement-title"
            class="mb-1.5 block text-sm font-medium"
          >
            标题
          </label>
          <input
            id="announcement-title"
            bind:this={titleInput}
            bind:value={title}
            required
            type="text"
            placeholder="标题"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div class="min-h-[24rem] flex-1">
          <MarkdownEditor bind:value={contentMd} onPickImage={pickImage} />
        </div>
      </div>
    </div>

    <div
      class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 md:px-6"
    >
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
        {uploadBusy ? "上传中" : "保存"}
      </button>
    </div>
  </form>
</Dialog>
