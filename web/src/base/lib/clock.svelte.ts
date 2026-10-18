// One ticking clock shared by every relative-time label.

/** Epoch millis, refreshed while at least one label holds the clock. */
let now = $state(Date.now());
let holders = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** The current reading. Reading it inside a `$derived` subscribes that computation. */
export function clockNow(): number {
  return now;
}

/**
 * Hold the shared clock for a component's lifetime. The first holder starts the 30-second
 * tick, the last one stops it; every label therefore updates on the same tick instead of
 * owning an interval of its own.
 */
export function holdClock(): () => void {
  holders += 1;
  if (holders === 1) {
    now = Date.now();
    timer = setInterval(() => (now = Date.now()), 30_000);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
