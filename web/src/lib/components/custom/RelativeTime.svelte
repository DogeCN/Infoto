<script lang="ts">
  // Relative timestamp text, refreshed on an interval. The host wraps this
  // with Tooltip to expose the absolute time on hover.
  /** Formats the elapsed time between `now` and `time` (millisecond epochs). */
  export function formatRelative(now: number, time: number): string {
    const s = Math.max(0, Math.round((now - time) / 1000));
    if (s < 45) return "刚刚";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d} 天前`;
    const mo = Math.round(d / 30);
    if (mo < 12) return `${mo} 个月前`;
    return `${Math.round(mo / 12)} 年前`;
  }

  interface Props {
    time: number;
  }

  let { time }: Props = $props();

  let now = $state(Date.now());
  let label = $derived(formatRelative(now, time));
  let timer: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    void time;
    now = Date.now();
    timer = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  });
</script>

<span class="tabular-nums">{label}</span>
