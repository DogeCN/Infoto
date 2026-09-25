<script lang="ts">
  import { AlertTriangle, ServerCrash } from '@lucide/svelte';

  interface Props {
    code?: number;
    message?: string;
  }

  let { code = 404, message }: Props = $props();

  let displayMessage = $derived(message ?? (code === 404 ? '页面未找到' : code >= 500 ? '服务器错误' : '请求失败'));
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
  <div class="relative mb-6">
    <span
      class="text-[8rem] font-black leading-none text-foreground/10 select-none block"
      style="font-family: 'Space Grotesk', sans-serif"
    >
      {code}
    </span>
    <span
      class="absolute inset-0 text-[8rem] font-black leading-none select-none pointer-events-none block
        motion-safe:animate-[glitch_2s_steps(2)_infinite]"
      style="font-family: 'Space Grotesk', sans-serif; color: #ef4444; clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%); transform: translate(-2px, -1px); opacity: 0.7"
      aria-hidden="true"
    >
      {code}
    </span>
    <span
      class="absolute inset-0 text-[8rem] font-black leading-none select-none pointer-events-none block
        motion-safe:animate-[glitch_2s_steps(2)_infinite_reverse]"
      style="font-family: 'Space Grotesk', sans-serif; color: #06b6d4; clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%); transform: translate(2px, 1px); opacity: 0.7"
      aria-hidden="true"
    >
      {code}
    </span>
  </div>

  <div class="mb-6 flex items-center gap-2 text-muted-foreground">
    {#if code >= 500}
      <ServerCrash class="size-5" />
    {:else}
      <AlertTriangle class="size-5" />
    {/if}
    <p class="text-lg">{displayMessage}</p>
  </div>

  <a
    href="/"
    class="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-md shadow-primary/25 transition-all duration-200 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98]"
  >
    返回首页
  </a>
</div>

<style>
  @keyframes glitch {
    0%, 100% { transform: translate(-2px, -1px); }
    50% { transform: translate(2px, 1px); }
  }
  @keyframes glitch_reverse {
    0%, 100% { transform: translate(2px, 1px); }
    50% { transform: translate(-2px, -1px); }
  }
</style>
