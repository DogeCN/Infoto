<script lang="ts">
  // The top bar's single pager arrow. There are two of these, one per screen, and they
  // share the same component: the one on the visible screen is the control, the other is
  // parked off-bar inside the sliding track.
  //
  // Why one flying control rather than one per screen: the user's brief is that the arrow
  // "flies to the other side and becomes the other arrow" — it must read as a single
  // object that moved, not as two buttons that appeared. The rotation is therefore tied
  // to `screen`, not to hover, and the chevron points *away* from the current screen
  // (right on screen 1, left on screen 2) so it always advertises where a tap goes.
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
  class="flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
  onclick={onToggle}
  title={label}
  aria-label={label}
>
  <!-- Rotation is what makes the flip readable: the track slides with the same
       --duration-enter / --ease-enter, so the chevron turns exactly as it arrives, and
       one control can be read as the same object that moved. -->
  <span
    class="flex transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] {screen ===
    1
      ? 'rotate-180'
      : 'rotate-0'}"
  >
    <!-- ChevronLeft points left, which is where screen 1 lies; on screen 1 the
         rotation above has already turned it, so the mirror is off. -->
    <ChevronLeft class="size-5" />
  </span>
</button>
