<script lang="ts">
  // 卡片预览 Lightbox（spec: "卡片预览（Lightbox）"）。
  // 不用 shadcn Dialog —— 焦点陷阱与 inert 会干扰手势事件冒泡。纯 div 全屏层。
  //
  // 手势层复刻 v1 交互（直接写 DOM transform 保证跟手）：
  //   左滑喜欢 / 右滑不喜欢（完成后自动下一张）/ 下滑下载 / 上滑弹出 ActionSheet；
  //   拖动中四向提示圈按位移比例淡入放大；松手未过阈值弹回。
  //   双击缩放、双指捏合、Ctrl+滚轮缩放；缩放态拖动 = 平移（clamp）。
  //   单击切页已砍掉（底栏切换胶囊承担，避免双击判定引入的延迟与误触）。
  import type { Photo } from "$shared/types";
  import {
    X,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Copy,
    Link2,
    Share2,
    Search,
    ThumbsUp,
    ThumbsDown,
    Flag,
    Trash2,
    Download,
    VolumeX,
    Volume2,
  } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import { proxyUrl } from "../../../core/id36";
  import { humanSize } from "$base/lib/format";
  import ActionSheet from "./ActionSheet.svelte";

  interface Props {
    photos: Photo[];
    currentIndex: number;
    selfId?: number;
    open: boolean;
    onClose?: () => void;
    onNavigate?: (index: number) => void;
    onLike?: (photo: Photo) => void;
    onDislike?: (photo: Photo) => void;
    onRequestDelete?: (photo: Photo) => void;
    onDelete?: (photo: Photo) => void;
    onDownload?: (photo: Photo) => void;
  }

  let {
    photos,
    currentIndex,
    selfId = -1,
    open = $bindable(false),
    onClose,
    onNavigate,
    onLike,
    onDislike,
    onRequestDelete,
    onDelete,
    onDownload,
  }: Props = $props();

  /** 方向手势阈值（px）。 */
  const SWIPE_THRESHOLD = 60;
  /** 缩放下限 / 上限。 */
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  let showMenu = $state(false);
  let volumeMuted = $state(true);

  let photo = $derived(photos[currentIndex]);
  let isLiked = $derived(photo?.likes.includes(selfId) ?? false);
  let isDisliked = $derived(photo?.dislikes.includes(selfId) ?? false);
  let isReported = $derived(photo?.reports.includes(selfId) ?? false);
  /** 左下角显示的时间（年–月–日 时:分）。 */
  let createdLabel = $derived(
    photo
      ? new Date(photo.createdAt).toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
  );
  let origin = $derived(
    typeof window === "undefined" ? "" : window.location.origin,
  );

  // ---- 手势状态（非响应式：pointermove 高频，直接写 DOM 才跟手） ----------------
  let stageEl = $state<HTMLElement | undefined>(undefined);
  let wrapEl = $state<HTMLElement | undefined>(undefined);

  let scale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let dragging = false;
  let panning = false;
  let gestureMoved = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  const active = new Map<number, { x: number; y: number }>();
  let downPoint = { x: 0, y: 0 };

  /** 拖动方向提示（响应式：仅这两个值走渲染管线）。 */
  let gestureDir = $state<null | "left" | "right" | "up" | "down">(null);
  let gestureRatio = $state(0);

  function applyWrap(dx = 0, dy = 0, animate = false): void {
    if (!wrapEl) return;
    wrapEl.style.transition = animate
      ? "transform var(--duration-exit) var(--ease-exit)"
      : "none";
    wrapEl.style.transform = `translate(${zoomX + dx}px, ${zoomY + dy}px) scale(${scale})`;
  }

  function resetZoom(animate = false): void {
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    applyWrap(0, 0, animate);
  }

  /** 缩放态平移钳制：媒体边缘不越过视口中心。 */
  function clampPan(): void {
    if (!stageEl) return;
    const maxX = ((scale - 1) * stageEl.clientWidth) / 2;
    const maxY = ((scale - 1) * stageEl.clientHeight) / 2;
    zoomX = Math.min(maxX, Math.max(-maxX, zoomX));
    zoomY = Math.min(maxY, Math.max(-maxY, zoomY));
  }

  function distance(): number {
    const [a, b] = [...active.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    if (showMenu) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 1) {
      dragging = true;
      gestureMoved = false;
      downPoint = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } else if (active.size === 2) {
      // 第二根手指落下：转入捏合，清掉拖动预览
      pinchStartDist = distance();
      pinchStartScale = scale;
      dragging = false;
      gestureDir = null;
      gestureRatio = 0;
      applyWrap();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!active.has(e.pointerId)) return;
    const start = active.get(e.pointerId)!;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (active.size >= 2) {
      // 双指捏合缩放
      const d = distance();
      if (pinchStartDist > 0) {
        scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, (d / pinchStartDist) * pinchStartScale),
        );
        if (scale <= MIN_SCALE + 0.01) {
          zoomX = 0;
          zoomY = 0;
        }
        gestureMoved = true;
        applyWrap();
      }
      return;
    }

    if (!dragging) return;
    if (Math.abs(e.clientX - downPoint.x) > 4 || Math.abs(e.clientY - downPoint.y) > 4)
      gestureMoved = true;

    if (panning || scale > 1.01) {
      // 缩放态：拖动平移（增量式累加，跟随每一次 move）
      panning = true;
      zoomX += dx;
      zoomY += dy;
      clampPan();
      applyWrap();
      return;
    }

    // 未缩放：拖动预览必须相对**按下点**（dx 相对上一次 move 只有几个像素，
    // 画面会几乎不动）
    const previewDx = e.clientX - downPoint.x;
    const previewDy = e.clientY - downPoint.y;
    applyWrap(previewDx, previewDy);
    const ax = Math.abs(previewDx);
    const ay = Math.abs(previewDy);
    const dir = ax > ay ? (previewDx > 0 ? "right" : "left") : previewDy > 0 ? "down" : "up";
    const dist = Math.max(ax, ay);
    if (dist > 10) {
      gestureDir = dir;
      gestureRatio = Math.min(dist / SWIPE_THRESHOLD, 1);
    } else {
      gestureDir = null;
      gestureRatio = 0;
    }
  }

  /** 标记动作统一入口（顶栏图标、键盘、手势共用）。 */
  function toggleLike(): void {
    if (!photo) return;
    onLike?.(photo);
    toast.success(photo.likes.includes(selfId) ? "已标记喜欢" : "已取消喜欢");
  }

  function toggleDislike(): void {
    if (!photo) return;
    onDislike?.(photo);
    toast.success(
      photo.dislikes.includes(selfId) ? "已标记不喜欢" : "已取消不喜欢",
    );
  }

  function toggleReport(): void {
    if (!photo) return;
    onRequestDelete?.(photo);
    // 注意语义方向：reports 里**有**自己 = 现在是「已请求删除」（之前写反了）
    toast.success(photo.reports.includes(selfId) ? "已请求删除" : "已取消请求删除");
  }

  function triggerGesture(dir: "left" | "right" | "up" | "down"): void {
    if (!photo) return;
    applyWrap(0, 0, true);
    if (dir === "left" || dir === "right") {
      if (dir === "left") toggleLike();
      else toggleDislike();
      gestureDir = dir;
      gestureRatio = 1;
      setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
        if (currentIndex < photos.length - 1) onNavigate?.(currentIndex + 1);
      }, 200);
    } else if (dir === "down") {
      onDownload?.(photo);
      toast.success("开始下载");
      gestureDir = dir;
      gestureRatio = 1;
      setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
      }, 250);
    } else {
      showMenu = true;
    }
  }

  function onPointerUp(e: PointerEvent) {
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (active.size < 2) pinchStartDist = 0;
    if (active.size > 0) return; // 多指松开其一，等最后一指

    dragging = false;
    const wasPanning = panning;
    panning = false;

    if (!start) return;
    // 方向判定用相对**按下点**的总位移（与拖动预览一致）
    const dx = e.clientX - downPoint.x;
    const dy = e.clientY - downPoint.y;

    // 缩放态拖动结束：位置已在 clamp 内，就地吸附
    if (wasPanning) {
      applyWrap(0, 0, true);
      return;
    }

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const dist = Math.max(ax, ay);
    if (dist >= SWIPE_THRESHOLD) {
      const dir = ax > ay ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      triggerGesture(dir as "left" | "right" | "up" | "down");
      return;
    }

    // 未过阈值：弹回
    gestureDir = null;
    gestureRatio = 0;
    applyWrap(0, 0, true);
  }

  function onDblClick(): void {
    if (showMenu || gestureMoved) return;
    if (scale > 1.01) resetZoom(true);
    else {
      scale = 2;
      applyWrap(0, 0, true);
    }
  }

  /** 桌面端 Ctrl+滚轮缩放：需 passive:false 才能阻止浏览器页面缩放，用 action 绑定。 */
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - e.deltaY * 0.002));
      if (scale <= MIN_SCALE + 0.01) {
        zoomX = 0;
        zoomY = 0;
      } else {
        clampPan();
      }
      applyWrap();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener("wheel", onWheel);
      },
    };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    // 更多菜单弹出时：任意方向键 / Esc 一律只用来收起菜单，
    // 不允许穿透到底下的手势（否则会一边关菜单一边标记还翻页）。
    // 其它键一并吞掉，避免菜单悬着时照片在背后乱跳。
    if (showMenu) {
      if (e.key === "Escape" || e.key.startsWith("Arrow")) {
        e.preventDefault();
        showMenu = false;
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        onClose?.();
        break;
      // 桌面端方向键 = 左右滑手势：标记同时自动下一张
      case "ArrowLeft":
        triggerGesture("left");
        break;
      case "ArrowRight":
        triggerGesture("right");
        break;
      case "PageUp":
        goPrev();
        break;
      case "PageDown":
        goNext();
        break;
      case "ArrowUp":
        showMenu = true;
        break;
      case "ArrowDown":
        if (photo) onDownload?.(photo);
        break;
      case " ":
        e.preventDefault();
        if (photo?.type === 2) volumeMuted = !volumeMuted;
        break;
      case "Control":
        // 桌面端双击 Ctrl 复原
        if (scale > 1.01) resetZoom(true);
        break;
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      onNavigate?.(currentIndex - 1);
    }
  }
  function goNext() {
    if (currentIndex < photos.length - 1) {
      onNavigate?.(currentIndex + 1);
    }
  }

  // 切换图片：复原变换与静音（wrap 可能未挂载，挂载后由下方 effect 兜底）
  $effect(() => {
    void currentIndex;
    volumeMuted = true;
    gestureDir = null;
    gestureRatio = 0;
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    if (wrapEl) applyWrap();
  });

  // 打开时锁定页面滚动
  $effect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  });

  // ---- 菜单动作 --------------------------------------------------------------

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("复制失败");
    }
  }

  /** 站外分享用代理地址（图床地址不离开元信息与 Worker）。 */
  let shareUrl = $derived(photo ? proxyUrl(origin, photo.id) : "");

  /**
   * 打开过渡：元素在 `{#if open}` 内挂载，若挂载时即带 `.show` 则过渡不播放。
   * 故先以无 `.show` 挂载，下一帧再加类触发 opacity/visibility 过渡。
   */
  let shown = $state(false);
  $effect(() => {
    if (!open) {
      shown = false;
      return;
    }
    const raf = requestAnimationFrame(() => (shown = true));
    return () => cancelAnimationFrame(raf);
  });

  async function share() {
    if (!photo) return;
    if (navigator.share) {
      try {
        await navigator.share({ url: shareUrl });
      } catch {
        /* 用户取消，不提示 */
      }
    } else {
      await copyText(shareUrl, "链接已复制");
    }
    showMenu = false;
  }

</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && photo}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={stageEl}
    class="fixed inset-0 z-70 touch-none bg-black/92 opacity-0 backdrop-blur-[8px] pointer-events-none invisible transition-[opacity,visibility] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:show={shown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDblClick}
    use:wheelZoom
  >
    <!-- 顶栏信息：左上两行裸文字（无底色边框），右上更多/关闭 -->
    <div
      class="absolute inset-x-3 top-3 z-10 flex items-start justify-between md:inset-x-4 md:top-4"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="lb-meta flex items-center gap-3 text-base">
        <span class="tabular-nums text-white/90">{currentIndex + 1} / {photos.length}</span>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isLiked
            ? 'bg-[#f43f5e]/85 text-white'
            : 'text-white/85 hover:bg-white/10'}"
          onclick={toggleLike}
          title={isLiked ? "取消喜欢" : "喜欢"}
        >
          <ThumbsUp class="size-5 {isLiked ? 'fill-current' : 'text-[#f43f5e]'}" />
          <span class="tabular-nums">{photo.likes.length}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isDisliked
            ? 'bg-[#3b82f6]/85 text-white'
            : 'text-white/85 hover:bg-white/10'}"
          onclick={toggleDislike}
          title={isDisliked ? "取消不喜欢" : "不喜欢"}
        >
          <ThumbsDown class="size-5 {isDisliked ? 'fill-current' : 'text-[#3b82f6]'}" />
          <span class="tabular-nums">{photo.dislikes.length}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isReported
            ? 'bg-amber-500/85 text-white'
            : 'text-white/85 hover:bg-white/10'}"
          onclick={toggleReport}
          title={isReported ? "取消请求删除" : "请求删除"}
        >
          <Flag class="size-5 {isReported ? 'fill-current' : 'text-amber-400'}" />
          <span class="tabular-nums">{photo.reports.length}</span>
        </button>
      </div>

      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10"
          onclick={() => (showMenu = true)}
          title="更多"
        >
          <MoreHorizontal class="size-6" />
        </button>
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10"
          onclick={onClose}
          title="关闭"
        >
          <X class="size-6" />
        </button>
      </div>
    </div>

    <!-- 媒体：wrap 的 transform 由手势层直接写 DOM（跟手），不走响应式。
         媒体尺寸必须留出四周余量：仅用 max-h-screen/max-w-full 时，窄屏下
         图片会横向顶满（甚至按原始像素溢出），还会压住顶栏与底栏信息。 -->
    <div class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        bind:this={wrapEl}
        class="flex max-w-full select-none items-center justify-center will-change-transform"
      >
        {#if photo.type !== 0}
          <!-- type=1（无音轨 WebM 动图）与 type=2（含音轨视频）都走 video -->
          <video
            src={photo.url}
            class="lb-media"
            draggable="false"
            muted={volumeMuted}
            loop
            autoplay
            playsinline
          ></video>
        {:else}
          <img src={photo.url} alt="" class="lb-media" draggable="false" />
        {/if}
      </div>
    </div>

    <!-- 方向手势提示圈（v1 交互）：拖动时按比例淡入放大 -->
    {#if gestureDir}
      {#if gestureDir === "left"}
        <div
          class="pointer-events-none absolute left-10 top-1/2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-[#f43f5e] backdrop-blur-sm md:left-16"
          style="opacity: {gestureRatio}; transform: translateY(-50%) scale({0.8 + gestureRatio * 0.4})"
        >
          <ThumbsUp class="size-6" />
        </div>
      {:else if gestureDir === "right"}
        <div
          class="pointer-events-none absolute right-10 top-1/2 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-[#3b82f6] backdrop-blur-sm md:right-16"
          style="opacity: {gestureRatio}; transform: translateY(-50%) scale({0.8 + gestureRatio * 0.4})"
        >
          <ThumbsDown class="size-6" />
        </div>
      {:else if gestureDir === "up"}
        <div
          class="pointer-events-none absolute left-1/2 top-20 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
          style="opacity: {gestureRatio}; transform: translateX(-50%) scale({0.8 + gestureRatio * 0.4})"
        >
          <MoreHorizontal class="size-6" />
        </div>
      {:else}
        <div
          class="pointer-events-none absolute bottom-28 left-1/2 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-success backdrop-blur-sm"
          style="opacity: {gestureRatio}; transform: translateX(-50%) scale({0.8 + gestureRatio * 0.4})"
        >
          <Download class="size-6" />
        </div>
      {/if}
    {/if}

    <!-- 视频音量按钮（type=2，Lightbox 内 2.4rem） -->
    {#if photo.type === 2}
      <button
        type="button"
        class="absolute bottom-24 right-5 z-10 flex items-center justify-center rounded-full text-white/75 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 md:right-6"
        style="width: 2.4rem; height: 2.4rem"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => (volumeMuted = !volumeMuted)}
        title={volumeMuted ? "取消静音" : "静音"}
      >
        {#if volumeMuted}
          <VolumeX class="size-5 text-amber-500" />
        {:else}
          <Volume2 class="size-5" />
        {/if}
      </button>
    {/if}

    <!-- 底栏信息：左下尺寸/大小，右下前后切换 -->
    <div
      class="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between md:inset-x-4 md:bottom-4"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="lb-meta space-y-0.5 text-xs text-white/65">
        <div class="tabular-nums">
          {photo.width}×{photo.height} {humanSize(photo.size)}
        </div>
        <div class="tabular-nums text-white/55">{createdLabel}</div>
      </div>

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
          disabled={currentIndex === 0}
          onclick={goPrev}
          title="上一张"
        >
          <ChevronLeft class="size-6" />
        </button>
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
          disabled={currentIndex === photos.length - 1}
          onclick={goNext}
          title="下一张"
        >
          <ChevronRight class="size-6" />
        </button>
      </div>
    </div>
    </div>

  <!-- 更多菜单（底部 ActionSheet） -->
  <ActionSheet
    bind:open={showMenu}
    onClose={() => (showMenu = false)}
  >
    <div class="grid grid-cols-3 gap-3">
      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          void copyText(photo.url, "原图地址已复制");
          showMenu = false;
        }}
      >
        <Copy class="size-6" />
        <span class="text-sm">复制原图</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          void copyText(shareUrl, "链接已复制");
          showMenu = false;
        }}
      >
        <Link2 class="size-6" />
        <span class="text-sm">复制链接</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={share}
      >
        <Share2 class="size-6" />
        <span class="text-sm">分享</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-primary transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          window.open(
            `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(shareUrl)}`,
            "_blank",
          );
          showMenu = false;
        }}
      >
        <Search class="size-6" />
        <span class="text-sm">谷歌搜图</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-amber-500 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          onRequestDelete?.(photo);
          showMenu = false;
        }}
      >
        <Flag class="size-6" />
        <span class="text-sm">{isReported ? "取消删除" : "请求删除"}</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-success transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-success/10"
        onclick={() => {
          onDownload?.(photo);
          showMenu = false;
        }}
      >
        <Download class="size-6" />
        <span class="text-sm">下载</span>
      </button>

      {#if selfId === 0}
        <button
          type="button"
          class="flex flex-col items-center gap-2 rounded-xl p-4 text-destructive transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-destructive/10"
          onclick={() => {
            onDelete?.(photo);
            showMenu = false;
          }}
        >
          <Trash2 class="size-6" />
          <span class="text-sm">删除</span>
        </button>
      {/if}
    </div>
  </ActionSheet>
{/if}

<style>
  .lb-meta {
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
  }

  /*
   * 媒体定尺：纵向留出顶栏/底栏空间，横向留边（窄屏也留出系统边缘手势区）。
   * 之前只用 max-h-screen + max-w-full：max-w-full 相对的是宽度不确定的
   * flex 容器，窄屏下会退化成"按原始像素溢出"，看起来就是顶满整屏。
   */
  .lb-media {
    max-width: calc(100vw - 2.5rem);
    max-height: calc(100dvh - 8rem);
    border-radius: 14px;
    object-fit: contain;
  }

  @media (min-width: 768px) {
    .lb-media {
      max-width: calc(100vw - 8rem);
      max-height: calc(100dvh - 9rem);
    }
  }

  .show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
</style>
