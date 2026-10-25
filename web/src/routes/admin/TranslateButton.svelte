<script lang="ts">
  // The translate control shared by both admin card lists. It names the language it will
  // produce — the one other registered locale — and swaps its glyph for a spinner while that
  // card's request is in flight. Both lists carried a verbatim copy of this markup before.
  import { Languages, LoaderCircle } from '@lucide/svelte';
  import type { LocaleCode } from '$shared/types';
  import { fmt, otherLocale } from '$shared/copy';
  import { copy, LOCALE_OPTIONS } from '$lib/i18n.svelte';
  import TooltipIconButton from '$lib/components/TooltipIconButton.svelte';

  interface Props {
    /** The card's own language; the draft is always written in the other one. */
    locale: LocaleCode;
    /** This card's request is in flight. */
    translating?: boolean;
    /** Another card's request is in flight: one translation at a time. */
    disabled?: boolean;
    onclick: () => void;
  }

  let { locale, translating = false, disabled = false, onclick }: Props = $props();

  const target = $derived(otherLocale(locale));
  const targetLabel = $derived(LOCALE_OPTIONS.find((option) => option.code === target)?.label);
</script>

<TooltipIconButton
  text={translating ? copy.admin.translating : copy.admin.translate}
  ariaLabel={translating
    ? copy.admin.translating
    : targetLabel
      ? fmt(copy.admin.translateTo, { language: targetLabel })
      : copy.admin.translate}
  class="p-2"
  disabled={disabled || !target}
  {onclick}
>
  {#if translating}
    <LoaderCircle class="size-4 animate-spin" />
  {:else}
    <Languages class="size-4" />
  {/if}
</TooltipIconButton>
