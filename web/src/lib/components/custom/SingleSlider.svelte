<script lang="ts">
  // 单柄滑块：与 RangeSlider（筛选区双柄）共用同一套视觉语言——
  // 18px 青柄、主色渐变填充、非默认值时图标与数值高亮、数值列定宽。
  // 布局区的「目标带宽 / 间距」用它，避免与筛选区两副面孔。
  //
  // 两条硬约束（与 RangeSlider 一致）：
  // 1. Firefox 不认 ::-webkit-slider-thumb，必须另写 ::-moz-range-thumb；
  // 2. 拖动路径上不得有 transition（填充条/thumb），否则快速拖动视觉跟不上。
  import type { Component } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    min: number;
    max: number;
    step?: number;
    value: number;
    /** 默认值：与之相等时图标与数值回落 muted（与筛选范围滑块同规则）。 */
    defaultValue: number;
    /** 行首图标。 */
    icon: Component;
    /** 值 → 显示文本。 */
    format?: (v: number) => string;
    onChange?: (v: number) => void;
  }

  let {
    min,
    max,
    step = 1,
    value,
    defaultValue,
    icon: Icon,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  let span = $derived(Math.max(1, max - min));
  let pct = $derived(((value - min) / span) * 100);
  let active = $derived(value !== defaultValue);

  /**
   * 数值列宽（ch）：把取值范围内**按 step 对齐**的所有可能文本扫一遍取最长者。
   * 与 RangeSlider 同规则——列宽恒定（拖动不回流）+ 贴合字符（不留空白）。
   * 必须按 step 取整再格式化：直接采样会得到 "206.25px" / "0.3333333333333333px"
   * 这种滑块永远显示不出来的文本，列宽会被虚撑出大片空白。
   * font-mono 必须挂在**下面的 grid 容器**上：ch 取的是使用该属性的元素的字体。
   */
  let labelCols = $derived.by(() => {
    const steps = 96;
    let n = 1;
    for (let i = 0; i <= steps; i++) {
      const aligned =
        step > 0 ? Math.round((min + (span * i) / steps) / step) * step : min + (span * i) / steps;
      const t = format(aligned);
      if (t.length > n) n = t.length;
    }
    return n;
  });

  const inputCls = cn(
    'absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent',
    '[&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:cursor-grab',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
    '[&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary',
    '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-primary/40',
    '[&::-webkit-slider-thumb]:active:cursor-grabbing',
    '[&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:cursor-grab',
    '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full',
    '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary',
    '[&::-moz-range-thumb]:shadow-md',
    '[&::-moz-range-track]:appearance-none [&::-moz-range-track]:bg-transparent',
  );

  const iconCls = $derived(
    cn(
      'size-4 shrink-0 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
      active ? 'text-primary' : 'text-muted-foreground',
    ),
  );
  const valueCls = $derived(
    cn(
      'text-right whitespace-nowrap tabular-nums transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
      active ? 'text-primary' : 'text-muted-foreground',
    ),
  );
</script>

<!-- 数值列按字符宽（ch）精确预留：列宽恒定（拖动不回流）且贴合字符（不留空白） -->
<div
  class="grid items-center gap-2 font-mono text-xs"
  style="grid-template-columns: 1rem minmax(0, 1fr) {labelCols}ch"
>
  <Icon class={iconCls} />

  <div class="relative h-5 min-w-0 cursor-pointer touch-none">
    <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border"></div>
    <div
      class="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary/70 to-primary"
      style="right: {100 - pct}%"
    ></div>
    <input
      type="range"
      {min}
      {max}
      {step}
      {value}
      class={inputCls}
      oninput={(e) => onChange?.(Number((e.target as HTMLInputElement).value))}
    />
  </div>

  <span class={valueCls}>{format(value)}</span>
</div>
