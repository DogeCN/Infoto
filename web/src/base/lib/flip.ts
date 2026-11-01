import { motionEase, motionMs } from './motion.ts';

type Position = Pick<DOMRect, 'left' | 'top'>;
type CancellableAnimation = Pick<Animation, 'cancel'>;

interface FlipElement {
  getBoundingClientRect(): Position;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): CancellableAnimation;
}

export function animateDisplaced<K>(
  first: ReadonlyMap<K, Position>,
  elements: ReadonlyMap<K, FlipElement>,
  movingId: K | null,
  animations: Map<K, CancellableAnimation>,
): void {
  for (const [id, element] of elements) {
    if (id === movingId) continue;
    const previous = first.get(id);
    if (!previous) continue;
    const current = element.getBoundingClientRect();
    const dx = previous.left - current.left;
    const dy = previous.top - current.top;
    const activeAnimation = animations.get(id);
    activeAnimation?.cancel();
    if (activeAnimation) animations.delete(id);
    if (dx === 0 && dy === 0) continue;
    animations.set(
      id,
      element.animate(
        [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: motionMs('exit'), easing: motionEase('exit') },
      ),
    );
  }
}
