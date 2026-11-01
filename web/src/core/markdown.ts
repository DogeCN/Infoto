import { isLocaleCode, type LocaleCode } from '$shared/copy';
import { escapeHtml } from '$shared/html';
import { POLL_REFERENCE } from '$shared/poll';
import MarkdownIt from 'markdown-it';
import type { StateCore, RendererRule, StateInline, Token, Delimiter } from 'markdown-it';

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

/** Lowercase extension of a path or file name, or '' when it has none. */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

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
  return fileExtension(path);
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
  return IMAGE_EXTENSIONS.has(fileExtension(file.name || ''));
}

/**
 * The element a hosted file becomes in rendered Markdown: media in place, anything else as a
 * download link. Written as HTML because it is the markdown-it renderer's output — the final
 * element exists before the document sees it, so no placeholder `<img>` ever fetches the file.
 */
export function markdownMediaHtml(src: string, alt: string): string {
  if (!isEmbeddableArtifact(src)) {
    return `<a class="markdown-file" href="${escapeHtml(src)}" download rel="noopener noreferrer">${escapeHtml(alt || src)}</a>`;
  }
  const kind = markdownMediaKind(src);
  const label = alt ? ` aria-label="${escapeHtml(alt)}"` : '';
  if (kind === 'video') {
    // Muted autoplay is the only autoplay browsers allow; a click unmutes in MarkdownView.
    return `<span class="md-media skeleton"><video src="${escapeHtml(src)}" class="markdown-video" autoplay loop muted playsinline${label}></video></span>`;
  }
  if (kind === 'audio') {
    // No aspect-ratio holder: a player is a full-width bar, not a picture.
    return `<audio src="${escapeHtml(src)}" class="markdown-audio" controls${label}></audio>`;
  }
  return `<span class="md-media skeleton"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></span>`;
}

/** markdown-it's `image` rule: `![alt](url)` becomes the element its extension names. */
export type MarkdownImageRule = RendererRule;

export const markdownImageRule: MarkdownImageRule = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!token) return '';
  const rawSrc = token.attrGet('src');
  const src = typeof rawSrc === 'string' ? rawSrc : '';
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  return markdownMediaHtml(src, alt);
};

/**
 * The public renderer's `image` rule: an image is dropped to its alt text.
 *
 * Disabling markdown-it's `image` rule does not remove the syntax — the `link` rule then
 * matches the `[alt](url)` half of `![alt](url)` and the leading `!` survives as literal text,
 * so a public announcement read `!shot`. Replacing the rule keeps the URL out of the document
 * (no request, the point of the disabled rule) while leaving the sentence intact.
 */
export const markdownImageTextRule: MarkdownImageRule = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!token) return '';
  return escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
};

/**
 * markdown-it's built-in `strikethrough` rule, with GFM's one-or-two tilde rule and `<del>`.
 *
 * Two divergences from the bundled rule, both checked against the spec's own examples
 * (<https://github.github.com/gfm/#strikethrough-extension->):
 * - GFM strikes text wrapped in **one or two** tildes; the bundled rule requires two, so
 *   `~there~` stayed literal text.
 * - GFM emits `<del>`; the bundled rule emits `<s>`, which marks strikethrough to a screen
 *   reader as "no longer accurate" rather than as deleted text.
 *
 * Delimiter pairing is deliberately not reimplemented: `balance_pairs` runs before the post
 * process rules and is what matches the pairs, so this rule only emits the delimiter tokens
 * and the post rule only reads the match back out.
 */
export function gfmStrikethroughTokenize(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (silent || state.src.charCodeAt(start) !== 0x7e /* ~ */) return false;

  // `scanDelims(pos, true)` measures the whole tilde run and reports flanking, which is what
  // decides whether this run can open or close a strike.
  const scanned = state.scanDelims(start, true);
  const count = scanned.length;
  // A run of three or more tildes is not a strike (spec example 3). GitHub renders it
  // literally, so consume the whole run as text instead of splitting it into a shorter marker.
  if (count > 2) {
    const text = state.push('text', '', 0);
    text.content = '~'.repeat(count);
    state.pos = start + count;
    return true;
  }

  const marker = '~'.repeat(count);
  const token = state.push('text', '', 0);
  token.content = marker;
  state.delimiters.push({
    marker: 0x7e,
    length: count,
    token: state.tokens.length - 1,
    end: -1,
    open: scanned.can_open,
    close: scanned.can_close,
  });
  state.pos = start + count;
  return true;
}

/** Post-processing half of {@link gfmStrikethroughTokenize}: matched delimiters become `<del>`. */
export function gfmStrikethroughPostProcess(state: StateInline): void {
  const convert = (delimiters: Delimiter[]): void => {
    for (const opener of delimiters) {
      if (opener.marker !== 0x7e || opener.end < 0) continue;
      const closer = delimiters[opener.end];
      if (!closer) continue;
      const open = state.tokens[opener.token];
      const close = state.tokens[closer.token];
      if (!open || !close) continue;
      open.type = 'del_open';
      open.tag = 'del';
      open.nesting = 1;
      open.markup = '~'.repeat(opener.length ?? 2);
      open.content = '';
      close.type = 'del_close';
      close.tag = 'del';
      close.nesting = -1;
      close.markup = '~'.repeat(closer.length ?? 2);
      close.content = '';
    }
  };

  convert(state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) convert(meta.delimiters);
  }
}

/**
 * Insert one hosted file into Markdown: an image, a video or a sound file as `![name](url)`
 * so it renders in place, and anything else as `[name](url)` — a link the reader clicks to
 * open or download. The editor takes any file, so a PDF or a zip has to land somewhere
 * sensible, and `markdownImageRule` classifies by extension too: the three extension sets
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

/** One hosted URL's Markdown line — the same embed-or-link choice `insertMediaAt` makes.
 *  Embeds carry no alt: the browser paints alt as broken-image text while the image decodes
 *  (the single-file insert has the same rule). A link's label is its URL, brackets stripped. */
export function embedLineFor(url: string): string {
  return isEmbeddableArtifact(url) ? `![](${url})` : `[${url.replace(/[[\]]/g, '')}](${url})`;
}

/** Insert a batch of hosted files as **one line per file**, as a single block: a picked set
 *  must never concatenate into one run of media. The caret moves past the whole block. */
export function insertMediaLinesAt(value: string, position: number, urls: string[]): TextTransform {
  const safePosition = Math.max(0, Math.min(value.length, position));
  const leadingBreak = safePosition > 0 && value[safePosition - 1] !== '\n' ? '\n' : '';
  const trailingBreak = safePosition < value.length && value[safePosition] !== '\n' ? '\n' : '';
  const inserted = leadingBreak + urls.map(embedLineFor).join('\n') + trailingBreak;
  return {
    value: value.slice(0, safePosition) + inserted + value.slice(safePosition),
    selection: { start: safePosition + inserted.length, end: safePosition + inserted.length },
  };
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
    const match = line.match(POLL_REFERENCE);
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

/**
 * The extensions this renderer supports on top of markdown-it's CommonMark preset, and the
 * two configurations the app actually uses.
 *
 * One place owns the parser wiring so the page and `markdown.test.ts` render through identical
 * settings: before this, every call site re-listed `html/linkify/breaks` by hand, which is how
 * the public renderer ended up shipping a stray `!` that no test could see.
 *
 * Deliberately absent, with the reason:
 * - footnotes and `> [!NOTE]` alerts are GitHub product features, not part of the GFM spec;
 * - raw HTML is per-configuration, because only the announcement surface has a sanitizer in
 *   front of its output and only that surface is authored by the album's owner.
 */
export interface MarkdownRendererOptions {
  /** Render `![alt](url)` as real media instead of dropping it to its alt text. */
  media: boolean;
  /** Accept raw HTML in the source. Meaningful only behind a sanitizer. */
  html: boolean;
}

/** Announcements and the editor preview: owner-authored, sanitized, media rendered in place. */
export const MARKDOWN_TRUSTED: MarkdownRendererOptions = { media: true, html: true };

/**
 * Public text — a reader's feedback and the admin's copy of it. No raw HTML (a visitor is the
 * author) and no media (an external image host would be fetched on every reader's page).
 */
export const MARKDOWN_PUBLIC: MarkdownRendererOptions = { media: false, html: false };

/**
 * Build a configured markdown-it instance: CommonMark plus the GFM extensions this app
 * implements.
 *
 * `breaks: true` is a deliberate departure from the spec's soft-break rule. GFM's own soft
 * line breaks stay `\n`, but GitHub's *user content* — issues, comments, announcements —
 * hard-breaks every newline, which is the writing habit this surface serves.
 */
export function createMarkdownRenderer(
  options: MarkdownRendererOptions,
): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({ html: options.html, linkify: true, breaks: true });

  // GFM autolinks a bare domain. linkify-it defaults to protocol-or-email only, so with just
  // `linkify: true` a bare `example.com` stayed plain text.
  md.linkify.set({ fuzzyLink: true });

  // GFM strikethrough: one-or-two tildes, rendered as `<del>`.
  md.inline.ruler.at('strikethrough', gfmStrikethroughTokenize);
  md.inline.ruler2.at('strikethrough', gfmStrikethroughPostProcess);

  md.core.ruler.push('gfm_task_list', markdownTaskListRule);
  md.renderer.rules.image = options.media ? markdownImageRule : markdownImageTextRule;
  return md;
}

/**
 * GFM task lists (spec §5.3): a list item whose **first block** begins with a task marker
 * (`[ ]`, `[x]`) renders a disabled checkbox. The marker is an optional run of spaces, `[`,
 * a whitespace or `x`/`X`, `]`, and then at least one whitespace character before the content.
 *
 * A core post-pass over the finished token stream, not a block rule: the marker only counts
 * when it opens the item's first block, and after inline parsing that is a property of the
 * token tree (`li_open` → first content) rather than something to re-derive from source lines.
 */
export function markdownTaskListRule(state: StateCore): void {
  const tokens = state.tokens;

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.type !== 'inline') continue;

    // A list item's first content is `inline` directly under `list_item_open`, or under one
    // `paragraph_open`; any other position is a later block of the item and does not count.
    const before = tokens[index - 1];
    const opensItem =
      before?.type === 'list_item_open' ||
      (before?.type === 'paragraph_open' && tokens[index - 2]?.type === 'list_item_open');
    if (!opensItem) continue;

    const children = tokens[index].children;
    const first = children?.[0];
    if (!children || !first || first.type !== 'text') continue;

    const match = TASK_LIST_MARKER.exec(first.content);
    if (!match) continue;

    // The marker's inner character decides the state: whitespace is unchecked, `x`/`X` checked.
    const checked = /[xX]/.test(match[1] ?? '');
    first.content = first.content.slice(match[0].length);

    const box: Token = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
    children.unshift(box);
  }
}

/** The task marker at the head of a list item's inline content, per the spec's definition. */
const TASK_LIST_MARKER = /^[ \t]*\[([ \t]|x|X)\][ \t]+/;

/**
 * The sanitizer policy for rendered Markdown: what DOMPurify removes before the page sees it.
 *
 * Stated as data so a test can assert the decision, and measured in a browser rather than read
 * off the dist source. What the defaults already protect: `script`, `iframe`, `embed`,
 * `object` and the `<style>` *element* are stripped, and `javascript:` URLs are refused.
 *
 * The holes that remain, and how each is closed:
 *
 * - **`form` is forbidden.** It is allowed by default, and a form is the only thing that submits
 *   a visitor's input somewhere — a phishing surface on a page nobody staffs. `textarea`,
 *   `select` and `button` go with it so no half-form can be assembled.
 * - **`input` is *not* listed**, and that is deliberate: GFM task lists render
 *   `<input type="checkbox">` and the renderer emits it itself. A blanket ban removes the
 *   checkbox along with the phishing shape — ⚠️ the first version did exactly this, and the
 *   un-sanitized string assertion in the test passed while the page showed no checkbox at all.
 *   The narrowing happens per element in {@link markdownSanitizerHooks}, which keeps only
 *   `input[type=checkbox]` and strips every attribute a checkbox has no use for.
 * - **The `style` *attribute* must stay.** GFM table alignment is emitted as
 *   `style="text-align:center"`; forbidding the attribute silently left-aligns every column
 *   while an assertion on the un-sanitized string still passes. The `<style>` *element*, which
 *   is global rather than per-element, is already stripped by the defaults.
 *
 * `ADD_TAGS`/`ADD_ATTR` are deliberately absent: nothing here widens the allowlist wholesale.
 */
export const MARKDOWN_SANITIZER_CONFIG: { FORBID_TAGS: string[] } = {
  FORBID_TAGS: ['form', 'textarea', 'select', 'button', 'iframe', 'object', 'embed'],
};

/** The attributes a task-list checkbox may keep: it is decorative, never interactive. */
const TASK_CHECKBOX_ATTRS = ['type', 'disabled', 'checked'];

/**
 * Narrow the one element the allowlist cannot express: `<input>`.
 *
 * An allowlist is per-tag, so admitting `input` wholesale would admit
 * `<input type="text" placeholder="Password">` — the phishing shape — along with the checkbox
 * GFM needs. This hook decides per element instead: a checkbox survives with `type`/`disabled`/
 * `checked` only, and every other `<input>` is removed. `disabled` is forced because a
 * rendered announcement is not a form: the box must never look interactive.
 *
 * Registered once per process, not per component instance — DOMPurify's hook list is global.
 */
/** The attribute surface this hook reads and writes; narrower than `Element` on purpose. */
interface AttributeElement {
  nodeName: string;
  parentNode: { removeChild(node: unknown): void } | null;
  attributes: ArrayLike<{ name: string }>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * The shape of DOMPurify's `uponSanitizeElement` hook.
 *
 * The library declares three parameters (node, event, config); only the node is read here, so
 * the type is the narrow one both DOMPurify and a one-argument test stand-in satisfy.
 */
export type UponSanitizeElement = (currentNode: Node) => void;

export function markdownSanitizerHooks(instance: {
  addHook: (name: 'uponSanitizeElement', fn: UponSanitizeElement) => void;
}): void {
  instance.addHook('uponSanitizeElement', ((node: Node) => {
    // `instanceof Element` is deliberately not used: a cross-realm element (a detached document,
    // an iframe) fails that check, and the hook is only meaningful for elements anyway. The
    // cast states the surface this function actually touches.
    const element = node as unknown as AttributeElement | null;
    if (!element || element.nodeName !== 'INPUT') return;
    if (element.getAttribute('type') !== 'checkbox') {
      element.parentNode?.removeChild(element);
      return;
    }
    for (const attr of Array.from(element.attributes)) {
      if (!TASK_CHECKBOX_ATTRS.includes(attr.name)) element.removeAttribute(attr.name);
    }
    element.setAttribute('disabled', '');
    element.removeAttribute('autofocus');
  }) as unknown as UponSanitizeElement);
}

/**
 * Render and sanitize in one call: the only public way to turn Markdown into the HTML the page
 * assigns. DOMPurify is injected rather than imported so this module stays free of a DOM
 * dependency and the tests can assert the **sanitized** result, which is the string a reader
 * actually sees.
 *
 * ⚠️ Testing the un-sanitized string is not enough. The first version of the task-list test
 * asserted the renderer's output and passed, while the page showed no checkbox at all: the
 * policy's `input` ban was removing it afterwards. Anything that claims "the reader sees X"
 * has to go through this function.
 */
/** A sanitizer as this module uses it: DOMPurify, or a stand-in in a test. */
export interface MarkdownSanitizer {
  sanitize: (html: string, config: typeof MARKDOWN_SANITIZER_CONFIG) => string;
  addHook: (name: 'uponSanitizeElement', fn: UponSanitizeElement) => void;
}

/** One entry per sanitizer, so the hook is registered exactly once per process, not per render. */
const hooked = new WeakSet<MarkdownSanitizer>();

export function renderMarkdown(
  md: InstanceType<typeof MarkdownIt>,
  sanitizer: MarkdownSanitizer,
  content: string,
): string {
  if (!hooked.has(sanitizer)) {
    markdownSanitizerHooks(sanitizer);
    hooked.add(sanitizer);
  }
  return sanitizer.sanitize(md.render(content), MARKDOWN_SANITIZER_CONFIG);
}
