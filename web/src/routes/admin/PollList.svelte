<script lang="ts">
  import type { Poll } from '$shared/types';
  import { ChartNoAxesColumn, Copy, Pencil, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$base/lib/clipboard';
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
    if (await copyToClipboard(`::vote:${id}`)) toast.success(copy.admin.poll.syntaxCopied);
    else toast.error(copy.admin.poll.copyFailed);
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
              class="icon-button p-2"
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
           a second bordered panel around them only nested one box inside another. -->
      <div class="mt-4">
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
