// Poll rules shared by both runtimes: the option list accepted on the wire, and the
// whole-line reference that the Markdown renderer and the translation segmenter must
// recognise identically.

import { MAX_POLL_OPTION_CHARS, MAX_POLL_OPTIONS } from './types.ts';

/**
 * A poll's option list: two or more entries, at most `MAX_POLL_OPTIONS`, each non-empty and
 * within `MAX_POLL_OPTION_CHARS`. Entries are trimmed. A non-string entry rejects the whole
 * list instead of being dropped, because an option's position is the address a vote stores.
 */
export function parsePollOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 2 || raw.length > MAX_POLL_OPTIONS) return null;
  const options: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return null;
    const option = entry.trim();
    if (!option || option.length > MAX_POLL_OPTION_CHARS) return null;
    options.push(option);
  }
  return options;
}

/**
 * A whole-line `::poll:<locale>:<id>` reference, with the locale tag and numeric id captured.
 * Whether the tag is registered and the id representable is each caller's own rule: the
 * renderer resolves a reference and needs both, while the segmenter only has to keep the line
 * out of the model's reach.
 */
export const POLL_REFERENCE = /^\s*::poll:([A-Za-z][A-Za-z0-9-]*):(\d+)\s*$/;
