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
    if (!target) return;
    setLocale(target);
    onChange?.(target);
  }
</script>

<button
  type="button"
  aria-label={label}
  title={label || copy.settings.language}
  aria-pressed={current === 'zh-CN'}
  disabled={!target}
  class="inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 {variant ===
  'settings'
    ? 'size-9 bg-secondary hover:bg-secondary/80'
    : 'p-2 hover:bg-card'}"
  onclick={toggle}
>
  <Icon class={variant === 'settings' ? 'size-4' : 'size-[calc(var(--bar-h)*0.3125)]'} />
</button>
