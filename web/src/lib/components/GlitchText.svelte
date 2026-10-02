<script lang="ts">
  // Glitching display type: the text resolves from scrambled glyphs, then settles.
  // Hovering triggers a short burst. Palette stays inside the project's cyan ramp.
  import { onMount } from 'svelte';

  interface Props {
    text: string;
    size?: string;
  }

  let { text, size = 'clamp(7rem, 20vw, 14rem)' }: Props = $props();

  /** Tick between scramble characters, characters resolved per tick, idle burst period. */
  const SCRAMBLE_TICK_MS = 30;
  const RESOLVE_PER_TICK = 1 / 3;
  const BURST_IDLE_MS = 3000;
  const BURST_IDLE_CHANCE = 0.7;
  /** How long the burst ramp lasts; the echoes animate freely after it. */
  const BURST_MS = 400;

  let display = $state('');
  let burstActive = $state(false);
  let scrambleTimer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    display = text;
  });

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  /** Resolve each character over `RESOLVE_PER_TICK` ticks; spaces stay put. */
  function scramble(): void {
    if (scrambleTimer !== null) clearInterval(scrambleTimer);
    let resolved = 0;
    scrambleTimer = setInterval(() => {
      display = [...text]
        .map((char, index) => {
          if (char === ' ' || index < resolved) return char;
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join('');
      resolved += RESOLVE_PER_TICK;
      if (resolved >= text.length) {
        clearInterval(scrambleTimer!);
        scrambleTimer = null;
        display = text;
      }
    }, SCRAMBLE_TICK_MS);
  }

  onMount(() => {
    scramble();
    // An occasional idle burst so the effect keeps breathing without interaction.
    const bursts = setInterval(() => {
      if (Math.random() > BURST_IDLE_CHANCE) burst();
    }, BURST_IDLE_MS);
    return () => {
      clearInterval(bursts);
      if (scrambleTimer !== null) clearInterval(scrambleTimer);
    };
  });

  function burst(): void {
    burstActive = true;
    setTimeout(() => (burstActive = false), BURST_MS);
  }
</script>

<div
  class="glitch"
  style="font-size: {size}; --glitch-burst: {burstActive ? BURST_MS + 'ms' : '0ms'}"
  role="img"
  aria-label={text}
  onmouseenter={burst}
>
  <span class="layer main">{display}</span>
  <span class="layer echo echo-a">{display}</span>
  <span class="layer echo echo-b">{display}</span>
</div>

<style>
  .glitch {
    position: relative;
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

  .main {
    position: relative;
    z-index: 3;
    color: var(--color-primary);
    text-shadow:
      0 0 10px color-mix(in srgb, var(--color-primary) 65%, transparent),
      0 0 22px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  /* The two echoes are the same cyan at different alphas: the depth reads as channel
     separation without introducing a hue the palette does not define. */
  .echo {
    mix-blend-mode: screen;
  }

  /* The two echoes share one slice keyframe family but run on different periods, so they
     never realign; the burst collapses the slice to a fixed offset for its duration. */
  .echo-a {
    z-index: 2;
    opacity: 0.75;
    color: var(--color-foreground);
    animation:
      slice-a 2s steps(2) infinite,
      jitter-a 0.35s steps(2) infinite;
  }

  .echo-b {
    z-index: 1;
    opacity: 0.55;
    color: var(--color-primary);
    animation:
      slice-b 2.7s steps(2) infinite,
      jitter-b 0.4s steps(2) infinite;
  }

  .glitch:hover .echo-a {
    animation-duration: var(--glitch-burst), 0.35s;
  }

  .glitch:hover .echo-b {
    animation-duration: var(--glitch-burst), 0.4s;
  }

  @keyframes slice-a {
    0%,
    100% {
      clip-path: inset(15% 0 70% 0);
    }
    25% {
      clip-path: inset(65% 0 15% 0);
    }
    50% {
      clip-path: inset(35% 0 50% 0);
    }
    75% {
      clip-path: inset(75% 0 8% 0);
    }
  }

  @keyframes slice-b {
    0%,
    100% {
      clip-path: inset(68% 0 15% 0);
    }
    25% {
      clip-path: inset(15% 0 65% 0);
    }
    50% {
      clip-path: inset(52% 0 32% 0);
    }
    75% {
      clip-path: inset(8% 0 78% 0);
    }
  }

  @keyframes jitter-a {
    0%,
    100% {
      transform: translate(-2px, 0);
    }
    40% {
      transform: translate(-6px, 1px) skewX(-3deg);
    }
    70% {
      transform: translate(4px, 0);
    }
  }

  @keyframes jitter-b {
    0%,
    100% {
      transform: translate(2px, 0);
    }
    40% {
      transform: translate(6px, -1px) skewX(3deg);
    }
    70% {
      transform: translate(-4px, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .echo {
      display: none;
    }
  }
</style>
