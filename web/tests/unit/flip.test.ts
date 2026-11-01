import { test } from 'vitest';
import assert from 'node:assert/strict';
import { animateDisplaced } from '../../src/base/lib/flip';

test('flip: cancels stale animations and animates displaced inactive items', () => {
  const calls: Array<{
    id: number;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
  }> = [];
  const canceled: number[] = [];
  const created = new Map<number, { cancel(): void }>();

  function target(id: number, left: number, top: number) {
    return {
      getBoundingClientRect: () => ({ left, top }),
      animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        calls.push({ id, keyframes, options });
        const animation = { cancel: () => canceled.push(id) };
        created.set(id, animation);
        return animation;
      },
    };
  }

  const elements = new Map([
    [1, target(1, 0, 10)],
    [2, target(2, 0, 40)],
    [3, target(3, 0, 40)],
    [4, target(4, 0, 80)],
  ]);
  const first = new Map([
    [1, { left: 0, top: 0 }],
    [2, { left: 0, top: 20 }],
    [3, { left: 0, top: 40 }],
  ]);
  const animations = new Map([
    [1, { cancel: () => canceled.push(1) }],
    [2, { cancel: () => canceled.push(2) }],
    [3, { cancel: () => canceled.push(3) }],
    [4, { cancel: () => canceled.push(4) }],
  ]);

  animateDisplaced(first, elements, 1, animations);

  assert.deepEqual(canceled, [2, 3]);
  assert.deepEqual(
    calls.map(({ id, keyframes, options }) => ({ id, keyframes, options })),
    [
      {
        id: 2,
        keyframes: [
          { transform: 'translate3d(0px, -20px, 0)' },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        options: { duration: 160, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)' },
      },
    ],
  );
  assert.equal(animations.has(1), true);
  assert.equal(animations.has(3), false);
  assert.equal(animations.has(4), true);
  assert.equal(animations.get(2), created.get(2));
});
