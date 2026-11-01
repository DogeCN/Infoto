<script lang="ts">
  // The admin row's copy control: one owner for "copy this, then confirm in place".
  //
  // Both the poll list and the feedback list copy a string out of a row, and a copy has no
  // visible result of its own — nothing changes on screen, so the button has to say so. The
  // confirmation is the glyph itself: the copy icon fades out and a check fades in inside the
  // same grid cell, so the button never moves or resizes. It is deliberately NOT the button's
  // `active` treatment: `active` means "this control is engaged", and a copy that succeeded
  // once is not engagement.
  //
  // A shared component rather than twice-written logic, because the two lists had already
  // drifted — the feedback row confirmed in place while the poll row only fired a toast, so
  // the same action looked different depending on which tab you were on.
  import { onDestroy } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Check, Copy } from '@lucide/svelte';
  import { copyToClipboard } from '$base/lib/clipboard';
  import TooltipIconButton from '$lib/components/TooltipIconButton.svelte';

  interface Props {
    /** The text written to the clipboard. */
    value: string;
    /** Tooltip while idle. */
    text: string;
    /** Tooltip while the check is showing. */
    copiedText: string;
    ariaLabel?: string;
    disabled?: boolean;
    /** Wording for the failure toast; the caller owns it because the two lists differ. */
    failedText: string;
  }

  let { value, text, copiedText, ariaLabel, disabled = false, failedText }: Props = $props();

  /** How long the confirmation shows before the glyph fades back. */
  const COPIED_HOLD_MS = 1600;

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));

  async function copy(): Promise<void> {
    if (!(await copyToClipboard(value))) {
      toast.error(failedText);
      return;
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), COPIED_HOLD_MS);
  }
</script>

<TooltipIconButton
  text={copied ? copiedText : text}
  {ariaLabel}
  class="p-2"
  {disabled}
  onclick={() => void copy()}
>
  <span class="grid size-4 place-items-center">
    <Copy
      class="col-start-1 row-start-1 size-4 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {copied
        ? 'opacity-0'
        : 'opacity-100'}"
    />
    <Check
      class="col-start-1 row-start-1 size-4 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {copied
        ? 'opacity-100'
        : 'opacity-0'}"
    />
  </span>
</TooltipIconButton>
