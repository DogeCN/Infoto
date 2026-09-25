<script lang="ts">
  // 双柄范围滑块（spec: "自定义组件清单 RangeSlider" / "筛选板块 范围"）：
  // 行式布局「下限值【滑块】上限值」，数值贴滑块两端；可禁用（min = max）。
  // 用两个原生 range 叠加实现双柄，避免引入未落地的 shadcn Slider 依赖。
  //
  // 三个坑，别再踩回去：
  // 1. 轨道（track）是死区：input 必须 pointer-events:none 才能让中层的柄各
  //    自可点，代价是整条轨道事件全穿透 → 用户点/拖轨道毫无反应。
  //    故这里自己在容器上做指针处理：按下点离哪个柄近就拖哪个，并在拖动
  //    期间接管 pointermove（setPointerCapture）。
  // 2. Firefox 不认 ::-webkit-slider-thumb，必须另写 ::-moz-range-thumb，
  //    否则 thumb 不但 pointer-events 继承 none 拖不动，连样子都画不出来。
  // 3. 拖动路径上不得有任何 transition（填充条/thumb），否则快速拖动视觉跟不上。
  import { cn } from '$lib/utils';

  interface Props {
    min: number;
    max: number;
    value: [number, number];
    /** 处于完整区间（未生效）时数值回落 muted。 */
    active?: boolean;
    disabled?: boolean;
    /** 值 → 显示文本（如字节数转人类可读）。 */
    format?: (v: number) => string;
    onChange?: (v: [number, number]) => void;
  }

  let {
    min,
    max,
    value,
    active = false,
    disabled = false,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  /** 柄直径（px）：与样式里的 size-[18px] 保持一致，轨道取值换算要用。 */
  const THUMB = 18;

  let span = $derived(Math.max(1, max - min));
  let loPct = $derived(((value[0] - min) / span) * 100);
  let hiPct = $derived(((value[1] - min) / span) * 100);
  let valueCls = $derived(
    cn(
      'shrink-0 whitespace-nowrap tabular-nums transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
      active ? 'text-primary' : 'text-muted-foreground',
      disabled && 'opacity-50',
    ),
  );

  /**
   * 两端数值列宽，单位 ch：把取值范围内所有可能出现的格式化文本扫一遍取最长者。
   * 配等宽字体后 1ch = 1 字符，列宽贴合到字符级 ——
   * 拖动时文本在 "1.7 MB" ↔ "837.2 KB" 之间变宽变窄也不会回流推移轨道，
   * 又不像固定 rem 列宽那样在 "-1 / 1" 这类短数值上留一大片空白。
   * 注意：ch 取的是**使用该属性这个元素**（下面的 grid 容器）的字体，
   * 所以 font-mono 必须挂在容器上，挂在数值 span 上量出来的宽度会差 1.5 倍。
   */
  let labelCols = $derived.by(() => {
    const steps = 96;
    let n = 1;
    for (let i = 0; i <= steps; i++) {
      const t = format(Math.round(min + (span * i) / steps));
      if (t.length > n) n = t.length;
    }
    return n;
  });

  // 两个柄共用一套样式类（原生 input 本体不吃指针，只留柄可点）
  const rangeCls = cn(
    'pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent',
    // WebKit / Blink
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-[18px]',
    '[&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0',
    '[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md',
    '[&::-webkit-slider-thumb]:shadow-primary/40',
    '[&::-webkit-slider-thumb]:active:cursor-grabbing',
    // Firefox：没有这段柄既看不见也拖不动（pointer-events 是继承属性）
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-[18px]',
    '[&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:appearance-none',
    '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0',
    '[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-md',
    '[&::-moz-range-track]:appearance-none [&::-moz-range-track]:bg-transparent',
    '[&::-moz-range-progress]:appearance-none [&::-moz-range-progress]:bg-transparent',
  );

  function setLo(e: Event) {
    const el = e.target as HTMLInputElement;
    const lo = Math.min(Number(el.value), value[1]);
    // 钳制后强制写回：原生 thumb 视觉位置由浏览器管理，受控值不变时
    // Svelte 不会重设 value，thumb 会停在越界位置（视觉上越过右柄）
    el.value = String(lo);
    if (lo !== value[0]) onChange?.([lo, value[1]]);
  }
  function setHi(e: Event) {
    const el = e.target as HTMLInputElement;
    const hi = Math.max(Number(el.value), value[0]);
    el.value = String(hi);
    if (hi !== value[1]) onChange?.([value[0], hi]);
  }

  // ---- 轨道直接拖（原生柄之外的整条轨道） ------------------------------------
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let dragKey = $state<'lo' | 'hi' | null>(null);

  function valueFromEvent(e: PointerEvent): number {
    if (!trackEl) return value[0];
    const r = trackEl.getBoundingClientRect();
    const usable = Math.max(1, r.width - THUMB);
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left - THUMB / 2) / usable));
    return Math.round(min + ratio * (max - min));
  }

  function applyValue(v: number) {
    if (dragKey === 'lo') onChange?.([Math.min(v, value[1]), value[1]]);
    else if (dragKey === 'hi') onChange?.([value[0], Math.max(v, value[0])]);
  }

  function onTrackDown(e: PointerEvent) {
    if (disabled) return;
    // 落在柄上的按下交给原生 input（否则会和原生拖动抢，产生跳变）
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const v = valueFromEvent(e);
    dragKey =
      Math.abs(v - value[0]) <= Math.abs(v - value[1]) ? 'lo' : 'hi';
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    applyValue(v);
  }
  function onTrackMove(e: PointerEvent) {
    if (!dragKey) return;
    applyValue(valueFromEvent(e));
  }
  function onTrackUp() {
    dragKey = null;
  }
</script>

<!-- 两端数值列**按字符宽（ch）精确预留**（见 labelCols）：
     列宽恒定 → 拖动时轨道几何静止；又刚好贴合最长文本 → 不留多余空白。 -->
<div
  class={cn(
    'grid items-center gap-2 font-mono text-xs',
    disabled && 'opacity-50',
  )}
  style="grid-template-columns: {labelCols}ch minmax(0, 1fr) {labelCols}ch"
>
  <span class={cn(valueCls, 'text-right')}>{format(value[0])}</span>

  <!-- 双柄：两条 range 叠放，轨道透明、仅露滑块 -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    class={cn(
      'relative h-5 min-w-0 flex-1 touch-none',
      disabled ? 'cursor-default' : 'cursor-pointer',
    )}
    onpointerdown={onTrackDown}
    onpointermove={onTrackMove}
    onpointerup={onTrackUp}
    onpointercancel={onTrackUp}
  >
    <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary/80"></div>
    <div
      class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary/70 to-primary"
      style="left: {loPct}%; right: {100 - hiPct}%"
    ></div>
    <input
      type="range"
      {min}
      {max}
      value={value[0]}
      {disabled}
      class={rangeCls}
      oninput={setLo}
    />
    <input
      type="range"
      {min}
      {max}
      value={value[1]}
      {disabled}
      class={rangeCls}
      oninput={setHi}
    />
  </div>

  <!-- 两端数值都右对齐：列宽是按「该行可能出现的最长文本」留的（如热度区间
       -1~1 两头都可能是 "-1" = 2 字符），若右侧用默认左对齐，显示 "1" 时
       只占 1 字符、剩下那一个字符的空档就顶在面板右边缘（真出过）。
       右对齐后短文本的空档落在轨道一侧，与 grid gap 融为一体。 -->
  <span class={cn(valueCls, 'text-right')}>{format(value[1])}</span>
</div>
