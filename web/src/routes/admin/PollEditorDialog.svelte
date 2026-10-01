<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Poll } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    poll: Poll | null;
    onSave: (title: string, options: string[], allowMultiple: boolean) => Promise<void>;
    onCancel: () => void;
  }

  let { poll, onSave, onCancel }: Props = $props();
  let title = $state(untrack(() => poll?.title ?? ''));
  let optionsText = $state(untrack(() => poll?.options.join('\n') ?? ''));
  let allowMultiple = $state(untrack(() => poll?.allowMultiple ?? false));
  let saving = $state(false);
  let errorMessage = $state('');
  let titleInput: HTMLInputElement | undefined = $state(undefined);

  const hasVotes = $derived((poll?.votes.length ?? 0) > 0);
  const options = $derived(
    optionsText
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter(Boolean),
  );
  const canSave = $derived(
    title.trim().length > 0 &&
      options.length >= 2 &&
      options.length <= 100 &&
      options.every((option) => option.length <= 500) &&
      !saving,
  );

  onMount(() => titleInput?.focus());

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (!saving) onCancel();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSave) return;
    saving = true;
    errorMessage = '';
    try {
      await onSave(title.trim(), options, allowMultiple);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : copy.admin.poll.saveFailed;
    } finally {
      saving = false;
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label={poll ? copy.admin.poll.edit : copy.admin.newPoll}
  tabindex={-1}
  class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
  onclick={(event) => {
    if (event.target === event.currentTarget && !saving) onCancel();
  }}
  onkeydown={handleKeydown}
>
  <form
    class="w-full max-w-lg space-y-5 rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
    onsubmit={submit}
  >
    <div>
      <h2 class="text-lg font-semibold">{poll ? copy.admin.poll.edit : copy.admin.newPoll}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{copy.admin.poll.optionsHint}</p>
    </div>

    <label class="block space-y-1.5">
      <span class="text-sm font-medium">{copy.admin.poll.titlePlaceholder}</span>
      <input
        bind:this={titleInput}
        bind:value={title}
        required
        maxlength="500"
        class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={copy.admin.poll.titlePlaceholder}
      />
    </label>

    <label class="block space-y-1.5">
      <span class="text-sm font-medium">{copy.admin.poll.optionsPlaceholder}</span>
      <textarea
        bind:value={optionsText}
        disabled={hasVotes}
        rows="6"
        class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        placeholder={copy.admin.poll.optionsPlaceholder}></textarea>
    </label>

    <label class="flex items-center gap-2 text-sm">
      <input
        bind:checked={allowMultiple}
        type="checkbox"
        disabled={hasVotes}
        class="size-4 accent-primary disabled:opacity-60"
      />
      <span>{copy.admin.poll.allowMultiple}</span>
    </label>

    {#if hasVotes}
      <p class="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {copy.admin.poll.cannotChangeWithVotes}
      </p>
    {/if}
    {#if errorMessage}
      <p role="alert" class="text-sm text-destructive">{errorMessage}</p>
    {/if}

    <div class="flex justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        disabled={saving}
        class="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
        onclick={onCancel}
      >
        {copy.admin.editor.cancel}
      </button>
      <button
        type="submit"
        disabled={!canSave}
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? copy.admin.editor.uploading : copy.admin.editor.save}
      </button>
    </div>
  </form>
</div>
