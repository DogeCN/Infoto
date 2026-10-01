<script lang="ts">
  import { untrack } from 'svelte';
  import type { Poll } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    poll: Poll | null;
    onSave: (title: string, options: string[], allowMultiple: boolean) => void;
    onCancel: () => void;
  }

  let { poll, onSave, onCancel }: Props = $props();
  let title = $state(untrack(() => poll?.title ?? ''));
  let optionsText = $state(untrack(() => poll?.options.join('\n') ?? ''));
  let allowMultiple = $state(untrack(() => poll?.allowMultiple ?? false));
  let options = $derived(
    optionsText
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter(Boolean),
  );
  let canSave = $derived(title.trim().length > 0 && options.length >= 2);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!canSave) return;
    onSave(title.trim(), options, allowMultiple);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label={poll ? copy.admin.poll.edit : copy.admin.newPoll}
  tabindex={-1}
  class="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-background md:top-16"
  onkeydown={onKeydown}
>
  <form class="flex min-h-0 flex-1 flex-col" onsubmit={submit}>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
      <div class="mx-auto flex max-w-3xl flex-col gap-5">
        <label class="space-y-2 text-sm font-medium">
          <span>{copy.admin.editor.pollTitle}</span>
          <input
            bind:value={title}
            required
            maxlength="200"
            type="text"
            aria-label={copy.admin.editor.pollTitle}
            placeholder={copy.admin.editor.pollTitle}
            class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label class="space-y-2 text-sm font-medium">
          <span>{copy.admin.editor.pollOptions}</span>
          <textarea
            bind:value={optionsText}
            rows="8"
            aria-label={copy.admin.editor.pollOptions}
            placeholder={copy.admin.editor.pollOptionsHint}
            class="w-full resize-y rounded-md border border-input bg-muted px-3 py-2.5 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          ></textarea>
          <span class="block text-xs font-normal text-muted-foreground"
            >{copy.admin.editor.pollOptionsHint}</span
          >
        </label>

        <label
          class="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm"
        >
          <input bind:checked={allowMultiple} type="checkbox" class="size-4 accent-primary" />
          <span>{copy.admin.editor.pollAllowMultiple}</span>
        </label>
        {#if poll}
          <p class="text-xs text-muted-foreground">{copy.admin.poll.editResetVotesHint}</p>
        {/if}
      </div>
    </div>

    <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
      <button
        type="button"
        class="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        onclick={onCancel}
      >
        {copy.admin.editor.cancel}
      </button>
      <button
        type="submit"
        disabled={!canSave}
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copy.admin.editor.save}
      </button>
    </div>
  </form>
</div>
