// Announcement write API (root only) — replaces the ann_* ops that used to ride
// /sync; reads still come from the /sync snapshot, so this module is write-only.
// Calls resolve immediately: a create returns the real server id, so no temp-id.

import type { Announcement } from '$shared/types';

export interface AnnouncementApiIo {
  fetchFn?: typeof fetch;
  origin?: string;
  /** Per-attempt timeout (tests inject small values). */
  timeoutMs?: number;
}

/**
 * Hard ceiling on one admin write: a dead backend does not refuse the
 * connection (the dev proxy just holds the socket open), so a fetch without
 * a timeout never settles and the editor dialog stays busy forever.
 */
export const ANNOUNCEMENT_TIMEOUT_MS = 15_000;

function endpoint(path: string, io: AnnouncementApiIo = {}): string {
  const origin = io.origin ?? window.location.origin;
  return `${origin}/admin/announcements${path}`;
}

async function send(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  io: AnnouncementApiIo = {},
): Promise<Response> {
  const fetchFn = io.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), io.timeoutMs ?? ANNOUNCEMENT_TIMEOUT_MS);
  try {
    return await fetchFn(endpoint(path, io), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    // Timeout gets a stable id so the UI can say "backend not responding".
    if ((e as Error)?.name === 'AbortError') {
      throw new Error('announcement_timeout', { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Create and resolve the real id the server assigned. */
export async function createAnnouncement(
  title: string,
  contentMd: string,
  io: AnnouncementApiIo = {},
): Promise<Announcement> {
  const res = await send('', 'POST', { title, contentMd }, io);
  if (!res.ok) throw new Error(`announcement create failed: HTTP ${res.status}`);
  const data = (await res.json()) as { ok: true; announcement: Announcement };
  return data.announcement;
}

export async function updateAnnouncement(
  id: number,
  title: string,
  contentMd: string,
  io: AnnouncementApiIo = {},
): Promise<void> {
  const res = await send(`/${id}`, 'PUT', { title, contentMd }, io);
  if (!res.ok) throw new Error(`announcement update failed: HTTP ${res.status}`);
}

export async function deleteAnnouncement(id: number, io: AnnouncementApiIo = {}): Promise<void> {
  const res = await send(`/${id}`, 'DELETE', undefined, io);
  if (!res.ok) throw new Error(`announcement delete failed: HTTP ${res.status}`);
}

/** ids are real server ids; sort is assigned by index. */
export async function reorderAnnouncements(
  ids: number[],
  io: AnnouncementApiIo = {},
): Promise<void> {
  const res = await send('/reorder', 'POST', { ids }, io);
  if (!res.ok) throw new Error(`announcement reorder failed: HTTP ${res.status}`);
}
