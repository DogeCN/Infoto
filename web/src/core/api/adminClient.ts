/**
 * The one admin surface that stays on HTTP after ADR 0026: root-gated draft translation.
 * The announcement / poll / feedback mutations are WebSocket ops now (queue them through
 * the store); only this stateless request-response remains.
 *
 * The collection timeouts stay here because the store's rollback toasts name them — a
 * dropped op reports through the same timeout id the HTTP writes used.
 */
import type {
  AnnouncementTranslationDraft,
  AnnouncementTranslationRequest,
  PollTranslationDraft,
  PollTranslationRequest,
  TranslationDraft,
  TranslationDraftOf,
  TranslationRequest,
} from '$shared/types';
import { copy, fmt } from '$shared/copy';
import { requestJson, type RequestIo } from './request';

export type AdminApiIo = RequestIo;
export const ANN_TIMEOUT = 'announcement_timeout';
export const FB_TIMEOUT = 'feedback_timeout';
export const POLL_TIMEOUT = 'poll_timeout';
export const TRANSLATE_TIMEOUT = 'admin_translate_timeout';
/** A long announcement needs several model calls, so this deadline is the longest here. */
const TRANSLATE_TIMEOUT_MS = 60_000;

/** Validate the draft before an editor is opened from it; the kind follows the request. */
function translationDraft<T extends TranslationRequest>(
  request: T,
  data: unknown,
): TranslationDraftOf<T> {
  if (!data || typeof data !== 'object') throw new Error('invalid_response');
  const result = data as Record<string, unknown>;
  if (result.ok !== true || result.kind !== request.kind) throw new Error('invalid_response');

  if (request.kind === 'announcement') {
    const { title, contentMd } = result;
    if (
      typeof title !== 'string' ||
      typeof contentMd !== 'string' ||
      !title.trim() ||
      !contentMd.trim()
    )
      throw new Error('invalid_response');
    return { kind: 'announcement', title, contentMd } as TranslationDraftOf<T>;
  }

  if (!Array.isArray(result.options) || result.options.length !== request.options.length)
    throw new Error('invalid_response');
  const options: string[] = [];
  for (const option of result.options) {
    if (typeof option !== 'string' || !option.trim()) throw new Error('invalid_response');
    options.push(option);
  }
  return { kind: 'poll', options } as TranslationDraftOf<T>;
}

/**
 * Request a translation draft from the root-only endpoint. The request carries the card's
 * current content, so the endpoint is stateless and no write happens until the admin saves.
 * A long announcement needs several model calls, hence the longer deadline.
 *
 * The overloads make the draft's kind follow the request's, so a caller never has to check
 * `kind` on a response it just asked for.
 */
export function translateDraft(
  request: AnnouncementTranslationRequest,
  io?: AdminApiIo,
): Promise<AnnouncementTranslationDraft>;
export function translateDraft(
  request: PollTranslationRequest,
  io?: AdminApiIo,
): Promise<PollTranslationDraft>;
export async function translateDraft(
  request: TranslationRequest,
  io: AdminApiIo = {},
): Promise<TranslationDraft> {
  const { response, data } = await requestJson(
    '/admin/translate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
    TRANSLATE_TIMEOUT,
    { ...io, timeoutMs: io.timeoutMs ?? TRANSLATE_TIMEOUT_MS },
  );
  if (!response.ok) throw new Error(fmt(copy.api.translateFailed, { status: response.status }));
  return translationDraft(request, data);
}
