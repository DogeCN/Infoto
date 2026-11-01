<script lang="ts">
  import type { Poll } from '$shared/types';
  import { ChartNoAxesColumn, Pencil, Trash2 } from '@lucide/svelte';
  import CopyButton from './CopyButton.svelte';
  import { copy } from '$lib/i18n.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import TimeLabel from '$lib/components/TimeLabel.svelte';
  import TooltipIconButton from '$lib/components/TooltipIconButton.svelte';
  import RowActionCluster from './RowActionCluster.svelte';
  import TranslateButton from './TranslateButton.svelte';
  import VoteBlock from '$lib/components/VoteBlock.svelte';

  interface Props {
    polls: Poll[];
    selfId?: number;
    onEdit: (poll: Poll) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
    onTranslate: (poll: Poll) => void;
    translatingId?: number | null;
    translateDisabled?: boolean;
  }

  let {
    polls,
    selfId = -1,
    onEdit,
    onDelete,
    onReorder,
    onTranslate,
    translatingId = null,
    translateDisabled = false,
  }: Props = $props();
</script>

{#if polls.length === 0}
  <EmptyState icon={ChartNoAxesColumn} text={copy.admin.poll.empty} />
{:else}
  <ReorderableList items={polls} {onReorder} listLabel={copy.admin.poll.listLabel}>
    {#snippet row(poll)}
      <!-- No title: the option rows are the poll. A short single-word title adds a heading
           that says nothing the rows do not, and pushes the list into a rhythm of boxes.
           The choice mode and the timestamp identify the row instead. -->
      <RowActionCluster>
        {#snippet leading()}
          <p class="text-xs text-muted-foreground">
            {poll.allowMultiple ? copy.admin.poll.multipleAnswers : copy.admin.poll.singleAnswer}
          </p>
        {/snippet}
        <CopyButton
          value={`::poll:${poll.locale}:${poll.id}`}
          text={copy.admin.poll.copySyntax}
          copiedText={copy.admin.poll.syntaxCopied}
          disabled={poll.id < 0}
          failedText={copy.admin.poll.copyFailed}
        />
        <TranslateButton
          locale={poll.locale}
          translating={translatingId === poll.id}
          disabled={translateDisabled || poll.id < 0}
          onclick={() => onTranslate(poll)}
        />
        <TooltipIconButton
          text={copy.admin.poll.edit}
          class="p-2"
          disabled={poll.id < 0}
          onclick={() => onEdit(poll)}
        >
          <Pencil class="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          text={copy.admin.poll.delete}
          ariaLabel={copy.admin.poll.deleteAria}
          danger
          class="p-2"
          disabled={poll.id < 0}
          onclick={() => onDelete(poll.id)}
        >
          <Trash2 class="size-4" />
        </TooltipIconButton>
      </RowActionCluster>

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
