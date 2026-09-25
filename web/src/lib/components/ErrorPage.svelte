<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    code?: number;
  }

  let { code = 404 }: Props = $props();

  let glitchText = $state('');
  let burstActive = $state(false);
  let glitchInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    glitchText = String(code);
  });

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function randomChar() {
    return chars[Math.floor(Math.random() * chars.length)];
  }

  function triggerGlitch() {
    if (glitchInterval !== null) clearInterval(glitchInterval);
    let iterations = 0;
    glitchInterval = setInterval(() => {
      glitchText = String(code)
        .split('')
        .map((char, index) => {
          if (char === ' ') return char;
          if (index < iterations) return char;
          return randomChar();
        })
        .join('');

      if (iterations >= String(code).length) {
        clearInterval(glitchInterval!);
        glitchInterval = null;
        glitchText = String(code);
      }
      iterations += 1 / 3;
    }, 30);
  }

  function triggerBurst() {
    burstActive = true;
    setTimeout(() => (burstActive = false), 400);
  }

  onMount(() => {
    triggerGlitch();
    const randomBurst = setInterval(() => {
      if (Math.random() > 0.7) triggerBurst();
    }, 3000);

    return () => {
      clearInterval(randomBurst);
      if (glitchInterval !== null) clearInterval(glitchInterval);
    };
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-background">
  <div class="flex flex-col items-center px-8 text-center">
    <div
      class="glitch-container"
      class:burst={burstActive}
      role="img"
      aria-label="错误代码 {code}"
      onmouseenter={triggerBurst}
    >
      <span class="layer layer-main">{glitchText}</span>
      <span class="layer layer-magenta">{glitchText}</span>
      <span class="layer layer-cyan">{glitchText}</span>
    </div>

    <p class="mt-8 text-lg font-medium tracking-widest text-primary">PAGE NOT FOUND</p>
    <p class="mt-2 text-muted-foreground">您访问的页面不存在</p>

    <a
      href="/"
      class="mt-12 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98]"
    >
      返回首页
    </a>
  </div>
</div>

<style>
  .glitch-container {
    position: relative;
    font-size: clamp(7rem, 20vw, 14rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.1em;
    font-family:
      'Inter',
      'Noto Sans SC',
      system-ui,
      -apple-system,
      sans-serif;
    cursor: default;
    user-select: none;
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    pointer-events: none;
  }

  .layer-main {
    position: relative;
    z-index: 3;
    color: #22d3ee;
    text-shadow:
      0 0 20px rgba(34, 211, 238, 0.6),
      0 0 40px rgba(34, 211, 238, 0.3);
  }

  .layer-magenta {
    color: #ff006e;
    opacity: 0.75;
    z-index: 2;
    animation:
      slice-magenta 2s steps(2) infinite,
      jitter-magenta 0.35s steps(2) infinite;
    mix-blend-mode: screen;
  }

  .layer-cyan {
    color: #00f0ff;
    opacity: 0.7;
    z-index: 1;
    animation:
      slice-cyan 2.7s steps(2) infinite,
      jitter-cyan 0.4s steps(2) infinite;
    mix-blend-mode: screen;
  }

  @keyframes slice-magenta {
    0%,
    100% {
      clip-path: inset(15% 0 70% 0);
    }
    11% {
      clip-path: inset(65% 0 15% 0);
    }
    22% {
      clip-path: inset(35% 0 50% 0);
    }
    33% {
      clip-path: inset(75% 0 8% 0);
    }
    44% {
      clip-path: inset(10% 0 75% 0);
    }
    55% {
      clip-path: inset(55% 0 30% 0);
    }
    66% {
      clip-path: inset(25% 0 60% 0);
    }
    77% {
      clip-path: inset(68% 0 18% 0);
    }
    88% {
      clip-path: inset(42% 0 38% 0);
    }
  }

  @keyframes slice-cyan {
    0%,
    100% {
      clip-path: inset(68% 0 15% 0);
    }
    11% {
      clip-path: inset(15% 0 65% 0);
    }
    22% {
      clip-path: inset(52% 0 32% 0);
    }
    33% {
      clip-path: inset(8% 0 78% 0);
    }
    44% {
      clip-path: inset(72% 0 12% 0);
    }
    55% {
      clip-path: inset(28% 0 55% 0);
    }
    66% {
      clip-path: inset(80% 0 5% 0);
    }
    77% {
      clip-path: inset(18% 0 68% 0);
    }
    88% {
      clip-path: inset(45% 0 35% 0);
    }
  }

  @keyframes jitter-magenta {
    0%,
    100% {
      transform: translate(-4px, 0);
    }
    20% {
      transform: translate(-12px, 2px) skewX(-5deg);
    }
    40% {
      transform: translate(6px, -2px);
    }
    60% {
      transform: translate(-10px, 2px) skewX(4deg);
    }
    80% {
      transform: translate(8px, 0);
    }
  }

  @keyframes jitter-cyan {
    0%,
    100% {
      transform: translate(4px, 0);
    }
    20% {
      transform: translate(12px, -2px) skewX(5deg);
    }
    40% {
      transform: translate(-6px, 2px);
    }
    60% {
      transform: translate(10px, -2px) skewX(-4deg);
    }
    80% {
      transform: translate(-8px, 0);
    }
  }

  .glitch-container.burst .layer-magenta {
    animation: burst-magenta 0.4s steps(2) both;
  }
  .glitch-container.burst .layer-cyan {
    animation: burst-cyan 0.4s steps(2) both;
  }

  @keyframes burst-magenta {
    0% {
      transform: translate(-4px, 0);
      clip-path: inset(0 0 0 0);
    }
    15% {
      transform: translate(-40px, 0) skewX(-12deg);
      clip-path: inset(10% 0 70% 0);
    }
    30% {
      transform: translate(35px, 0) skewX(10deg);
      clip-path: inset(60% 0 20% 0);
    }
    45% {
      transform: translate(-32px, 0) skewX(-8deg);
      clip-path: inset(30% 0 50% 0);
    }
    60% {
      transform: translate(38px, 0) skewX(11deg);
      clip-path: inset(75% 0 10% 0);
    }
    75% {
      transform: translate(-20px, 0);
      clip-path: inset(45% 0 35% 0);
    }
    100% {
      transform: translate(-4px, 0);
      clip-path: inset(0 0 0 0);
    }
  }

  @keyframes burst-cyan {
    0% {
      transform: translate(4px, 0);
      clip-path: inset(0 0 0 0);
    }
    15% {
      transform: translate(40px, 0) skewX(12deg);
      clip-path: inset(70% 0 15% 0);
    }
    30% {
      transform: translate(-35px, 0) skewX(-10deg);
      clip-path: inset(20% 0 60% 0);
    }
    45% {
      transform: translate(32px, 0) skewX(8deg);
      clip-path: inset(50% 0 30% 0);
    }
    60% {
      transform: translate(-38px, 0) skewX(-11deg);
      clip-path: inset(10% 0 75% 0);
    }
    75% {
      transform: translate(20px, 0);
      clip-path: inset(35% 0 45% 0);
    }
    100% {
      transform: translate(4px, 0);
      clip-path: inset(0 0 0 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .layer-magenta,
    .layer-cyan {
      animation: none !important;
      display: none;
    }
  }
</style>
