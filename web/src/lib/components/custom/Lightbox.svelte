<script lang="ts">
  // 卡片预览 Lightbox（spec: "卡片预览（Lightbox）"）。
  // 不用 shadcn Dialog —— 焦点陷阱与 inert 会干扰手势事件冒泡。纯 div 全屏层。
  // 手势：左滑喜欢 / 右滑不喜欢 / 下滑下载 / 上滑弹出 ActionSheet；
  //       单击左右半区切上下一张；缩放态下四向滑动不触发方向手势。
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
  import { proxyUrl, toId36 } from "../../../core/id36";
  import { extOfType, humanSize } from "$base/lib/format";
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
    onUnmark?: (photo: Photo) => void;
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
    onUnmark,
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
  let scale = $state(1);
  let translateX = $state(0);
  let translateY = $state(0);
  /** 拖动手势进行中的实时位移（仅用于视觉反馈）。 */
  let dragDx = $state(0);
  let dragDy = $state(0);
  let dragging = $state(false);

  let photo = $derived(photos[currentIndex]);
  let isLiked = $derived(photo?.likes.includes(selfId) ?? false);
  let isDisliked = $derived(photo?.dislikes.includes(selfId) ?? false);
  let isReported = $derived(photo?.reports.includes(selfId) ?? false);
  /** 进入变换态（缩放或平移）后，四向滑动不再触发方向手势。 */
  let transformed = $derived(scale > 1 || translateX !== 0 || translateY !== 0);
  let origin = $derived(
    typeof window === "undefined" ? "" : window.location.origin,
  );

  function resetTransform() {
    scale = 1;
    translateX = 0;
    translateY = 0;
  }

  function goPrev() {
    if (currentIndex > 0) {
      onNavigate?.(currentIndex - 1);
      resetTransform();
    }
  }
  function goNext() {
    if (currentIndex < photos.length - 1) {
      onNavigate?.(currentIndex + 1);
      resetTransform();
    }
  }

  /** 双击放大 / 复原（桌面端 Ctrl 双击等价）。 */
  function toggleZoom() {
    if (scale > 1) resetTransform();
    else scale = 2;
  }

  // ---- 手势 ------------------------------------------------------------------

  const active = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let gestureMoved = false;

  function distance(): number {
    const [a, b] = [...active.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMoved = false;
    if (active.size === 2) {
      pinchStartDist = distance();
      pinchStartScale = scale;
    } else if (active.size === 1) {
      dragging = true;
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!active.has(e.pointerId)) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (active.size >= 2) {
      // 双指捏合缩放
      const d = distance();
      if (pinchStartDist > 0) {
        scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, (d / pinchStartDist) * pinchStartScale),
        );
        gestureMoved = true;
      }
      return;
    }

    const start = active.get(e.pointerId)!;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) gestureMoved = true;

    if (transformed) {
      // 变换态：拖动平移画面，不触发方向手势
      translateX += dx;
      translateY += dy;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    dragDx = dx;
    dragDy = dy;
  }

  function onPointerUp(e: PointerEvent) {
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (active.size < 2) pinchStartDist = 0;
    if (active.size === 0) dragging = false;

    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragDx = 0;
    dragDy = 0;

    if (transformed) return; // 变换态不判方向手势

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (Math.max(adx, ady) < SWIPE_THRESHOLD) {
      // 未达阈值：视为单击 → 左半区上一张 / 右半区下一张
      if (!gestureMoved && photo) {
        const half = window.innerWidth / 2;
        if (e.clientX < half) goPrev();
        else goNext();
      }
      return;
    }

    if (adx >= ady) {
      // 水平滑动：左滑喜欢 / 右滑不喜欢，完成后自动切下一张
      if (dx < 0) {
        onLike?.(photo!);
        toast.success("已标记喜欢");
      } else {
        onDislike?.(photo!);
        toast.success("已标记不喜欢");
      }
      goNext();
    } else if (dy > 0) {
      // 下滑下载
      onDownload?.(photo!);
    } else {
      // 上滑弹出更多菜单
      showMenu = true;
    }
  }

  function onWheel(e: WheelEvent) {
    // 桌面端滚轮缩放
    e.preventDefault();
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - e.deltaY * 0.002));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    switch (e.key) {
      case "Escape":
        onClose?.();
        break;
      case "ArrowLeft":
      case "PageUp":
        goPrev();
        break;
      case "ArrowRight":
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
        if (transformed) resetTransform();
        break;
    }
  }

  // 打开时锁定页面滚动
  $effect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  });

  // 切换图片时复原变换与静音
  $effect(() => {
    void currentIndex;
    resetTransform();
    volumeMuted = true;
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
    class="fixed inset-0 z-70 bg-black/92 backdrop-blur-[8px] opacity-0 visibility-hidden pointer-events-none transition-[opacity,visibility] duration-[280ms] ease-linear"
    class:show={shown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
  >
    <!-- 顶栏 -->
    <div
      class="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-border bg-popover/80 px-4 py-3 backdrop-blur-xl"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
        onclick={onClose}
        title="关闭"
      >
        <X class="size-5" />
      </button>

      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground"
        >
          {photo.width}×{photo.height}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground"
        >
          {humanSize(photo.size)}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground"
        >
          {new Date(photo.createdAt).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>

      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
        onclick={() => (showMenu = true)}
        title="更多"
      >
        <MoreHorizontal class="size-5" />
      </button>
    </div>

    <!-- 媒体 -->
    <div
      class="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <div
        class="flex items-center justify-center transition-transform duration-150"
        style="transform: translate({translateX + dragDx}px, {translateY +
          dragDy}px) scale({scale})"
      >
        {#if photo.type !== 0}
          <!-- type=1（无音轨 WebM 动图）与 type=2（含音轨视频）都走 video -->
          <video
            src={photo.url}
            class="max-h-screen max-w-full object-contain"
            muted={volumeMuted}
            loop
            autoplay
            playsinline
          ></video>
        {:else}
          <img
            src={photo.url}
            alt=""
            class="max-h-screen max-w-full object-contain"
          />
        {/if}
      </div>
    </div>

    <!-- 视频音量按钮（type=2，Lightbox 内 2.4rem） -->
    {#if photo.type === 2}
      <button
        type="button"
        class="absolute bottom-24 right-6 z-10 flex items-center justify-center rounded-full border border-white/15 bg-[rgba(10,14,26,0.55)] text-white/70 backdrop-blur-[4px] transition-all hover:bg-cyan-500/20 hover:text-cyan-400 hover:scale-105"
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

    <!-- 底栏 -->
    <div
      class="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between border-t border-border bg-popover/80 px-4 py-3 backdrop-blur-xl"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        disabled={currentIndex === 0}
        onclick={goPrev}
        title="上一张"
      >
        <ChevronLeft class="size-5" />
      </button>

      <span class="text-sm text-muted-foreground">
        {currentIndex + 1} / {photos.length}
      </span>

      <button
        type="button"
        class="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        disabled={currentIndex === photos.length - 1}
        onclick={goNext}
        title="下一张"
      >
        <ChevronRight class="size-5" />
      </button>
    </div>
  </div>

  <!-- 更多菜单（底部 ActionSheet） -->
  <ActionSheet
    bind:open={showMenu}
    onClose={() => (showMenu = false)}
    title="更多操作"
  >
    <div class="grid grid-cols-3 gap-3">
      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors hover:bg-muted"
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
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors hover:bg-muted"
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
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors hover:bg-muted"
        onclick={share}
      >
        <Share2 class="size-6" />
        <span class="text-sm">分享</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-primary transition-colors hover:bg-muted"
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
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors hover:bg-muted {isLiked ||
        isDisliked
          ? 'text-amber-500'
          : 'text-muted-foreground'}"
        disabled={!isLiked && !isDisliked}
        onclick={() => {
          onUnmark?.(photo);
          showMenu = false;
        }}
      >
        <ThumbsUp class="size-6" />
        <span class="text-sm">取消标记</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-amber-500 transition-colors hover:bg-muted"
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
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors hover:bg-muted"
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
          class="flex flex-col items-center gap-2 rounded-xl p-4 text-destructive transition-colors hover:bg-destructive/10"
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
  .show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
</style>
