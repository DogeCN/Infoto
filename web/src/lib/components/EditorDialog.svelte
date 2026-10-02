<script lang="ts">
  // Modal editor panel: scrollable body, a sticky action footer, and the shared overlay
  // behaviour (focus trap, scroll lock, Escape). The caller supplies only the body.
  import type { Snippet } from 'svelte';
  import { overlay } from '$base/lib/overlay';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    /** Accessible name for the panel. */
    label: string;
    canSave: boolean;
    saveLabel: string;
    /** Submit replaces the native form event; the footer button is `type="submit"`. */
    onSave: () => void;
    onCancel: () => void;
    /** Panel content, inside the scroll region. */
    body: Snippet;
  }

  let { label, canSave, saveLabel, onSave, onCancel, body }: Props = $props();

  function mount(node: HTMLElement) {
    const action = overlay(node, { onClose: onCancel });
    return {
      destroy: action.destroy,
      update: action.update,
    };
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (canSave) onSave();
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label={label}
  tabindex={-1}
  use:mount
  class="fixed inset-x-0 bottom-0 top-[var(--bar-h,3.5rem)] z-30 flex flex-col bg-background"
>
  <form class="flex min-h-0 flex-1 flex-col" onsubmit={submit}>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
      {@render body()}
    </div>

    <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
      <button type="button" class="action-button action-button--secondary" onclick={onCancel}>
        {copy.admin.editor.cancel}
      </button>
      <button type="submit" disabled={!canSave} class="action-button action-button--primary">
        {saveLabel}
      </button>
    </div>
  </form>
</div>
