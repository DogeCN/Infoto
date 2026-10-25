// Admin translation drafts. The runner is injected so unit tests never call Workers AI.
//
// This module also owns the request contract: the endpoint's body parser, the size rule that
// answers 413, and the predicate the model adapter re-checks. They live together so a limit is
// written once — the route and the adapter used to carry separate copies of the same numbers.

import { isLocaleCode } from '../shared/copy.ts';
import { isRecord, safeJsonParse } from '../shared/json.ts';
import {
  MAX_POLL_OPTION_CHARS,
  MAX_POLL_OPTIONS,
  MAX_TEXT_LENGTH,
  type LocaleCode,
  type TranslationDraft,
  type TranslationRequest,
  type Translator,
} from '../shared/types.ts';

/** One structured model call: chat messages + JSON schema -> raw response text. */
export type ModelRunner = (
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  schema: Record<string, unknown>,
) => Promise<string>;

const LANGUAGE_CODE: Record<LocaleCode, string> = {
  'en-US': 'en',
  'zh-CN': 'zh',
};

const LANGUAGE_NAME: Record<string, string> = {
  en: 'English',
  zh: 'Simplified Chinese',
};

/** The one model both transports use. */
export const TRANSLATION_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
/** Per-call ceiling for the dev REST transport. */
const REST_TIMEOUT_MS = 30_000;
/** The whole body is one JSON response; leave room for a long announcement. */
export const MAX_OUTPUT_TOKENS = 8192;

const POLL_LINE = /^\s*::poll:[A-Za-z][A-Za-z0-9-]*:\d+\s*$/;

const ANNOUNCEMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    texts: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'texts'],
  additionalProperties: false,
};

const POLL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['options'],
  additionalProperties: false,
};

export interface Segment {
  /** Literal segments are reinserted unchanged: fenced code, blank lines, poll references. */
  literal: boolean;
  text: string;
}

/** Extract text from the binding/REST output shapes (plain string, `response`, or chat choices). */
export function responseText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!isRecord(result)) return '';
  if (typeof result.response === 'string') return result.response;
  if (isRecord(result.response)) return JSON.stringify(result.response);
  const choices = result.choices;
  if (!Array.isArray(choices)) return '';
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    if (isRecord(choice.message) && typeof choice.message.content === 'string')
      return choice.message.content;
    if (typeof choice.text === 'string') return choice.text;
  }
  return '';
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
 * first, but `structuredTranslator` is also a plain function that a caller can hand anything.
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

/**
 * A text block is a run of non-blank source lines. The model may add outer or doubled
 * newlines; collapse them back to the source's single-line structure. Literal blank-line
 * segments are reassembled separately, so their count is not affected.
 */
function normalizeBlock(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{2,}/g, '\n');
}

/** Parse the structured reply; tolerate a stray Markdown fence around the JSON. */
function parseJsonDraft(raw: string): Record<string, unknown> {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = safeJsonParse<unknown>(text, null);
  if (!isRecord(parsed)) throw new Error('invalid_response');
  return parsed;
}

function buildMessages(
  source: string,
  target: string,
  instruction: string,
  payload: unknown,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        `You are translating a JSON payload from ${source} to ${target}. ${instruction} ` +
        `Write natural, idiomatic ${target} as a native speaker would: prefer concise, direct ` +
        'phrasing and natural word order over stacked noun phrases, literal word-for-word calques, ' +
        'redundant pronouns, source-language constructions, or sentence-by-sentence mirroring. ' +
        'You may reorder or split sentences, but keep every fact, technical term, and all inline ' +
        'Markdown, URLs, and inline code. Keep the JSON keys unchanged and the same number and order ' +
        'of array items. Return only JSON matching the schema, with no commentary.',
    },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

/**
 * Translate a whole request in one structured model call. Announcement literal blocks
 * (fences, blank lines, poll references) are never sent to the model: they are removed from
 * the payload as text blocks and reassembled in code after the array comes back. Poll options
 * travel as one array, so the model cannot change their count or order silently.
 */
export function structuredTranslator(run: ModelRunner): Translator {
  return async (request): Promise<TranslationDraft> => {
    const sourceLang = languageOf(request.sourceLocale);
    const targetLang = languageOf(request.targetLocale);
    if (!sourceLang || !targetLang || sourceLang === targetLang) {
      throw new Error('unsupported_locale');
    }
    if (!isTranslatable(request)) throw new Error('invalid_request');
    const source = LANGUAGE_NAME[sourceLang] ?? sourceLang;
    const target = LANGUAGE_NAME[targetLang] ?? targetLang;

    if (request.kind === 'announcement') {
      const segments = splitAnnouncement(request.contentMd);
      const texts = segments.filter((segment) => !segment.literal).map((segment) => segment.text);
      const draft = parseJsonDraft(
        await run(
          buildMessages(
            source,
            target,
            'Translate the values of "title" and every "texts" entry;',
            { title: request.title, texts },
          ),
          ANNOUNCEMENT_SCHEMA,
        ),
      );
      const title = typeof draft.title === 'string' ? draft.title.trim() : '';
      const translated = draft.texts;
      if (!title || !Array.isArray(translated) || translated.length !== texts.length) {
        throw new Error('invalid_response');
      }

      const pieces: string[] = [];
      let next = 0;
      for (const segment of segments) {
        if (segment.literal) {
          pieces.push(segment.text);
          continue;
        }
        const value = translated[next];
        next += 1;
        if (typeof value !== 'string' || !value.trim()) throw new Error('empty_translation');
        pieces.push(normalizeBlock(value));
      }
      const contentMd = pieces.join('\n');
      if (!contentMd.trim()) throw new Error('empty_translation');
      return { kind: 'announcement', title, contentMd };
    }

    const draft = parseJsonDraft(
      await run(
        buildMessages(source, target, 'Translate the values of every "options" entry;', {
          options: request.options,
        }),
        POLL_SCHEMA,
      ),
    );
    const translated = draft.options;
    if (!Array.isArray(translated) || translated.length !== request.options.length) {
      throw new Error('invalid_response');
    }
    const options: string[] = [];
    for (const option of translated) {
      if (typeof option !== 'string' || !option.trim()) throw new Error('empty_translation');
      options.push(option.trim());
    }
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
): ModelRunner {
  return async (messages, schema) => {
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
          body: JSON.stringify({
            messages,
            response_format: { type: 'json_schema', json_schema: schema },
            temperature: 0,
            max_tokens: MAX_OUTPUT_TOKENS,
          }),
          signal: controller.signal,
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(data) || data.success !== true || !isRecord(data.result)) {
        throw new Error(`rest_translate_failed_${response.status}`);
      }
      const text = responseText(data.result);
      if (!text.trim()) throw new Error('empty_translation');
      return text;
    } finally {
      clearTimeout(timer);
    }
  };
}
