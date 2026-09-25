<script lang="ts">
  // 公告投票控件（参考 D:\ToDo\web\announcements.html 的选项区质感，去掉了顶部
  // 标题/「换一下」与底部「共 N 票」的小字，圆角改用本项目 --radius）。
  // 语义：点击选项即投票；再点已选项 = 撤回（option null，后端支持）；点其它项 = 改投。
  import type { Vote } from '$shared/types';

  interface Props {
    options: string[];
    votes: Vote[];
    selfId?: number;
    onVote?: (option: number | null) => void;
  }

  let { options, votes, selfId = -1, onVote }: Props = $props();

  // 各选项票数 & 是否最高票
  let counts = $derived.by(() => {
    const c = new Array<number>(options.length).fill(0);
    for (const v of votes) {
      if (v.option >= 0 && v.option < options.length) c[v.option]!++;
    }
    return c;
  });

  let total = $derived(counts.reduce((a, b) => a + b, 0));
  let max = $derived(counts.length ? Math.max(...counts) : 0);
  // 当前用户已投的选项序号（-1 表示未投）
  let chosen = $derived(votes.findLast((v) => v.userId === selfId)?.option ?? -1);

  function handle(option: number) {
    onVote?.(chosen === option ? null : option);
  }
</script>

<div class="space-y-1.5">
  {#each options as label, idx (idx)}
    {@const count = counts[idx]}
    {@const pct = total ? (count / total) * 100 : 0}
    {@const isChosen = chosen === idx}
    {@const isWinner = max > 0 && count === max}
    <!-- isolate：把内部的 z-10 关在按钮自己的堆叠上下文里。
         否则 relative + z-index:auto 的按钮不会自建层，里面的 z-10 会逃到
         外层上下文，越过父级 sticky 的推荐框之类（真出现过穿模）。 -->
    <button
      type="button"
      class="relative isolate w-full overflow-hidden rounded-md border px-3 py-2 text-left transition-colors duration-200 {isChosen
        ? 'border-primary/50 bg-primary/5'
        : 'border-border bg-transparent hover:bg-muted/50 hover:border-primary/30'}"
      onclick={() => handle(idx)}
    >
      <!-- 填充条：主色低透明，随票数比例展开 -->
      <span
        class="vote-fill absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-500 ease-out"
        style="width: {pct.toFixed(1)}%"
      ></span>
      <span class="vote-meta relative z-10 flex items-center justify-between gap-2">
        <span
          class="text-sm leading-tight {isChosen || isWinner ? 'text-primary' : 'text-foreground'}"
        >
          {label}
        </span>
        <span class="inline-flex items-baseline gap-1.5 tabular-nums">
          <span class="font-mono text-xs text-primary">{pct.toFixed(0)}%</span>
          <span class="font-mono text-[11px] text-muted-foreground/70">{count} 票</span>
        </span>
      </span>
    </button>
  {/each}
</div>
