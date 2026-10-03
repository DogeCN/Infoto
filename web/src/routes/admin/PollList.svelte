<script lang="ts">
  import type { Poll } from '$shared/types';
  import { ChartNoAxesColumn, Copy, Pencil, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$base/lib/clipboard';
  import { copy } from '$lib/i18n.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import TimeLabel from '$lib/components/TimeLabel.svelte';
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

  async function copySyntax(poll: Poll): Promise<void> {
    if (await copyToClipboard(`::poll:${poll.locale}:${poll.id}`))
      toast.success(copy.admin.poll.syntaxCopied);
    else toast.error(copy.admin.poll.copyFailed);
  }
</script>

{#if polls.length === 0}
  <EmptyState icon={ChartNoAxesColumn} text={copy.admin.poll.empty} />
{:else}
  <ReorderableList items={polls} {onReorder} listLabel={copy.admin.poll.listLabel}>
    {#snippet row(poll)}
      <!-- No title: the option rows are the poll. A short single-word title adds a heading
           that says nothing the rows do not, and pushes the list into a rhythm of boxes.
           The choice mode and the timestamp identify the row instead. -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-muted-foreground">
          {poll.allowMultiple ? copy.admin.poll.multipleAnswers : copy.admin.poll.singleAnswer}
        </p>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip text={copy.admin.poll.copySyntax}>
            <button
              type="button"
              class="icon-button p-2"
              aria-label={copy.admin.poll.copySyntax}
              disabled={poll.id < 0}
              onclick={() => void copySyntax(poll)}
            >
              <Copy class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.poll.edit}>
            <button
              type="button"
              class="icon-button p-2"
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
              class="icon-button icon-button--danger p-2"
              aria-label={copy.admin.poll.deleteAria}
              disabled={poll.id < 0}
              onclick={() => onDelete(poll.id)}
            >
              <Trash2 class="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <!-- Read-only render of the poll. No heading: the option rows are self-describing, and
           a second bordered panel around them only nested one box inside another. The
           timestamp gets its own bottom row, as in the other lists, so it never steals
           width from the option labels. -->
      <div class="mt-3">
        <VoteBlock
          options={poll.options}
          votes={poll.votes}
          allowMultiple={poll.allowMultiple}
          interactive={false}
          {selfId}
        />
      </div>
      <div class="mt-3 flex justify-end">
        <TimeLabel
          time={poll.updatedAt}
          align="end"
          class="text-xs text-muted-foreground tabular-nums"
        />
      </div>
    {/snippet}
  </ReorderableList>
{/if}
