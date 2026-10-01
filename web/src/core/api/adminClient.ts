// Transport and endpoints for root-only admin writes. Reads come from the locale-scoped /sync snapshot.

import type { Announcement, Poll } from '$shared/types';
import { activeLocale, copy, fmt } from '$shared/copy';
import { requestJson, type RequestIo } from './request';

export type AdminApiIo = RequestIo;
export const ANN_TIMEOUT = 'announcement_timeout';
export const FB_TIMEOUT = 'feedback_timeout';
export const POLL_TIMEOUT = 'poll_timeout';

function adminWrite(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  timeoutId: string,
  io: AdminApiIo,
) {
  return requestJson(
    path,
    {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutId,
    io,
  );
}

const ANN_PATH = '/admin/announcements';
const POLL_PATH = '/admin/polls';
const FB_PATH = '/admin/feedback';

/** Create and resolve the real id the server assigned. */
export async function createAnnouncement(
  title: string,
  contentMd: string,
  io: AdminApiIo = {},
): Promise<Announcement> {
  const { response: res, data } = await adminWrite(
    ANN_PATH,
    'POST',
    { title, contentMd, locale: activeLocale() },
    ANN_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.announcementCreateFailed, { status: res.status }));
  const result = data as { ok?: boolean; announcement?: Announcement } | null;
  if (result?.ok !== true || !result.announcement) throw new Error('invalid_response');
  return result.announcement;
}

export async function updateAnnouncement(
  id: number,
  title: string,
  contentMd: string,
  io: AdminApiIo = {},
): Promise<void> {
  const { response: res } = await adminWrite(
    `${ANN_PATH}/${id}`,
    'PUT',
    { title, contentMd, locale: activeLocale() },
    ANN_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.announcementUpdateFailed, { status: res.status }));
}

export async function deleteAnnouncement(id: number, io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${ANN_PATH}/${id}`,
    'DELETE',
    undefined,
    ANN_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.announcementDeleteFailed, { status: res.status }));
}

/** ids are real server ids; sort is assigned by index within the active language. */
export async function reorderAnnouncements(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${ANN_PATH}/reorder`,
    'POST',
    { ids, locale: activeLocale() },
    ANN_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.announcementReorderFailed, { status: res.status }));
}

export async function createPoll(
  title: string,
  options: string[],
  allowMultiple: boolean,
  io: AdminApiIo = {},
): Promise<Poll> {
  const { response: res, data } = await adminWrite(
    POLL_PATH,
    'POST',
    { title, options, allowMultiple, locale: activeLocale() },
    POLL_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.pollCreateFailed, { status: res.status }));
  const result = data as { ok?: boolean; poll?: Poll } | null;
  if (result?.ok !== true || !result.poll) throw new Error('invalid_response');
  return result.poll;
}

export async function updatePoll(
  id: number,
  title: string,
  options: string[],
  allowMultiple: boolean,
  io: AdminApiIo = {},
): Promise<void> {
  const { response: res } = await adminWrite(
    `${POLL_PATH}/${id}`,
    'PUT',
    { title, options, allowMultiple, locale: activeLocale() },
    POLL_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.pollUpdateFailed, { status: res.status }));
}

export async function deletePoll(id: number, io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${POLL_PATH}/${id}`,
    'DELETE',
    undefined,
    POLL_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.pollDeleteFailed, { status: res.status }));
}

export async function reorderPolls(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${POLL_PATH}/reorder`,
    'POST',
    { ids, locale: activeLocale() },
    POLL_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.pollReorderFailed, { status: res.status }));
}

/** Delete one feedback row. Idempotent server-side, so a repeat is harmless. */
export async function deleteFeedback(id: number, io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${FB_PATH}/${id}`,
    'DELETE',
    undefined,
    FB_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.feedbackDeleteFailed, { status: res.status }));
}

/** ids are real server ids; sort is assigned by index within the active language. */
export async function reorderFeedback(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${FB_PATH}/reorder`,
    'POST',
    { ids, locale: activeLocale() },
    FB_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.feedbackReorderFailed, { status: res.status }));
}
