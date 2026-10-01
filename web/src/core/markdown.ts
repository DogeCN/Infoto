export interface TextSelection {
  start: number;
  end: number;
}

export interface TextTransform {
  value: string;
  selection: TextSelection;
}

export function normalizeSelection(value: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(value.length, selection.start));
  const end = Math.max(start, Math.min(value.length, selection.end));
  return { start, end };
}

export function wrapSelection(
  value: string,
  selection: TextSelection,
  before: string,
  after: string,
  fallback: string,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const selected = value.slice(range.start, range.end) || fallback;
  return {
    value: value.slice(0, range.start) + before + selected + after + value.slice(range.end),
    selection: {
      start: range.start + before.length,
      end: range.start + before.length + selected.length,
    },
  };
}

export function prefixSelectedLines(
  value: string,
  selection: TextSelection,
  prefix: string,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const start = range.start === 0 ? 0 : value.lastIndexOf('\n', range.start - 1) + 1;
  const selected = value.slice(start, range.end);
  const prefixed = selected
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
  return {
    value: value.slice(0, start) + prefixed + value.slice(range.end),
    selection: {
      start: start + prefix.length,
      end: start + prefixed.length,
    },
  };
}

export function insertMarkdownBlock(
  value: string,
  selection: TextSelection,
  block: string,
  caretOffset = block.length,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const leadingBreak = range.start > 0 && value[range.start - 1] !== '\n' ? '\n' : '';
  const trailingBreak = range.end < value.length && value[range.end] !== '\n' ? '\n' : '';
  const inserted = leadingBreak + block + trailingBreak;
  return {
    value: value.slice(0, range.start) + inserted + value.slice(range.end),
    selection: {
      start: range.start + leadingBreak.length + caretOffset,
      end: range.start + leadingBreak.length + caretOffset,
    },
  };
}

/** Inserts `![alt](url)` at a position clamped to the value. `alt` doubles as the
 *  <video> aria-label once a WebM artifact is rendered, so it is worth passing the
 *  source file name. */
export function insertImageAt(
  value: string,
  position: number,
  url: string,
  alt = '',
): TextTransform {
  const safePosition = Math.max(0, Math.min(value.length, position));
  // Brackets would break the link text; nothing else in Markdown needs escaping here.
  const safeAlt = alt.replace(/[[\]]/g, '');
  const markdown = `![${safeAlt}](${url})`;
  return {
    value: value.slice(0, safePosition) + markdown + value.slice(safePosition),
    selection: {
      start: safePosition + markdown.length,
      end: safePosition + markdown.length,
    },
  };
}

export function mapOffsetThroughEdit(offset: number, before: string, after: string): number {
  if (before === after) return Math.max(0, Math.min(before.length, offset));
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (offset <= prefix) return offset;
  if (offset >= before.length - suffix) {
    return Math.max(0, Math.min(after.length, offset + after.length - before.length));
  }
  return prefix;
}

// Identify animated Markdown media by its WebM path extension.

/** True when the URL points at a WebM artifact (GIF → VP9, or real video). */
export function isAnimatedArtifact(url: string | null | undefined): boolean {
  if (!url) return false;
  let path: string;
  try {
    // Base makes relative/protocol-relative URLs resolvable; query and hash
    // never carry the extension.
    path = new URL(url, 'https://infoto.invalid/').pathname;
  } catch {
    return false;
  }
  return path.toLowerCase().endsWith('.webm');
}

/** Replace sanitized WebM images with video elements, preserving vetted source URLs and alt labels. */
export function upgradeAnimatedMedia(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (!isAnimatedArtifact(src)) continue;
    const video = document.createElement('video');
    video.src = src ?? '';
    video.autoplay = true;
    video.loop = true;
    // Muted autoplay is the only autoplay browsers allow — matches the GIF
    // semantics most announcements want. Click unmutes real video.
    video.muted = true;
    video.playsInline = true;
    video.className = 'markdown-video';
    const alt = img.getAttribute('alt');
    if (alt) video.setAttribute('aria-label', alt);
    video.addEventListener('click', () => {
      video.muted = !video.muted;
      // Unmuting a playing element can pause it in some browsers.
      void video.play().catch(() => undefined);
    });
    img.replaceWith(video);
  }
}

// Vote references are stable IDs owned by the poll manager, never poll content stored in Markdown.
export type MarkdownPollPart = { type: 'markdown'; content: string } | { type: 'poll'; id: number };

/** Split whole-line `::vote:<id>` references from Markdown, preserving every text block. */
export function splitPollReferences(contentMd: string): MarkdownPollPart[] {
  const parts: MarkdownPollPart[] = [];
  const textLines: string[] = [];
  const flushText = () => {
    if (textLines.length > 0) parts.push({ type: 'markdown', content: textLines.join('\n') });
    textLines.length = 0;
  };
  for (const line of contentMd.split(/\r?\n/)) {
    const match = line.match(/^\s*::vote:(\d+)\s*$/);
    const id = match ? Number(match[1]) : NaN;
    if (match && Number.isSafeInteger(id)) {
      flushText();
      parts.push({ type: 'poll', id });
    } else {
      textLines.push(line);
    }
  }
  flushText();
  return parts;
}
