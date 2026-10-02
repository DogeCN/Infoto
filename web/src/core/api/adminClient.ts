/**
 * Shared admin JSON transport. Locale is supplied by the caller on every write.
 *
 * Reading it from the UI here instead would be a second source of truth: the store keys its
 * optimistic rows on `contentLocale`, so a write could land in a different language list.
 */
import type { Announcement, LocaleCode, Poll } from '$shared/types';
import { copy, fmt, type Copy } from '$shared/copy';
import { requestJson, type RequestIo } from './request';

export type AdminApiIo = RequestIo;
export const ANN_TIMEOUT = 'announcement_timeout';
export const FB_TIMEOUT = 'feedback_timeout';
export const POLL_TIMEOUT = 'poll_timeout';

type AdminResource = 'announcement' | 'poll' | 'feedback';
type AdminAction = 'create' | 'update' | 'delete' | 'reorder';
type ApiErrorKey = keyof Copy['api'];

interface ResourceConfig {
  path: string;
  timeout: string;
  errors: Partial<Record<AdminAction, ApiErrorKey>>;
}

const RESOURCES: Record<AdminResource, ResourceConfig> = {
  announcement: {
    path: '/admin/announcements',
    timeout: ANN_TIMEOUT,
    errors: {
      create: 'announcementCreateFailed',
      update: 'announcementUpdateFailed',
      delete: 'announcementDeleteFailed',
      reorder: 'announcementReorderFailed',
    },
  },
  poll: {
    path: '/admin/polls',
    timeout: POLL_TIMEOUT,
    errors: {
      create: 'pollCreateFailed',
      update: 'pollUpdateFailed',
      delete: 'pollDeleteFailed',
      reorder: 'pollReorderFailed',
    },
  },
  feedback: {
    path: '/admin/feedback',
    timeout: FB_TIMEOUT,
    errors: {
      delete: 'feedbackDeleteFailed',
      reorder: 'feedbackReorderFailed',
    },
  },
};

async function adminWrite(
  resource: AdminResource,
  action: AdminAction,
  method: 'POST' | 'PUT' | 'DELETE',
  suffix: string,
  body: unknown,
  io: AdminApiIo,
): Promise<unknown> {
  const config = RESOURCES[resource];
  const { response, data } = await requestJson(
    `${config.path}${suffix}`,
    {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    config.timeout,
    io,
  );
  if (!response.ok) {
    const errorKey = config.errors[action];
    if (!errorKey) throw new Error(`unsupported_${resource}_${action}`);
    throw new Error(fmt(copy.api[errorKey], { status: response.status }));
  }
  return data;
}

function created<T>(data: unknown, field: 'announcement' | 'poll'): T {
  if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true) {
    throw new Error('invalid_response');
  }
  const result = data as Record<string, unknown>;
  const value = result[field];
  if (!value || typeof value !== 'object') throw new Error('invalid_response');
  return value as T;
}

/**
 * Every write carries the locale of the collection it belongs to, supplied by the caller.
 * Reading it from the UI here instead would be a second source of truth: the store keys its
 * optimistic rows on `contentLocale`, and a write could land in a different language list.
 */
export async function createAnnouncement(
  title: string,
  contentMd: string,
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<Announcement> {
  const data = await adminWrite(
    'announcement',
    'create',
    'POST',
    '',
    { title, contentMd, locale },
    io,
  );
  return created<Announcement>(data, 'announcement');
}

export async function updateAnnouncement(
  id: number,
  title: string,
  contentMd: string,
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<void> {
  await adminWrite('announcement', 'update', 'PUT', `/${id}`, { title, contentMd, locale }, io);
}

export async function deleteAnnouncement(id: number, io: AdminApiIo = {}): Promise<void> {
  await adminWrite('announcement', 'delete', 'DELETE', `/${id}`, undefined, io);
}

export async function reorderAnnouncements(
  ids: number[],
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<void> {
  await adminWrite('announcement', 'reorder', 'POST', '/reorder', { ids, locale }, io);
}

export async function createPoll(
  title: string,
  options: string[],
  allowMultiple: boolean,
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<Poll> {
  const data = await adminWrite(
    'poll',
    'create',
    'POST',
    '',
    { title, options, allowMultiple, locale },
    io,
  );
  return created<Poll>(data, 'poll');
}

export async function updatePoll(
  id: number,
  title: string,
  options: string[],
  allowMultiple: boolean,
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<void> {
  await adminWrite(
    'poll',
    'update',
    'PUT',
    `/${id}`,
    { title, options, allowMultiple, locale },
    io,
  );
}

export async function deletePoll(id: number, io: AdminApiIo = {}): Promise<void> {
  await adminWrite('poll', 'delete', 'DELETE', `/${id}`, undefined, io);
}

export async function reorderPolls(
  ids: number[],
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<void> {
  await adminWrite('poll', 'reorder', 'POST', '/reorder', { ids, locale }, io);
}

export async function deleteFeedback(id: number, io: AdminApiIo = {}): Promise<void> {
  await adminWrite('feedback', 'delete', 'DELETE', `/${id}`, undefined, io);
}

export async function reorderFeedback(
  ids: number[],
  locale: LocaleCode,
  io: AdminApiIo = {},
): Promise<void> {
  await adminWrite('feedback', 'reorder', 'POST', '/reorder', { ids, locale }, io);
}
