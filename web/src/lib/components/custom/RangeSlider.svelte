<script lang="ts">
  // 双柄范围滑块（spec: "自定义组件清单 RangeSlider" / "筛选板块 范围"）：
  // 实时显示当前区间值，右侧 RotateCcw 恢复完整动态范围；可禁用（min = max）。
  // 用两个原生 range 叠加实现双柄，避免引入未落地的 shadcn Slider 依赖。
  import { RotateCcw } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  interface Props {
    min: number;
    max: number;
    value: [number, number];
    /** 处于完整区间（未生效）时标签回落 muted、隐藏重置按钮。 */
    active?: boolean;
    disabled?: boolean;
    /** 值 → 显示文本（如字节数转人类可读）。 */
    format?: (v: number) => string;
    onChange?: (v: [number, number]) => void;
    onReset?: () => void;
  }

  let {
    min,
    max,
    value,
    active = false,
    disabled = false,
    format = (v) => String(v),
    onChange,
    onReset,
  }: Props = $props();

  let span = $derived(Math.max(1, max - min));
  let loPct = $derived(((value[0] - min) / span) * 100);
  let hiPct = $derived(((value[1] - min) / span) * 100);

  function setLo(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    onChange?.([Math.min(v, value[1]), value[1]]);
  }
  function setHi(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    onChange?.([value[0], Math.max(v, value[0])]);
  }
</script>

<div class={cn('space-y-1.5', disabled && 'opacity-50')}>
  <div class="flex items-center justify-between gap-2">
    <span class={cn('text-xs', active ? 'text-primary' : 'text-muted-foreground')}>
      {format(value[0])} – {format(value[1])}
    </span>
    {#if active && !disabled}
      <button
        type="button"
        class="text-muted-foreground transition-colors hover:text-primary"
        title="重置"
        onclick={onReset}
      >
        <RotateCcw class="size-3.5" />
      </button>
    {/if}
  </div>

  <!-- 双柄：两条 range 叠放，轨道透明、仅露滑块 -->
  <div class="relative h-5">
    <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary"></div>
    <div
      class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
      style="left: {loPct}%; right: {100 - hiPct}%"
    ></div>
    <input
      type="range"
      {min}
      {max}
      value={value[0]}
      {disabled}
      class="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
      oninput={setLo}
    />
    <input
      type="range"
      {min}
      {max}
      value={value[1]}
      {disabled}
      class="pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
      oninput={setHi}
    />
  </div>
</div>
