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

// `:::vote` parsing — a pure, DOM-free helper. Only the first `:::vote` block is
// used: the data model keeps a single per-user vote per announcement, so an
// announcement has at most one vote.

/** Vote options with surrounding Markdown for inline placement. */
export interface SplitVote {
  options: string[];
  /** Markdown preceding the vote directive. */
  before: string;
  /** Markdown after the `:::vote` line. Later `:::vote` lines stay here as plain text. */
  after: string;
}

function extractVoteLine(contentMd: string): { options: string[]; index: number } {
  const lines = contentMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].trim().match(/^:::vote\s*(.*)$/);
    if (!m) continue;
    const options: string[] = [];
    for (const part of m[1].split('|')) {
      const s = part.trim();
      if (s) options.push(s);
    }
    return { options, index: i };
  }
  return { options: [], index: -1 };
}

export function splitVote(contentMd: string): SplitVote {
  const { options, index } = extractVoteLine(contentMd);
  if (index < 0) return { options: [], before: contentMd, after: '' };
  const lines = contentMd.split(/\r?\n/);
  return {
    options,
    before: lines.slice(0, index).join('\n'),
    after: lines.slice(index + 1).join('\n'),
  };
}
