<script lang="ts">
  // 多选底栏（spec: "多选模式" / "自定义组件清单"）。全宽固定底栏 + 毛玻璃，
  // transform 滑入/滑出（不用居中胶囊：全宽底栏拇指热区更大）。
  import { CheckSquare, Square, Download, Trash2, X, ThumbsUp } from '@lucide/svelte';
  import type { Photo } from '$shared/types';
  import { humanSize } from '$base/lib/format';

  interface Props {
    selected: Set<number>;
    photos: Photo[];
    selfId?: number;
    visible: boolean;
    onSelectAll?: () => void;
    onDeselectAll?: () => void;
    onDownload?: () => void;
    onUnmark?: () => void;
    onDelete?: () => void;
  }

  let {
    selected,
    photos,
    selfId = -1,
    visible,
    onSelectAll,
    onDeselectAll,
    onDownload,
    onUnmark,
    onDelete,
  }: Props = $props();

  let count = $derived(selected.size);
  let totalSize = $derived(
    photos
      .filter((p) => selected.has(p.id))
      .reduce((sum, p) => sum + (p.size || 0), 0)
  );
  let allSelected = $derived(count === photos.length && photos.length > 0);

  /** 选中项中是否有当前用户已作的标记（无则可取消标记按钮置灰）。 */
  let hasAnyMark = $derived(
    photos.some(
      (p) =>
        selected.has(p.id) &&
        (p.likes.includes(selfId) || p.dislikes.includes(selfId) || p.reports.includes(selfId))
    )
  );
</script>

<div
  class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-xl backdrop-saturate-150"
  style="transform: translateY({visible ? '0' : '110%'}); visibility: {visible
    ? 'visible'
    : 'hidden'}; transition: transform .3s, visibility 0s"
>
  <!-- 全选 / 取消全选 -->
  <button
    type="button"
    class="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-muted-foreground"
    onclick={allSelected ? onDeselectAll : onSelectAll}
    title={allSelected ? '取消全选' : '全选'}
  >
    {#if allSelected}
      <CheckSquare class="size-5" />
    {:else}
      <Square class="size-5" />
    {/if}
  </button>

  <!-- 已选数目与总大小 -->
  <div class="flex items-center gap-2 text-sm text-muted-foreground">
    <span class="font-medium text-foreground">{count}</span>
    <span>已选</span>
    {#if totalSize > 0}
      <span class="text-muted-foreground/70">·</span>
      <span>{humanSize(totalSize)}</span>
    {/if}
  </div>

  <!-- 下载 / 取消标记 / 取消选择 / 删除（根用户） -->
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-muted-foreground"
      onclick={onDownload}
      disabled={count === 0}
      title="下载"
    >
      <Download class="size-5" />
    </button>

    <button
      type="button"
      class="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:opacity-40"
      class:text-warning={hasAnyMark}
      onclick={onUnmark}
      disabled={!hasAnyMark}
      title="取消标记"
    >
      <ThumbsUp class="size-5" />
    </button>

    <button
      type="button"
      class="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-muted-foreground"
      onclick={onDeselectAll}
      title="取消选择"
    >
      <X class="size-5" />
    </button>

    {#if selfId === 0}
      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-destructive/10 hover:text-destructive"
        onclick={onDelete}
        disabled={count === 0}
        title="删除"
      >
        <Trash2 class="size-5" />
      </button>
    {/if}
  </div>
</div>
