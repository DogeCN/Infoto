<script lang="ts">
  import { ALargeSmall, Languages } from '@lucide/svelte';
  import type { LocaleCode } from '$shared/types';
  import { copy, getLocale, LOCALE_OPTIONS, setLocale } from '$lib/i18n.svelte';

  interface Props {
    variant?: 'settings' | 'topbar';
    onChange?: (locale: LocaleCode) => void;
  }

  let { variant = 'settings', onChange }: Props = $props();
  let current = $derived(getLocale());
  let Icon = $derived(current === 'zh-CN' ? Languages : ALargeSmall);
  let target = $derived(LOCALE_OPTIONS.find((option) => option.code !== current)?.code);
  let label = $derived(
    target === 'zh-CN' ? copy.settings.switchToChinese : copy.settings.switchToEnglish,
  );

  function toggle(): void {
    // Capture the target BEFORE setLocale: target is a $derived off the live locale, so
    // reading it again after the switch re-evaluates against the new locale and hands
    // onChange the one we just left — the content view then lags the UI by one toggle.
    const next = target;
    if (!next) return;
    setLocale(next);
    onChange?.(next);
  }
</script>

<button
  type="button"
  aria-label={label}
  title={label || copy.settings.language}
  aria-pressed={current === 'zh-CN'}
  disabled={!target}
  class="{variant === 'settings'
    ? 'inline-flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-secondary/80'
    : 'icon-button shrink-0 p-2'} {variant === 'topbar' ? 'disabled:pointer-events-none' : ''}"
  onclick={toggle}
>
  <Icon class={variant === 'settings' ? 'size-4' : 'size-[var(--bar-icon)]'} />
</button>
