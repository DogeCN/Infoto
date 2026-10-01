<script lang="ts">
  import type { Poll } from '$shared/types';
  import { Copy, Pencil, Trash2 } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import VoteBlock from '$lib/components/VoteBlock.svelte';
  import { toast } from 'svelte-sonner';

  interface Props {
    polls: Poll[];
    onEdit: (poll: Poll) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
  }

  let { polls, onEdit, onDelete, onReorder }: Props = $props();

  async function copyReference(poll: Poll): Promise<void> {
    try {
      await navigator.clipboard.writeText(`::vote:${poll.id}`);
      toast.success(copy.admin.poll.copied);
    } catch (error) {
      console.error('[poll] copy reference failed', error);
      toast.error(copy.admin.poll.copyFailed);
    }
  }
</script>

{#if polls.length === 0}
  <EmptyState icon={Copy} text={copy.admin.poll.empty} />
{:else}
  <ReorderableList items={polls} {onReorder} listLabel={copy.admin.poll.listLabel}>
    {#snippet row(poll)}
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium">{poll.title}</h3>
          <p class="mt-1 text-xs text-muted-foreground">
            {poll.options.length}
            {copy.admin.poll.optionCount} · {poll.votes.length}
            {copy.admin.poll.voteCount}
            {poll.allowMultiple ? ` · ${copy.admin.poll.allowMultiple}` : ''}
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <Tooltip text={copy.admin.poll.copyCode}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              aria-label={copy.admin.poll.copyCode}
              onclick={() => void copyReference(poll)}
            >
              <Copy class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.poll.edit}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              aria-label={copy.admin.poll.edit}
              onclick={() => onEdit(poll)}
            >
              <Pencil class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.poll.delete}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={copy.admin.poll.deleteAria}
              onclick={() => onDelete(poll.id)}
            >
              <Trash2 class="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div class="mt-3">
        <VoteBlock {poll} interactive={false} />
      </div>
    {/snippet}
  </ReorderableList>
{/if}
