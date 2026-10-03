// Infoto shared contract types — used by both runtimes (Worker / local Node)
// and the frontend.

import type { LocaleCode } from './copy.ts';
export type { LocaleCode } from './copy.ts';

/** Maximum operations accepted by one sync request. */
export const MAX_SYNC_OPS = 500;

/** Maximum choices accepted by a poll. */
export const MAX_POLL_OPTIONS = 100;

/** Media kind encoded in photos.type. */
export const MEDIA_TYPE = {
  /** Still image (WebP). */
  IMAGE: 0,
  /** Animated image / silent video (WebM, no audio track). */
  ANIMATED: 1,
  /** Video with audio track (WebM). */
  VIDEO: 2,
} as const;
export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

/** Full photo metadata, downloaded wholesale via /sync. */
export interface Photo {
  /** Autoincrement numeric id; externally represented base-36 (`id.toString(36)`). */
  id: number;
  sha256: string;
  /** Direct image-host URL (in-site loads hit the host directly). */
  url: string;
  /** User id of the uploader. */
  uploader: number;
  width: number;
  height: number;
  /** Size in bytes. */
  size: number;
  /** Millisecond epoch. */
  createdAt: number;
  type: MediaType;
  /** User ids that liked this photo. */
  likes: number[];
  /** User ids that disliked this photo. */
  dislikes: number[];
  /** User ids that requested deletion of this photo. */
  reports: number[];
}

/** One reaction row: one emoji per user per announcement. */
export interface Reaction {
  userId: number;
  emoji: string;
}

/** One option selection in a poll (0-based index). Multi-select polls have multiple rows per user. */
export interface Vote {
  userId: number;
  option: number;
}

export interface Announcement {
  id: number;
  title: string;
  contentMd: string;
  locale: LocaleCode;
  /** Display order; normalized to 0…n-1 by the admin reorder API. */
  sort: number;
  /** Millisecond epoch. */
  updatedAt: number;
  reactions: Reaction[];
}

export interface Poll {
  id: number;
  options: string[];
  allowMultiple: boolean;
  locale: LocaleCode;
  /** Manual display order within this locale. */
  sort: number;
  /** Millisecond epoch. */
  updatedAt: number;
  votes: Vote[];
}

export interface Feedback {
  id: number;
  userId: number;
  contentMd: string;
  createdAt: number;
  /** Manual (root-only) display order; lowest first. */
  sort: number;
  locale: LocaleCode;
}

/** All op kinds accepted by POST /sync (the single write entry point). */
export type OpType =
  // photo area
  | 'upload'
  | 'like'
  | 'unlike'
  | 'dislike'
  | 'undislike'
  | 'report'
  | 'unreport'
  | 'delete' // root only
  // vote area (everyone, targets a poll)
  | 'vote'
  // feedback area (creation only; deletion is DELETE /admin/feedback/:id)
  | 'fb_create' // everyone
  // reaction area
  | 'react';

/** Payload carried by an `upload` op (metadata of a photo already on the host). */
export interface UploadPayload {
  sha256: string;
  /** Image-host direct URL returned by /upload (`data` field). */
  url: string;
  width: number;
  height: number;
  size: number;
  type: MediaType;
}

/** Payload for `fb_create`; locale is captured when the user submits the suggestion. */
export interface FeedbackPayload {
  contentMd: string;
  locale: LocaleCode;
}

/** Payload for `react`; empty/absent emoji clears the reaction. */
export interface ReactPayload {
  emoji?: string | null;
}

/** Payload for `vote`; all selected 0-based option indexes replace the user's current selections. */
export interface VotePayload {
  options: number[];
}

export type OpPayload =
  UploadPayload | FeedbackPayload | ReactPayload | VotePayload | Record<string, unknown>;

/** One op-log entry, applied by /sync strictly in array order. */
export interface Op {
  type: OpType;
  /** Poll ID for votes; announcement ID for reactions. Photo operations use targetSha instead. */
  target?: number | null;
  /** Photo ops: the target photo's sha256. */
  targetSha?: string;
  payload?: OpPayload | null;
}

export interface SyncRequest {
  /** Required when no identity exists yet. */
  turnstileToken?: string | null;
  ops: Op[];
}

export interface SyncResponse {
  ok: boolean;
  /** Server millisecond clock for correcting optimistic timestamps. */
  serverTime: number;
  selfId: number;
  /** Where the browser POSTs artifacts. The standalone facade owns the image host and its
   *  credentials, so this server never sees an upload or a TC_SECRET. */
  mediaHostUrl: string;
  photos: Photo[];
  /** Every locale's rows: the client filters by its content locale, so switching language
   *  never needs another round trip. */
  announcements: Announcement[];
  polls: Poll[];
  /** Real data for the root user only; empty array for everyone else. */
  feedback: Feedback[];
}

/**
 * Image-host JSON returned by the facade's POST /upload: URL in `data`, message in `msg` / `error`.
 */
export interface MediaHostUploadResponse {
  data?: string;
  msg?: string;
  error?: string;
  [key: string]: unknown;
}
