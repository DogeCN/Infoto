<script lang="ts">
  import { untrack } from 'svelte';
  import { CheckSquare, Plus, Trash2 } from '@lucide/svelte';
  import { fmt } from '$shared/copy';
  import { MAX_POLL_OPTIONS, type Poll } from '$shared/types';
  import TriStateToggle from '$lib/components/TriStateToggle.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    poll: Poll | null;
    onSave: (title: string, options: string[], allowMultiple: boolean) => void;
    onCancel: () => void;
  }

  let { poll, onSave, onCancel }: Props = $props();
  let title = $state(untrack(() => poll?.title ?? ''));
  let nextOptionId = 0;
  let options = $state(
    untrack(() => (poll?.options ?? ['', '']).map((value) => ({ id: nextOptionId++, value }))),
  );
  let allowMultiple = $state(untrack(() => poll?.allowMultiple ?? false));
  let canSave = $derived(
    title.trim().length > 0 &&
      options.length >= 2 &&
      options.length <= MAX_POLL_OPTIONS &&
      options.every((option) => option.value.trim().length > 0),
  );

  function addOption(): void {
    if (options.length >= MAX_POLL_OPTIONS) return;
    options = [...options, { id: nextOptionId++, value: '' }];
  }

  function removeOption(id: number): void {
    if (options.length <= 2) return;
    options = options.filter((option) => option.id !== id);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!canSave) return;
    onSave(
      title.trim(),
      options.map((option) => option.value.trim()),
      allowMultiple,
    );
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
        <label class="block">
          <span class="sr-only">{copy.admin.editor.pollTitle}</span>
          <input
            bind:value={title}
            required
            maxlength="200"
            type="text"
            placeholder={copy.admin.editor.pollTitle}
            class="field-control"
          />
        </label>

        <fieldset class="space-y-3">
          <legend class="sr-only">{copy.admin.editor.pollOptions}</legend>
          <div class="space-y-2">
            {#each options as option, index (option.id)}
              <div class="flex items-center gap-2">
                <input
                  bind:value={option.value}
                  required
                  maxlength="200"
                  type="text"
                  aria-label={fmt(copy.admin.editor.pollOptionLabel, { number: index + 1 })}
                  placeholder={fmt(copy.admin.editor.pollOptionLabel, { number: index + 1 })}
                  class="field-control min-w-0 flex-1"
                />
                <button
                  type="button"
                  class="icon-button icon-button--danger size-9 shrink-0 disabled:opacity-40"
                  aria-label={fmt(copy.admin.editor.removePollOption, { number: index + 1 })}
                  disabled={options.length <= 2}
                  onclick={() => removeOption(option.id)}
                >
                  <Trash2 class="size-4" />
                </button>
              </div>
            {/each}
          </div>
          <!-- Add-option and the multi-select toggle share a row so the toggle sizes to its
               label instead of stretching across the dialog as a block child. -->
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="action-button action-button--secondary disabled:opacity-40"
              aria-label={copy.admin.editor.addPollOption}
              disabled={options.length >= MAX_POLL_OPTIONS}
              onclick={addOption}
            >
              <Plus class="size-4" />
              {copy.admin.editor.addPollOption}
            </button>
            <TriStateToggle
              label={copy.admin.editor.pollAllowMultiple}
              icon={CheckSquare}
              state={allowMultiple ? 'only' : 'off'}
              onCycle={() => (allowMultiple = !allowMultiple)}
            />
          </div>
        </fieldset>

        {#if poll}
          <p class="text-xs text-muted-foreground">{copy.admin.poll.editResetVotesHint}</p>
        {/if}
      </div>
    </div>

    <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
      <button type="button" class="action-button action-button--secondary" onclick={onCancel}>
        {copy.admin.editor.cancel}
      </button>
      <button
        type="submit"
        disabled={!canSave}
        class="action-button action-button--primary disabled:opacity-50"
      >
        {copy.admin.editor.save}
      </button>
    </div>
  </form>
</div>
