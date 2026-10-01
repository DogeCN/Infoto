<script lang="ts">
  import { Languages, Type } from '@lucide/svelte';
  import { copy, getLocale, setLocale } from '$lib/i18n.svelte';
  import Tooltip from './Tooltip.svelte';

  interface Props {
    iconClass?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
  }

  let { iconClass = 'size-4', side = 'bottom' }: Props = $props();
  let locale = $derived(getLocale());
  let label = $derived(
    locale === 'zh-CN' ? copy.settings.switchToEnglish : copy.settings.switchToChinese,
  );

  function toggle(): void {
    setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN');
  }
</script>

<Tooltip text={label} {side}>
  <button
    type="button"
    class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={label}
    aria-pressed={locale === 'zh-CN'}
    title={label}
    onclick={toggle}
  >
    {#if locale === 'zh-CN'}
      <Languages class={iconClass} aria-hidden="true" />
    {:else}
      <Type class={iconClass} aria-hidden="true" />
    {/if}
  </button>
</Tooltip>
