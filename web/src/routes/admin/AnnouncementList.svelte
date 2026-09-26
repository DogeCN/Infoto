<script lang="ts">
  import type { Announcement } from '$shared/types';
  import { Megaphone, Pencil, Trash2 } from '@lucide/svelte';
  import { copy } from '$shared/copy';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import TimeLabel from '$lib/components/TimeLabel.svelte';
  import { reactionCounts } from '../../core/reactions';

  interface Props {
    announcements: Announcement[];
    onEdit: (announcement: Announcement) => void;
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
  }

  let { announcements, onEdit, onDelete, onReorder }: Props = $props();
</script>

{#if announcements.length === 0}
  <EmptyState icon={Megaphone} text={copy.admin.announcement.empty} />
{:else}
  <!-- Drag any card to reorder; the card shell + FLIP live in ReorderableList. -->
  <ReorderableList items={announcements} {onReorder} listLabel={copy.admin.announcement.listLabel}>
    {#snippet row(announcement)}
      {@const counts = reactionCounts(announcement, -1)}
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium">{announcement.title}</h3>
          <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {announcement.contentMd}
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <Tooltip text={copy.admin.announcement.edit}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              aria-label={copy.admin.announcement.editAria}
              onclick={() => onEdit(announcement)}
            >
              <Pencil class="size-4" />
            </button>
          </Tooltip>
          <Tooltip text={copy.admin.announcement.delete}>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={copy.admin.announcement.deleteAria}
              onclick={() => onDelete(announcement.id)}
            >
              <Trash2 class="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground/70">
        <div class="flex flex-wrap items-center gap-2">
          {#each counts as count (count.emoji)}
            <span class="rounded-full border border-border px-2 py-0.5">
              {count.emoji}
              {count.count}
            </span>
          {/each}
        </div>
        <TimeLabel time={announcement.updatedAt} align="end" class="shrink-0 tabular-nums" />
      </div>
    {/snippet}
  </ReorderableList>
{/if}
