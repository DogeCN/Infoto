/**
 * Small runtime guards and JSON helpers shared by the Worker and the browser.
 *
 * Both runtimes parse untrusted bodies and check record shapes, and each was doing it with
 * its own three-line version. These take no locale or copy input, so both halves may import
 * them.
 */

/** True for a plain object; arrays and null are excluded. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse JSON, returning `fallback` when the text is not JSON.
 *
 * HTTP error bodies are frequently empty or HTML, so a failed parse is an expected path
 * rather than an exception.
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
