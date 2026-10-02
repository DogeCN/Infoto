<script lang="ts">
  // Pager control, one instance per screen. The off-screen copy rides the sliding track.
  // Rotation follows `screen`, not hover, so the chevron always points at the other screen.
  import { ChevronLeft } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    /** Which screen the bar is showing; 1 rotates the chevron to point back. */
    screen: 0 | 1;
    onToggle?: () => void;
  }

  let { screen, onToggle }: Props = $props();

  const label = $derived(screen === 0 ? copy.topbar.more : copy.topbar.back);
</script>

<button
  type="button"
  class="icon-button shrink-0 p-2"
  onclick={onToggle}
  title={label}
  aria-label={label}
>
  <!-- Shares the track's enter timing, so the chevron turns as the track arrives. -->
  <span
    class="flex transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] {screen ===
    1
      ? 'rotate-180'
      : 'rotate-0'}"
  >
    <!-- ChevronLeft points at screen 1; screen 1's rotation turns it the other way. -->
    <ChevronLeft class="size-[var(--bar-icon)]" />
  </span>
</button>
