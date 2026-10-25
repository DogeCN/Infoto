// Admin translation drafts. The runner is injected so unit tests never call Workers AI.
//
// This module also owns the request contract: the endpoint's body parser, the size rule that
// answers 413, and the predicate the model adapter re-checks. They live together so a limit is
// written once — the route and the adapter used to carry separate copies of the same numbers.

import { isLocaleCode } from '../shared/copy.ts';
import { isRecord } from '../shared/json.ts';
import {
  MAX_POLL_OPTION_CHARS,
  MAX_POLL_OPTIONS,
  MAX_TEXT_LENGTH,
  type LocaleCode,
  type TranslationDraft,
  type TranslationRequest,
  type Translator,
} from '../shared/types.ts';

/** One text-in / text-out call to the translation model. */
export type TranslationRunner = (
  text: string,
  sourceLang: string,
  targetLang: string,
) => Promise<string>;

const LANGUAGE_CODE: Record<LocaleCode, string> = {
  'en-US': 'en',
  'zh-CN': 'zh',
};

/** The one model both transports use. */
export const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';
/** Per-call ceiling for the dev REST transport. */
const REST_TIMEOUT_MS = 30_000;

/** A conservative chunk ceiling: m2m100 has a small context window. */
const MAX_CHUNK_CHARS = 800;
const POLL_CONCURRENCY = 4;
const POLL_LINE = /^\s*::poll:[A-Za-z][A-Za-z0-9-]*:\d+\s*$/;

export interface Segment {
  /** Literal segments are reinserted unchanged: fenced code, blank lines, poll references. */
  literal: boolean;
  text: string;
}

function languageOf(locale: LocaleCode): string | null {
  return Object.hasOwn(LANGUAGE_CODE, locale) ? LANGUAGE_CODE[locale] : null;
}

/**
 * Read a request body into a `TranslationRequest`, or null when it is malformed. Shape and
 * presence only: sizes are `isOversizedTranslation`'s job, so the endpoint can answer 413
 * instead of collapsing every refusal into one status.
 */
export function readTranslationRequest(body: unknown): TranslationRequest | null {
  if (!isRecord(body)) return null;
  const sourceLocale = isLocaleCode(body.sourceLocale) ? body.sourceLocale : null;
  const targetLocale = isLocaleCode(body.targetLocale) ? body.targetLocale : null;
  if (!sourceLocale || !targetLocale || sourceLocale === targetLocale) return null;

  if (body.kind === 'announcement') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body.contentMd === 'string' ? body.contentMd : '';
    if (!title || !contentMd.trim()) return null;
    return { kind: 'announcement', sourceLocale, targetLocale, title, contentMd };
  }

  if (body.kind !== 'poll' || !Array.isArray(body.options)) return null;
  if (typeof body.allowMultiple !== 'boolean') return null;
  if (!body.options.every((option): option is string => typeof option === 'string')) return null;
  const options = body.options.map((option) => option.trim());
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS) return null;
  if (options.some((option) => !option || option.length > MAX_POLL_OPTION_CHARS)) return null;
  return { kind: 'poll', sourceLocale, targetLocale, options, allowMultiple: body.allowMultiple };
}

/** Announcement text beyond the model's budget; the endpoint answers 413 rather than 400. */
export function isOversizedTranslation(request: TranslationRequest): boolean {
  return (
    request.kind === 'announcement' &&
    (request.title.length > MAX_TEXT_LENGTH || request.contentMd.length > MAX_TEXT_LENGTH)
  );
}

/**
 * Everything the model adapter requires of a typed request. The route validates the wire body
 * first, but `m2m100Translator` is also a plain function that a caller can hand anything.
 */
export function isTranslatable(request: TranslationRequest): boolean {
  return readTranslationRequest(request) !== null && !isOversizedTranslation(request);
}

/**
 * Split announcement Markdown into blocks. Fenced code, blank lines and whole-line
 * `::poll:` references stay literal; consecutive other lines become one text block.
 * Rejoining with `\n` preserves the original line structure around the literal blocks.
 */
export function splitAnnouncement(contentMd: string): Segment[] {
  const lines = contentMd.split(/\r?\n/);
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({ literal: false, text: buffer.join('\n') });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fence = trimmed.startsWith('```') || trimmed.startsWith('~~~');
    if (inFence) {
      segments.push({ literal: true, text: line });
      if (fence) inFence = false;
      continue;
    }
    if (fence) {
      flush();
      inFence = true;
      segments.push({ literal: true, text: line });
      continue;
    }
    if (POLL_LINE.test(line)) {
      flush();
      segments.push({ literal: true, text: line });
      continue;
    }
    if (line.trim() === '') {
      flush();
      segments.push({ literal: true, text: line });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return segments;
}

/** Cut a line at a sentence boundary within `max`, or hard-cut when there is none. */
function sentenceCut(text: string, max: number): number {
  const window = text.slice(0, max);
  let cut = -1;
  for (const token of ['. ', '! ', '? ', '。', '！', '？', '\n']) {
    const at = window.lastIndexOf(token);
    if (at >= 0) cut = Math.max(cut, at + 1);
  }
  return cut;
}

function splitLongLine(line: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > max) {
    const cut = sentenceCut(rest, max);
    const size = cut > 0 ? cut : max;
    chunks.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Chunks retain their separators, so joining the translated chunks restores the layout. */
function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]! + (index < lines.length - 1 ? '\n' : '');
    if (line.length > max) {
      flush();
      chunks.push(...splitLongLine(line, max));
      continue;
    }
    if (current.length + line.length > max) flush();
    current += line;
  }
  flush();
  return chunks;
}

async function translateTextBlock(
  run: TranslationRunner,
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const chunks = splitText(text, MAX_CHUNK_CHARS);
  const translated: string[] = [];
  for (const chunk of chunks) {
    const result = await run(chunk, sourceLang, targetLang);
    if (!result.trim()) throw new Error('empty_translation');
    translated.push(result);
  }
  return translated.join('');
}

async function mapLimit<T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Build a Translator over a single-string translation call. Announcement bodies are
 * split into blocks so Markdown structure survives; poll options are translated one by
 * one so their order and count cannot drift.
 */
export function m2m100Translator(run: TranslationRunner): Translator {
  return async (request): Promise<TranslationDraft> => {
    const sourceLang = languageOf(request.sourceLocale);
    const targetLang = languageOf(request.targetLocale);
    if (!sourceLang || !targetLang || sourceLang === targetLang) {
      throw new Error('unsupported_locale');
    }
    if (!isTranslatable(request)) throw new Error('invalid_request');

    if (request.kind === 'announcement') {
      const title = (await translateTextBlock(run, request.title, sourceLang, targetLang)).trim();
      if (!title) throw new Error('empty_translation');

      const pieces: string[] = [];
      for (const segment of splitAnnouncement(request.contentMd)) {
        pieces.push(
          segment.literal
            ? segment.text
            : await translateTextBlock(run, segment.text, sourceLang, targetLang),
        );
      }
      const contentMd = pieces.join('\n');
      if (!contentMd.trim()) throw new Error('empty_translation');
      return { kind: 'announcement', title, contentMd };
    }

    const options = await mapLimit(request.options, POLL_CONCURRENCY, async (option) => {
      const translated = (await run(option.trim(), sourceLang, targetLang)).trim();
      if (!translated) throw new Error('empty_translation');
      return translated;
    });
    return { kind: 'poll', options };
  };
}

/**
 * Dev-only REST transport. The local AI binding's remote edge path is unreachable on some
 * networks while `api.cloudflare.com` is available. Production has no account/token vars and
 * uses the binding instead.
 */
export function restTranslationRunner(
  accountId: string,
  apiToken: string,
  fetchFn: typeof fetch = fetch,
): TranslationRunner {
  return async (text, sourceLang, targetLang) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
    try {
      const response = await fetchFn(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TRANSLATION_MODEL}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
          signal: controller.signal,
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(data) || data.success !== true || !isRecord(data.result)) {
        throw new Error(`rest_translate_failed_${response.status}`);
      }
      const translated = data.result.translated_text;
      if (typeof translated !== 'string' || !translated.trim()) {
        throw new Error('empty_translation');
      }
      return translated;
    } finally {
      clearTimeout(timer);
    }
  };
}
