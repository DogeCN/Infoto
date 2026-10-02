import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class lists, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Inline-font buttons cluster in one horizontal group. */
export const ICON_GROUP = 'flex shrink-0 items-center gap-1';

/** The site's font stack. `app.css` declares the same list on `body`. */
const FONT_STACK = '"Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif';

/** Toast surface tokens. Rich-colour states tint only their border and icon, never the panel. */
function tint(token: string): string {
  return `color-mix(in srgb, ${token} 45%, transparent)`;
}

export const toastOptions = {
  style: [
    '--normal-bg: var(--color-popover)',
    '--normal-bg-hover: var(--color-surface-top)',
    '--normal-border: var(--color-border)',
    '--normal-border-hover: var(--color-primary)',
    '--normal-text: var(--color-foreground)',
    '--success-bg: var(--color-popover)',
    `--success-border: ${tint('var(--color-success)')}`,
    '--success-text: var(--color-success)',
    '--info-bg: var(--color-popover)',
    `--info-border: ${tint('var(--color-primary)')}`,
    '--info-text: var(--color-primary)',
    '--warning-bg: var(--color-popover)',
    `--warning-border: ${tint('var(--color-warning)')}`,
    '--warning-text: var(--color-warning)',
    '--error-bg: var(--color-popover)',
    `--error-border: ${tint('var(--color-destructive)')}`,
    '--error-text: var(--color-destructive)',
    '--border-radius: var(--radius-card)',
    '--width: min(20rem, calc(100vw - 2rem))',
    'padding: 11px 14px',
    `font-family: ${FONT_STACK}`,
    'box-shadow: var(--shadow-lg)',
    'backdrop-filter: blur(12px)',
  ].join(';'),
} as const;
