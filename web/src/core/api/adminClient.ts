// Transport and endpoints for the root-only admin write APIs. Reads come from the
// /sync snapshot, so everything here is write-only.

import type { Announcement } from '$shared/types';
import { copy, fmt } from '$shared/copy';

export interface AdminApiIo {
  fetchFn?: typeof fetch;
  origin?: string;
  /** Per-attempt timeout (tests inject small values). */
  timeoutMs?: number;
}

/** Hard ceiling on one admin write: a dead backend holds the socket open instead
 * of refusing it, so a fetch without a timeout never settles and the caller's
 * optimistic row stays in flight forever. */
export const ADMIN_TIMEOUT_MS = 15_000;

/** Stable ids a stalled request is tagged with, so the UI can tell a backend
 * timeout from a plain network error when it builds the failure hint. */
export const ANN_TIMEOUT = 'announcement_timeout';
export const FB_TIMEOUT = 'feedback_timeout';

/** One JSON admin write. An abort is rethrown as an Error whose message is the
 * caller-supplied `timeoutId`. Other failures propagate as-is. */
export async function adminWrite(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  timeoutId: string,
  io: AdminApiIo = {},
): Promise<Response> {
  const origin = io.origin ?? window.location.origin;
  const fetchFn = io.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), io.timeoutMs ?? ADMIN_TIMEOUT_MS);
  try {
    return await fetchFn(`${origin}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error(timeoutId, { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const ANN_PATH = '/admin/announcements';
const FB_PATH = '/admin/feedback';

/** Create and resolve the real id the server assigned. */
export async function createAnnouncement(
  title: string,
  contentMd: string,
  io: AdminApiIo = {},
): Promise<Announcement> {
  const res = await adminWrite(ANN_PATH, 'POST', { title, contentMd }, ANN_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.announcementCreateFailed, { status: res.status }));
  const data = (await res.json()) as { ok: true; announcement: Announcement };
  return data.announcement;
}

export async function updateAnnouncement(
  id: number,
  title: string,
  contentMd: string,
  io: AdminApiIo = {},
): Promise<void> {
  const res = await adminWrite(`${ANN_PATH}/${id}`, 'PUT', { title, contentMd }, ANN_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.announcementUpdateFailed, { status: res.status }));
}

export async function deleteAnnouncement(id: number, io: AdminApiIo = {}): Promise<void> {
  const res = await adminWrite(`${ANN_PATH}/${id}`, 'DELETE', undefined, ANN_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.announcementDeleteFailed, { status: res.status }));
}

/** ids are real server ids; sort is assigned by index. */
export async function reorderAnnouncements(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const res = await adminWrite(`${ANN_PATH}/reorder`, 'POST', { ids }, ANN_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.announcementReorderFailed, { status: res.status }));
}

/** Delete one feedback row. Idempotent server-side, so a repeat is harmless. */
export async function deleteFeedback(id: number, io: AdminApiIo = {}): Promise<void> {
  const res = await adminWrite(`${FB_PATH}/${id}`, 'DELETE', undefined, FB_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.feedbackDeleteFailed, { status: res.status }));
}

/** ids are real server ids; sort is assigned by index (lowest first). */
export async function reorderFeedback(ids: number[], io: AdminApiIo = {}): Promise<void> {
  const res = await adminWrite(`${FB_PATH}/reorder`, 'POST', { ids }, FB_TIMEOUT, io);
  if (!res.ok) throw new Error(fmt(copy.api.feedbackReorderFailed, { status: res.status }));
}
