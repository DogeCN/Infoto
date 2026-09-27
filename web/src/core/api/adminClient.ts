// Transport and endpoints for the root-only admin write APIs. Reads come from the
// /sync snapshot, so everything here is write-only.

import type { Announcement } from '$shared/types';
import { copy, fmt } from '$shared/copy';

import { requestJson, type RequestIo } from './request';

export type AdminApiIo = RequestIo;
export const ANN_TIMEOUT = 'announcement_timeout';
export const FB_TIMEOUT = 'feedback_timeout';

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
    { title, contentMd },
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
    { title, contentMd },
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

/** ids are real server ids; sort is assigned by index. */
export async function reorderAnnouncements(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(
    `${ANN_PATH}/reorder`,
    'POST',
    { ids },
    ANN_TIMEOUT,
    io,
  );
  if (!res.ok) throw new Error(fmt(copy.api.announcementReorderFailed, { status: res.status }));
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

/** ids are real server ids; sort is assigned by index (lowest first). */
export async function reorderFeedback(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const { response: res } = await adminWrite(`${FB_PATH}/reorder`, 'POST', { ids }, FB_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.feedbackReorderFailed, { status: res.status }));
}
