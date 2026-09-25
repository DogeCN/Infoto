export type RangeScale = 'linear' | 'logarithmic';

export type RangeThumb = 'lo' | 'hi';

export function clampNormalized(value: number): number {
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

export function normalizedRangeGap(
  min: number,
  max: number,
  scale: RangeScale,
  visualGap: number,
): number {
  if (max <= min) return clampNormalized(visualGap);
  const oneUnit =
    scale === 'linear'
      ? 1 / (max - min)
      : Math.abs(
          normalizeRangeValue(min + 1, min, max, scale) - normalizeRangeValue(min, min, max, scale),
        );
  return clampNormalized(Math.max(visualGap, oneUnit));
}

export function constrainNormalizedRange(
  lo: number,
  hi: number,
  minimumGap: number,
  active: RangeThumb,
): [number, number] {
  let nextLo = clampNormalized(lo);
  let nextHi = clampNormalized(hi);
  const gap = clampNormalized(minimumGap);
  if (nextHi - nextLo >= gap) return [nextLo, nextHi];

  if (active === 'lo') nextLo = Math.max(0, nextHi - gap);
  else nextHi = Math.min(1, nextLo + gap);
  return [nextLo, nextHi];
}

export function stepRangePositionByValue(
  position: number,
  min: number,
  max: number,
  scale: RangeScale,
  direction: -1 | 1,
): number {
  const current = mapRangeValue(position, min, max, scale);
  const next = Math.min(max, Math.max(min, current + direction));
  return normalizeRangeValue(next, min, max, scale);
}
