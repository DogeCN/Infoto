// Infoto shared contract types — used by both runtimes (Worker / local Node)
// and the frontend.

import type { LocaleCode } from './copy.ts';
export type { LocaleCode } from './copy.ts';

/** Maximum operations accepted by one sync request. */
export const MAX_SYNC_OPS = 500;

/** Maximum choices accepted by a poll. */
export const MAX_POLL_OPTIONS = 100;

/** Longest accepted free text: an announcement body, or a translation source. */
export const MAX_TEXT_LENGTH = 20_000;

/** Longest accepted poll option, on the wire and in a translation draft. */
export const MAX_POLL_OPTION_CHARS = 200;

/** Largest SQL import body /admin/migrate accepts, in bytes. The browser refuses the same
 *  size before sending, so the two halves must read one value. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

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
interface Reaction {
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
type OpType =
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
  /** When the upload URL was obtained (ms epoch), reported by the uploading client and
   *  bounded by the server clock. Without it every photo in one /sync batch shares a single
   *  timestamp, because `serverTime` is read once per request — and "latest" cannot order them. */
  createdAt: number;
}

/** Payload for `fb_create`; locale is captured when the user submits the suggestion. */
interface FeedbackPayload {
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

type OpPayload =
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

/** Translated announcement draft returned by POST /admin/translate. */
export interface AnnouncementTranslationDraft {
  kind: 'announcement';
  title: string;
  contentMd: string;
}

/** Translated poll options returned by POST /admin/translate; order matches the source. */
export interface PollTranslationDraft {
  kind: 'poll';
  options: string[];
}

export type TranslationDraft = AnnouncementTranslationDraft | PollTranslationDraft;

/** Body of POST /admin/translate: the card's current content, not a row id. */
export interface AnnouncementTranslationRequest {
  kind: 'announcement';
  sourceLocale: LocaleCode;
  targetLocale: LocaleCode;
  title: string;
  contentMd: string;
}

/** Body of POST /admin/translate for a poll; option order is the source order. */
export interface PollTranslationRequest {
  kind: 'poll';
  sourceLocale: LocaleCode;
  targetLocale: LocaleCode;
  options: string[];
  allowMultiple: boolean;
}

export type TranslationRequest = AnnouncementTranslationRequest | PollTranslationRequest;

/** The draft a given request kind produces, so callers never re-check `kind`. */
export type TranslationDraftOf<T extends TranslationRequest> =
  T extends AnnouncementTranslationRequest
    ? AnnouncementTranslationDraft
    : T extends PollTranslationRequest
      ? PollTranslationDraft
      : never;

/** Translation service injected into AppEnv; tests supply a fake, production uses Workers AI. */
export type Translator = (request: TranslationRequest) => Promise<TranslationDraft>;
