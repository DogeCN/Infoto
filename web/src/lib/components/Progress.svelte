<script lang="ts">
  import { clamp01 } from '$base/lib/num';
  interface Props {
    value: number;
    label: string;
    class?: string;
  }

  let { value, label, class: className = '' }: Props = $props();
  let fraction = $derived(clamp01(value));
  let percentage = $derived(Math.round(fraction * 100));
</script>

<div
  role="progressbar"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={percentage}
  aria-valuetext={`${percentage}%`}
  class="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/15 {className}"
>
  <div
    class="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-exit)] ease-[var(--ease-exit)]"
    style={`width: ${percentage}%`}
  ></div>
</div>
