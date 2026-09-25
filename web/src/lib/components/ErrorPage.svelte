<script lang="ts">
  import { AlertTriangle, ServerCrash } from '@lucide/svelte';

  interface Props {
    code?: number;
    message?: string;
  }

  let { code = 404, message }: Props = $props();

  let displayMessage = $derived(
    message ?? (code === 404 ? '页面未找到' : code >= 500 ? '服务器错误' : '请求失败'),
  );
</script>

<div
  class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-8 text-center"
>
  <!-- 故障爆发时的红色暗角 -->
  <div
    class="pointer-events-none fixed inset-0 z-0 motion-safe:animate-[danger-flash_3s_linear_infinite]"
    style="background: radial-gradient(ellipse at center, rgba(239,68,68,0) 45%, rgba(239,68,68,0.3) 100%); opacity: 0;"
    aria-hidden="true"
  ></div>

  <div
    class="relative z-10 mb-6 motion-safe:animate-[glitch-in_.7s_cubic-bezier(.16,.84,.24,1)_both]"
  >
    <div class="relative motion-safe:animate-[glitch-shake_3s_linear_infinite]">
      <span
        class="relative block select-none text-[8rem] font-black leading-none text-foreground/10 motion-safe:animate-[glitch-base_3s_linear_infinite]"
      >
        {code}
      </span>
      <span
        class="absolute inset-0 block select-none pointer-events-none motion-safe:animate-[glitch-top_3s_linear_infinite]"
        style="color: #ef4444; clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%); transform: translate(-2px, -1px); opacity: 0.75"
        aria-hidden="true"
      >
        {code}
      </span>
      <span
        class="absolute inset-0 block select-none pointer-events-none motion-safe:animate-[glitch-bottom_3s_linear_infinite]"
        style="color: #06b6d4; clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%); transform: translate(2px, 1px); opacity: 0.75"
        aria-hidden="true"
      >
        {code}
      </span>
      <!-- 白光撕裂条 -->
      <span
        class="absolute inset-0 block select-none pointer-events-none motion-safe:animate-[glitch-tear_3s_linear_infinite]"
        style="color: #ffffff; clip-path: polygon(0 44%, 100% 44%, 100% 56%, 0 56%); opacity: 0; text-shadow: 0 0 20px rgba(255,255,255,0.7);"
        aria-hidden="true"
      >
        {code}
      </span>
    </div>
  </div>

  <div
    class="relative z-10 mb-6 flex items-center gap-2 text-muted-foreground motion-safe:animate-[msg-flicker_3s_linear_infinite]"
  >
    {#if code >= 500}
      <ServerCrash class="size-5" />
    {:else}
      <AlertTriangle class="size-5" />
    {/if}
    <p class="text-lg">{displayMessage}</p>
  </div>

  <a
    href="/"
    class="relative z-10 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
  >
    返回首页
  </a>
</div>

<style>
  /* 入场：放大 + 倾斜 + 模糊，猛击定格 */
  @keyframes glitch-in {
    0% {
      opacity: 0;
      transform: scale(1.8) skewX(18deg);
      filter: blur(12px);
    }
    10% {
      opacity: 1;
      transform: scale(1.45) skewX(-14deg);
      filter: blur(5px);
    }
    25% {
      transform: scale(1.2) skewX(9deg);
      filter: blur(2px);
    }
    45% {
      transform: scale(1.06) skewX(-4deg);
      filter: blur(0);
    }
    65% {
      transform: scale(1.02) skewX(1.5deg);
    }
    100% {
      opacity: 1;
      transform: scale(1) skewX(0deg);
      filter: blur(0);
    }
  }

  /* 主体：爆发时掉帧 + 红蓝重影 */
  @keyframes glitch-base {
    0%,
    80%,
    100% {
      opacity: 1;
      text-shadow: none;
      transform: translate(0, 0);
    }
    82% {
      opacity: 0.75;
      text-shadow: 5px 0 rgba(239, 68, 68, 0.8), -5px 0 rgba(6, 182, 212, 0.8);
      transform: translate(1px, 0);
    }
    84% {
      opacity: 1;
      text-shadow: -8px 0 rgba(239, 68, 68, 0.9), 8px 0 rgba(6, 182, 212, 0.9);
      transform: translate(-2px, 1px);
    }
    86% {
      opacity: 0.6;
      text-shadow: 9px 0 rgba(239, 68, 68, 0.7), -9px 0 rgba(6, 182, 212, 0.7);
      transform: translate(2px, -1px);
    }
    88% {
      opacity: 1;
      text-shadow: -4px 0 rgba(239, 68, 68, 0.8), 4px 0 rgba(6, 182, 212, 0.8);
    }
    92% {
      opacity: 1;
      text-shadow: none;
      transform: translate(0, 0);
    }
  }

  /* 红色切片：平时静止，80% 后横向撕裂 + 斜切，切片位置不断跳动 */
  @keyframes glitch-top {
    0%,
    80%,
    100% {
      clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
      transform: translate(-2px, -1px) skewX(0deg);
    }
    81% {
      clip-path: polygon(0 4%, 100% 4%, 100% 34%, 0 34%);
      transform: translate(-16px, 3px) skewX(-12deg);
    }
    83% {
      clip-path: polygon(0 16%, 100% 16%, 100% 56%, 0 56%);
      transform: translate(18px, -4px) skewX(10deg);
    }
    85% {
      clip-path: polygon(0 0, 100% 0, 100% 22%, 0 22%);
      transform: translate(-20px, 2px) skewX(-8deg);
    }
    87% {
      clip-path: polygon(0 28%, 100% 28%, 100% 70%, 0 70%);
      transform: translate(14px, -3px) skewX(6deg);
    }
    89% {
      clip-path: polygon(0 8%, 100% 8%, 100% 40%, 0 40%);
      transform: translate(-10px, 4px);
    }
    92% {
      clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
      transform: translate(4px, -1px);
    }
  }

  /* 青色切片：反方向撕裂 */
  @keyframes glitch-bottom {
    0%,
    80%,
    100% {
      clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%);
      transform: translate(2px, 1px) skewX(0deg);
    }
    82% {
      clip-path: polygon(0 62%, 100% 62%, 100% 96%, 0 96%);
      transform: translate(16px, -3px) skewX(12deg);
    }
    84% {
      clip-path: polygon(0 46%, 100% 46%, 100% 84%, 0 84%);
      transform: translate(-18px, 4px) skewX(-10deg);
    }
    86% {
      clip-path: polygon(0 72%, 100% 72%, 100% 100%, 0 100%);
      transform: translate(20px, -2px) skewX(8deg);
    }
    88% {
      clip-path: polygon(0 38%, 100% 38%, 100% 78%, 0 78%);
      transform: translate(-14px, 3px) skewX(-6deg);
    }
    90% {
      clip-path: polygon(0 58%, 100% 58%, 100% 92%, 0 92%);
      transform: translate(10px, -4px);
    }
    93% {
      clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%);
      transform: translate(-4px, 1px);
    }
  }

  /* 中央白光条：爆发瞬间横向闪过 */
  @keyframes glitch-tear {
    0%,
    80%,
    100% {
      opacity: 0;
      transform: translateX(0);
    }
    82% {
      opacity: 0.95;
      transform: translateX(-24px);
    }
    84% {
      opacity: 0.2;
      transform: translateX(20px);
    }
    86% {
      opacity: 0.9;
      transform: translateX(-12px);
    }
    90% {
      opacity: 0;
      transform: translateX(0);
    }
  }

  /* 整体硬震动 */
  @keyframes glitch-shake {
    0%,
    80%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    81% {
      transform: translate(-8px, 5px) rotate(-1deg);
    }
    82.5% {
      transform: translate(9px, -4px) rotate(0.9deg);
    }
    84.5% {
      transform: translate(-11px, -3px) rotate(-0.7deg);
    }
    86.5% {
      transform: translate(7px, 5px) rotate(0.6deg);
    }
    88.5% {
      transform: translate(-5px, 2px) rotate(-0.3deg);
    }
    91% {
      transform: translate(3px, -2px) rotate(0.15deg);
    }
    94% {
      transform: translate(0, 0) rotate(0deg);
    }
  }

  /* 红色暗角随爆发闪烁 */
  @keyframes danger-flash {
    0%,
    79%,
    100% {
      opacity: 0;
    }
    82% {
      opacity: 1;
    }
    84% {
      opacity: 0.25;
    }
    86% {
      opacity: 1;
    }
    90% {
      opacity: 0.15;
    }
    93% {
      opacity: 0;
    }
  }

  /* 提示文案同步掉帧 */
  @keyframes msg-flicker {
    0%,
    80%,
    100% {
      opacity: 1;
    }
    83% {
      opacity: 0.2;
    }
    85% {
      opacity: 1;
    }
    87% {
      opacity: 0.5;
    }
    90% {
      opacity: 1;
    }
  }
</style>
