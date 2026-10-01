<script lang="ts">
  import type { Poll } from '$shared/types';
  import { ChartNoAxesColumn, Copy, Pencil, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { copy } from '$lib/i18n.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import VoteBlock from '$lib/components/VoteBlock.svelte';

  interface Props {
    polls: Poll[];
    selfId?: number;
    onEdit: (poll: Poll) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
  }

  let { polls, selfId = -1, onEdit, onDelete, onReorder }: Props = $props();

  async function copySyntax(id: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(`::vote:${id}`);
      toast.success(copy.admin.poll.syntaxCopied);
    } catch {
      toast.error(copy.admin.poll.copyFailed);
    }
  }
</script>

{#if polls.length === 0}
  <EmptyState icon={ChartNoAxesColumn} text={copy.admin.poll.empty} />
{:else}
  <ReorderableList items={polls} {onReorder} listLabel={copy.admin.poll.listLabel}>
    {#snippet row(poll)}
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-semibold leading-snug">{poll.title}</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            {poll.allowMultiple ? copy.admin.poll.multipleAnswers : copy.admin.poll.singleAnswer}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip text={copy.admin.poll.copySyntax}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.admin.poll.copySyntax}
              disabled={poll.id < 0}
              onclick={() => void copySyntax(poll.id)}
            >
              <Copy class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.poll.edit}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.admin.poll.edit}
              disabled={poll.id < 0}
              onclick={() => onEdit(poll)}
            >
              <Pencil class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.poll.delete}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.admin.poll.deleteAria}
              disabled={poll.id < 0}
              onclick={() => onDelete(poll.id)}
            >
              <Trash2 class="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div class="mt-4 space-y-2 rounded-lg border border-border bg-background/50 p-3">
        <p class="text-xs font-medium text-muted-foreground">{copy.admin.poll.preview}</p>
        <VoteBlock
          options={poll.options}
          votes={poll.votes}
          allowMultiple={poll.allowMultiple}
          interactive={false}
          {selfId}
        />
      </div>
    {/snippet}
  </ReorderableList>
{/if}
