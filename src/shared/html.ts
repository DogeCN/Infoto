// HTML escaping for the two places that build markup as a string: the Worker's error pages
// and the Markdown media renderer. Both runtimes need the same five characters covered.

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for use in element text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}
