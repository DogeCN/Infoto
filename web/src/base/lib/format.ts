// Pure formatting helpers — human-readable byte sizes and zero-padded
// zip-entry names (spec: "下载").

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Human-readable size, binary steps of 1024 — e.g. 1825361101 -> "1.7 GB".
 * Bytes render as integers; larger units keep one decimal (".0" dropped).
 */
export function humanSize(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let i = 0;
  let v = b;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
  return `${s} ${UNITS[i]}`;
}

/**
 * Compact size text for slider labels: same binary steps as `humanSize`, but the
 * mantissa is capped at 3 significant digits so the text never exceeds 7 chars
 * ("99.4 KB"). `humanSize` can emit 9 chars ("1023.1 KB"), and the slider needs a
 * constant-width value column to avoid reflow while dragging.
 */
export function compactSize(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let i = 0;
  let v = b;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  // One more step up when the mantissa would print as 4 integer digits.
  if (Math.round(v * 10) / 10 >= 1000 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
  return `${s} ${UNITS[i]}`;
}

/**
 * Zip entry name for the k-th file (0-based) out of `total`: current sort
 * order index, zero-padded to the digit count of `total`
 * (20 files -> "01"…"20"). Extension decided by media type (0 -> webp).
 */
export function padName(k: number, total: number, ext: string): string {
  const width = String(Math.max(1, Math.floor(total))).length;
  return `${String(k + 1).padStart(width, '0')}.${ext}`;
}

/** File extension implied by photos.type (spec: only webp / webm exist). */
export function extOfType(type: number): 'webp' | 'webm' {
  return type === 0 ? 'webp' : 'webm';
}
