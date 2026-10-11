import { isLocaleCode, type LocaleCode } from '$shared/copy';

export interface TextSelection {
  start: number;
  end: number;
}

export interface TextTransform {
  value: string;
  selection: TextSelection;
}

function normalizeSelection(value: string, selection: TextSelection): TextSelection {
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

/** Inserts `[label](url)` at a position clamped to the value — a plain link to the hosted
 *  file, for anything Markdown has no element for. */
export function insertLinkAt(
  value: string,
  position: number,
  url: string,
  label = '',
): TextTransform {
  const safePosition = Math.max(0, Math.min(value.length, position));
  // Brackets would break the link text; nothing else in Markdown needs escaping here.
  const safeLabel = (label || url).replace(/[[\]]/g, '');
  const markdown = `[${safeLabel}](${url})`;
  return {
    value: value.slice(0, safePosition) + markdown + value.slice(safePosition),
    selection: {
      start: safePosition + markdown.length,
      end: safePosition + markdown.length,
    },
  };
}

/** Inserts `![alt](url)` at a position clamped to the value. `alt` doubles as the
 *  <video> aria-label once an animated artifact is rendered, so it is worth passing the
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

// Identify Markdown media by its path extension so `![](url)` renders as the right element.

/** Which element a Markdown `![alt](url)` should become. */
export type MarkdownMediaKind = 'image' | 'video' | 'audio';

const VIDEO_EXTENSIONS = new Set([
  'webm',
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'avi',
  'ogv',
  '3gp',
  'flv',
  'wmv',
  'mpeg',
  'mpg',
  'ts',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aac',
  'weba',
  'wma',
]);
const IMAGE_EXTENSIONS = new Set([
  'webp',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'avif',
  'heic',
  'heif',
  'bmp',
  'svg',
  'ico',
  'jxl',
]);

/** Lowercase path extension of a media URL, or '' when it has none. Query and hash never
 *  carry the extension, and the base makes relative/protocol-relative URLs resolvable. */
function mediaExtension(url: string | null | undefined): string {
  if (!url) return '';
  let path: string;
  try {
    path = new URL(url, 'https://infoto.invalid/').pathname;
  } catch {
    return '';
  }
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * The element a Markdown image URL should render as. The editor uploads any picked file
 * as-is, so an mp4/mp3 arrives here as `![](url.mp4)`.
 */
export function markdownMediaKind(url: string | null | undefined): MarkdownMediaKind {
  const ext = mediaExtension(url);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'image';
}

/** True when Markdown has an element for this URL — an image, a video or a sound file, by
 *  extension. Anything else (a `.pdf`, a `.zip`, an extension-less URL) is **not** media: it
 *  has to land as a link the reader can click instead. */
export function isEmbeddableArtifact(url: string | null | undefined): boolean {
  const ext = mediaExtension(url);
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
}

/** True when a picked File is an image, so the editor can preview it locally and measure it.
 *  A file with no name extension still qualifies on its MIME type — Windows picks often arrive
 *  that way, and refusing to preview them would be worse than the MIME being wrong. */
export function isImageFile(file: { type?: string; name?: string }): boolean {
  if ((file.type || '').toLowerCase().startsWith('image/')) return true;
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function makeMarkdownVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.autoplay = true;
  video.loop = true;
  // Muted autoplay is the only autoplay browsers allow — matches the GIF
  // semantics most announcements want. Click unmutes real video.
  video.muted = true;
  video.playsInline = true;
  video.className = 'markdown-video';
  video.addEventListener('click', () => {
    video.muted = !video.muted;
    // Unmuting a playing element can pause it in some browsers.
    void video.play().catch(() => undefined);
  });
  return video;
}

function makeMarkdownAudio(src: string): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.src = src;
  audio.controls = true;
  audio.className = 'markdown-audio';
  return audio;
}

/** Replace sanitized `![alt](url)` images with the element their extension names: a `<video>`
 *  for a video file, an `<audio>` for a sound file, and a plain `<a download>` link for a file
 *  Markdown has no element for (a PDF, a zip). Real images stay `<img>`. */
export function upgradeMarkdownMedia(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt') ?? '';
    if (!isEmbeddableArtifact(src)) {
      const link = document.createElement('a');
      link.href = src;
      link.className = 'markdown-file';
      link.setAttribute('download', '');
      link.rel = 'noopener noreferrer';
      link.textContent = alt || src;
      img.replaceWith(link);
      continue;
    }
    const kind = markdownMediaKind(src);
    if (kind === 'image') continue;
    const media = kind === 'video' ? makeMarkdownVideo(src) : makeMarkdownAudio(src);
    if (alt) media.setAttribute('aria-label', alt);
    img.replaceWith(media);
  }
}

/**
 * Insert one hosted file into Markdown: an image, a video or a sound file as `![name](url)`
 * so it renders in place, and anything else as `[name](url)` — a link the reader clicks to
 * open or download. The editor takes any file, so a PDF or a zip has to land somewhere
 * sensible, and `upgradeMarkdownMedia` classifies by extension too: the three extension sets
 * are the single source, so what is inserted here is what renders there.
 */
export function insertMediaAt(
  value: string,
  position: number,
  url: string,
  fileName = '',
): TextTransform {
  const renderable = isEmbeddableArtifact(url);
  return renderable
    ? insertImageAt(value, position, url, fileName)
    : insertLinkAt(value, position, url, fileName);
}

// Poll references are stable IDs owned by the poll manager, never poll content stored in Markdown.
export type MarkdownPollPart =
  { type: 'markdown'; content: string } | { type: 'poll'; locale: LocaleCode; id: number };

/**
 * Split whole-line `::poll:<lang>:<id>` references from Markdown, preserving every text block.
 * A line whose language is not a registered locale, whose id is missing, or that uses the
 * `::vote:<id>` form is not a poll reference and stays plain Markdown.
 */
export function splitPollReferences(contentMd: string): MarkdownPollPart[] {
  const parts: MarkdownPollPart[] = [];
  const textLines: string[] = [];
  const flushText = () => {
    if (textLines.length > 0) parts.push({ type: 'markdown', content: textLines.join('\n') });
    textLines.length = 0;
  };
  for (const line of contentMd.split(/\r?\n/)) {
    const match = line.match(/^\s*::poll:([A-Za-z][A-Za-z0-9-]*):(\d+)\s*$/);
    const rawLocale = match ? match[1] : undefined;
    const id = match ? Number(match[2]) : NaN;
    if (match && rawLocale && isLocaleCode(rawLocale) && Number.isSafeInteger(id)) {
      flushText();
      parts.push({ type: 'poll', locale: rawLocale, id });
    } else {
      textLines.push(line);
    }
  }
  flushText();
  return parts;
}
