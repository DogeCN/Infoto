export type RangeScale = 'linear' | 'logarithmic';

function clampNormalized(value: number): number {
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
  if (scale === 'linear') return clampNormalized((clamped - min) / (max - min));

  const domainStart = Math.log1p(Math.max(0, min));
  const domainLength = Math.log1p(Math.max(0, max)) - domainStart;
  if (domainLength <= 0) return 0;
  return clampNormalized((Math.log1p(Math.max(0, clamped)) - domainStart) / domainLength);
}

export function mapRangeValue(
  position: number,
  min: number,
  max: number,
  scale: RangeScale = 'linear',
): number {
  if (max <= min) return Math.round(min);
  const t = clampNormalized(position);
  if (scale === 'linear') {
    return Math.round(min + t * (max - min));
  }

  const domainStart = Math.log1p(Math.max(0, min));
  const value = Math.expm1(domainStart + t * (Math.log1p(Math.max(0, max)) - domainStart));
  return Math.round(Math.min(max, Math.max(min, value)));
}
