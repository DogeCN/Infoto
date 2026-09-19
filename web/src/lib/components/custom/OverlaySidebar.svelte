<script lang="ts">
  // 弹出式侧边栏（spec: "侧边栏"）。悬浮于主内容之上 + 遮罩，不改变主内容宽度，
  // 因此瀑布流无需因开合重算布局。桌面端可拖动内缘调整宽度（持久化到 localStorage），
  // 移动端（< 768px）占满屏宽、不提供拖拽。
  import type { Snippet } from "svelte";
  import { X } from "@lucide/svelte";

  let {
    side = "left",
    open = $bindable(false),
    title = "",
    icon,
    children,
  }: {
    side?: "left" | "right";
    open?: boolean;
    title?: string;
    icon?: Snippet;
    children?: Snippet;
  } = $props();

  const MIN_W = 280;
  const MAX_W = 720;
  const DEFAULT_W = 360;
  // side 是响应式 prop，key 必须派生而非顶层常量
  let storageKey = $derived(`infoto-sidebar-width-${side}`);

  function clamp(w: number): number {
    const viewportMax =
      typeof window === "undefined"
        ? MAX_W
        : Math.max(MIN_W, window.innerWidth - 48);
    return Math.round(Math.min(MAX_W, viewportMax, Math.max(MIN_W, w)));
  }

  function loadWidth(key: string): number {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return clamp(Number(raw));
    } catch {}
    return DEFAULT_W;
  }

  let width = $state(DEFAULT_W);
  let dragging = $state(false);

  // 挂载后再读 localStorage / 视口宽度，避免首帧用错值
  $effect(() => {
    width = loadWidth(storageKey);
  });

  /** 拖动内缘：左侧栏向右拖变宽，右侧栏向左拖变宽。 */
  function startResize(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startW = width;
    const sign = side === "left" ? 1 : -1;
    const onMove = (ev: PointerEvent) => {
      width = clamp(startW + (ev.clientX - startX) * sign);
    };
    const onUp = () => {
      dragging = false;
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onResizeKey(e: KeyboardEvent) {
    const sign = side === "left" ? 1 : -1;
    if (e.key === "ArrowLeft") width = clamp(width - 16 * sign);
    else if (e.key === "ArrowRight") width = clamp(width + 16 * sign);
    else return;
    e.preventDefault();
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {}
  }

  function close() {
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- 遮罩自顶栏下沿开始：顶栏保持可见可点（图标高亮态可见，再次点击即关闭） -->
  <div
    class="fixed inset-x-0 bottom-0 top-14 z-[45] bg-black/50 backdrop-blur-sm md:top-16"
    role="presentation"
    onclick={close}
  ></div>
{/if}

<aside
  class="fixed top-0 z-50 flex h-full w-full flex-col border-border bg-card transition-transform duration-300 ease-in-out md:w-[var(--sidebar-w)]"
  class:left-0={side === "left"}
  class:right-0={side === "right"}
  class:translate-x-0={open}
  class:-translate-x-full={side === "left" && !open}
  class:translate-x-full={side === "right" && !open}
  style="--sidebar-w: {width}px"
>
  <!-- 拖动内缘调整宽度（桌面端）。button 承载交互语义，键盘左右方向键可调整。 -->
  <button
    type="button"
    aria-label="调整侧栏宽度"
    title="拖动调整宽度"
    class="absolute inset-y-0 hidden w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 md:block {dragging
      ? 'bg-primary/60'
      : ''} {side === 'left' ? 'right-0' : 'left-0'}"
    onpointerdown={startResize}
    onkeydown={onResizeKey}
  ></button>

  <div class="flex items-center justify-between border-b border-border p-4">
    <div class="flex items-center gap-2">
      {#if icon}
        {@render icon()}
      {/if}
      <h2 class="text-lg font-semibold">{title}</h2>
    </div>
    <button
      class="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      onclick={close}
      title="关闭"
    >
      <X class="size-5" />
    </button>
  </div>

  <!-- 内容区独立滚动；min-h-0 让子内容的 h-full / sticky 底栏有确定高度。
       dragging 时禁用选中，避免拖动中选中文本 -->
  <div
    class="min-h-0 flex-1 overflow-y-auto p-4"
    style="user-select: {dragging ? 'none' : 'auto'}"
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
</aside>
