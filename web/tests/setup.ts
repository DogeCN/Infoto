// Use English copy deterministically in unit tests.
if (typeof navigator !== 'undefined') {
  try {
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  } catch {
    /* navigator.languages is read-only in some runtimes; the env already resolves non-zh */
  }
}
