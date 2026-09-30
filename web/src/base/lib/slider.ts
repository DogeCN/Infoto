export type RangeScale = 'linear' | 'logarithmic';

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeRangeValue(
  value: number,
  min: number,
  max: number,
  scale: RangeScale = 'linear',
): number {
  if (max <= min) return 0;
  const clamped = Math.min(max, Math.max(min, value));
  if (scale === 'linear') return clamp01((clamped - min) / (max - min));

  const domainStart = Math.log1p(Math.max(0, min));
  const domainLength = Math.log1p(Math.max(0, max)) - domainStart;
  if (domainLength <= 0) return 0;
  return clamp01((Math.log1p(Math.max(0, clamped)) - domainStart) / domainLength);
}

export function mapRangeValue(
  position: number,
  min: number,
  max: number,
  scale: RangeScale = 'linear',
): number {
  if (max <= min) return Math.round(min);
  const t = clamp01(position);
  if (scale === 'linear') {
    return Math.round(min + t * (max - min));
  }

  const domainStart = Math.log1p(Math.max(0, min));
  const value = Math.expm1(domainStart + t * (Math.log1p(Math.max(0, max)) - domainStart));
  return Math.round(Math.min(max, Math.max(min, value)));
}

export const THUMB = 18;

/** Thumb center along the track's usable travel. */
export function thumbCenter(position: number): string {
  return `calc(${THUMB / 2}px + ${position * 100}% - ${position * THUMB}px)`;
}

/** Keep the value bubble inside the track while its caret follows the thumb. */
export function bubblePosition(position: number, bubbleWidth: number, trackWidth: number) {
  const center = THUMB / 2 + position * Math.max(0, trackWidth - THUMB);
  if (!trackWidth || !bubbleWidth) return { left: center - bubbleWidth / 2, tip: bubbleWidth / 2 };
  const left = Math.min(
    Math.max(center - bubbleWidth / 2, 0),
    Math.max(0, trackWidth - bubbleWidth),
  );
  const tip = Math.min(Math.max(center - left, 6), Math.max(6, bubbleWidth - 6));
  return { left, tip };
}

/** Pointer position normalized to thumb-center travel. */
export function pointerPosition(clientX: number, rect: { left: number; width: number }): number {
  return clamp01((clientX - rect.left - THUMB / 2) / Math.max(1, rect.width - THUMB));
}

/** Align a value to a step anchored at the lower bound. */
export function stepValue(position: number, min: number, max: number, step: number): number {
  const offset = clamp01(position) * Math.max(0, max - min);
  const value = min + (step > 0 ? Math.round(offset / step) * step : offset);
  return Math.min(max, Math.max(min, Number(value.toFixed(6))));
}
