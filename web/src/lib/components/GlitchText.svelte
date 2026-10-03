<script lang="ts">
  // Glitching display type: the text resolves from scrambled glyphs, then settles.
  // Hovering triggers a short burst. Palette stays inside the project's cyan ramp.
  //
  // The visual layer stack is not defined here — it lives in `src/shared/glitch.ts`, which
  // the Worker's standalone error page inlines because it cannot render a component. This
  // component injects that same stylesheet and supplies only the JS half: the scramble, the
  // idle burst and the hover trigger, none of which the Worker page can have.
  import { onMount } from 'svelte';
  import { GLITCH_CSS } from '$shared/glitch.ts';

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

  /** Add the shared glyph stylesheet once per document; the Worker page inlines the same text. */
  function injectGlitchCss(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gf-glitch-css')) return;
    const style = document.createElement('style');
    style.id = 'gf-glitch-css';
    style.textContent = GLITCH_CSS;
    document.head.appendChild(style);
  }

  // Injected during component init rather than in `onMount`: the three layers are stacked
  // by absolute positioning, so a frame that paints before the sheet arrives shows them
  // overlapping inline. Component init still runs before the browser's first paint, and it
  // costs nothing extra — the stylesheet is ~4 KB added once per document.
  injectGlitchCss();

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
  class="gf"
  class:gf-burst={burstActive}
  style="font-size: {size}"
  role="img"
  aria-label={text}
  onmouseenter={burst}
>
  <span class="gf-layer gf-main">{display}</span>
  <span class="gf-layer gf-echo gf-echo-a">{display}</span>
  <span class="gf-layer gf-echo gf-echo-b">{display}</span>
</div>
