export const toastOptions = {
  style: [
    // Surface and border use site tokens; richColors' four states tint only the
    // border and icon colors
    '--normal-bg: var(--color-popover)',
    '--normal-bg-hover: var(--color-surface-top)',
    '--normal-border: var(--color-border)',
    '--normal-border-hover: var(--color-primary)',
    '--normal-text: var(--color-foreground)',
    '--success-bg: var(--color-popover)',
    '--success-border: rgba(16, 185, 129, 0.45)',
    '--success-text: var(--color-success)',
    '--info-bg: var(--color-popover)',
    '--info-border: rgba(34, 211, 238, 0.45)',
    '--info-text: var(--color-primary)',
    '--warning-bg: var(--color-popover)',
    '--warning-border: rgba(245, 158, 11, 0.45)',
    '--warning-text: var(--color-warning)',
    '--error-bg: var(--color-popover)',
    '--error-border: rgba(244, 63, 94, 0.45)',
    '--error-text: var(--color-destructive)',
    '--border-radius: 14px',
    '--width: min(20rem, calc(100vw - 2rem))',
    'padding: 11px 14px',
    'font-family: "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif',
    'box-shadow: var(--shadow-lg)',
    'backdrop-filter: blur(12px)',
  ].join(';'),
} as const;
