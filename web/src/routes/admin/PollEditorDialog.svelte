<script lang="ts">
  import { untrack } from 'svelte';
  import { CheckSquare, Plus, Trash2 } from '@lucide/svelte';
  import { fmt } from '$shared/copy';
  import { MAX_POLL_OPTIONS, type Poll } from '$shared/types';
  import TriStateToggle from '$lib/components/TriStateToggle.svelte';
  import EditorDialog from '$lib/components/EditorDialog.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    poll: Poll | null;
    /** In-memory draft to seed the fields with; wins over `poll`. */
    draft?: { options: string[]; allowMultiple: boolean } | null;
    onSave: (options: string[], allowMultiple: boolean) => void;
    onCancel: () => void;
  }

  let { poll, draft = null, onSave, onCancel }: Props = $props();
  let nextOptionId = 0;
  let options = $state(
    untrack(() =>
      (draft?.options ?? poll?.options ?? ['', '']).map((value) => ({ id: nextOptionId++, value })),
    ),
  );
  let allowMultiple = $state(untrack(() => draft?.allowMultiple ?? poll?.allowMultiple ?? false));
  let canSave = $derived(
    options.length >= 2 &&
      options.length <= MAX_POLL_OPTIONS &&
      options.every((option) => option.value.trim().length > 0),
  );

  /** Live draft snapshot, captured by the tab switch so the editor can be parked unmounted. */
  export function getDraft(): { options: string[]; allowMultiple: boolean } {
    return { options: options.map((option) => option.value), allowMultiple };
  }

  function addOption(): void {
    if (options.length >= MAX_POLL_OPTIONS) return;
    options = [...options, { id: nextOptionId++, value: '' }];
  }

  function removeOption(id: number): void {
    if (options.length <= 2) return;
    options = options.filter((option) => option.id !== id);
  }

  function submit(): void {
    onSave(
      options.map((option) => option.value.trim()),
      allowMultiple,
    );
  }
</script>

<EditorDialog
  label={poll ? copy.admin.poll.edit : copy.admin.newPoll}
  {canSave}
  saveLabel={copy.admin.editor.save}
  onSave={submit}
  {onCancel}
>
  {#snippet body()}
    <div class="mx-auto flex max-w-3xl flex-col gap-5">
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
                class="icon-button icon-button--danger size-9 shrink-0"
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
            class="action-button action-button--secondary"
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
  {/snippet}
</EditorDialog>
