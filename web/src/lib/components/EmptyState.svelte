<script lang="ts">
  // Unified empty state: centered graphic plus one sentence, with an optional secondary hint.
  // An explicit icon wins; otherwise the gradient illustration renders (one of the two sanctioned
  // gradient uses). The gradient id is unique per instance, so coexisting states cannot collide.
  import type { Component } from 'svelte';

  interface Props {
    text: string;
    hint?: string;
    icon?: Component;
    /** Render the gradient illustration when no icon is given. */
    illustration?: boolean;
    class?: string;
  }

  let { text, hint, icon: Icon, illustration = true, class: className = '' }: Props = $props();

  const gradId = `empty-grad-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div
  class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center {className}"
  style="animation: fadeInUp var(--duration-enter) var(--ease-enter) both"
>
  {#if Icon}
    <div class="mb-3 text-muted-foreground/60">
      <Icon class="size-12" />
    </div>
  {:else if illustration}
    <svg
      class="mb-3 size-24 text-muted-foreground/60"
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.05" />
        </linearGradient>
      </defs>
      <rect x="14" y="20" width="68" height="56" rx="10" fill="url(#{gradId})" />
      <rect
        x="14"
        y="20"
        width="68"
        height="56"
        rx="10"
        stroke="#22d3ee"
        stroke-opacity="0.25"
        stroke-width="1.5"
      />
      <circle cx="38" cy="42" r="6" stroke="#22d3ee" stroke-opacity="0.5" stroke-width="2" />
      <path
        d="M22 66l16-16 12 10 10-8 14 14"
        stroke="#22d3ee"
        stroke-opacity="0.4"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {/if}
  <p class="text-lg font-medium tracking-[-0.02em] text-foreground/85">{text}</p>
  {#if hint}
    <p class="text-sm text-muted-foreground">{hint}</p>
  {/if}
</div>
