/**
 * Clipboard write, shared by every copy control.
 *
 * Returns whether the write succeeded so the caller can pick its own success and failure
 * labels; this stays in the base layer, which may not depend on the copy tables.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
