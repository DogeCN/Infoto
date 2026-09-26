// Force an English locale for the unit suite so the en-default copy (the source
// locale) is exercised deterministically, regardless of the host Node's
// navigator.languages (which defaults to ['zh-CN'] on some builds). The browser
// still resolves the real locale from navigator.languages at runtime.
if (typeof navigator !== 'undefined') {
  try {
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  } catch {
    /* navigator.languages is read-only in some runtimes; the env already resolves non-zh */
  }
}
