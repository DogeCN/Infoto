// Infoto shared contract types — used by both runtimes (Worker / local Node)
// and the frontend.

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

/** One vote row: one option per user per announcement (0-based index). */
export interface Vote {
  userId: number;
  option: number;
}

export interface Announcement {
  id: number;
  title: string;
  contentMd: string;
  /** Display order; normalized to 0…n-1 by the admin reorder API. */
  sort: number;
  /** Millisecond epoch. */
  updatedAt: number;
  reactions: Reaction[];
  votes: Vote[];
}

export interface Feedback {
  id: number;
  userId: number;
  contentMd: string;
  createdAt: number;
  /** Manual (root-only) display order; lowest first. */
  sort: number;
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
  // vote area (everyone, targets an announcement)
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

/** Payload for `fb_create`. */
export interface FeedbackPayload {
  contentMd: string;
}

/** Payload for `react`; empty/absent emoji clears the reaction. */
export interface ReactPayload {
  emoji?: string | null;
}

/** Payload for `vote`; option is the 0-based choice index, null retracts the vote. */
export interface VotePayload {
  option: number | null;
}

export type OpPayload =
  UploadPayload | FeedbackPayload | ReactPayload | VotePayload | Record<string, unknown>;

/** One op-log entry, applied by /sync strictly in array order. */
export interface Op {
  type: OpType;
  /**
   * Announcement / feedback numeric id (vote, react). PHOTO ops never use a numeric id:
   * an id is only the external `/l/{id36}` link index, while sha256 is the stable unique
   * index of a photo. An in-flight upload has no id yet, and hash resolution works for
   * every photo regardless of when the op was written.
   */
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
  /** Server millisecond clock, used to correct optimistic timestamps. */
  serverTime: number;
  selfId: number;
  photos: Photo[];
  announcements: Announcement[];
  /** Real data for the root user only; empty array for everyone else. */
  feedback: Feedback[];
}

/**
 * Image-host JSON returned verbatim by POST /upload: URL in `data`, message in `msg` / `error`.
 */
export interface TcUploadResponse {
  data?: string;
  msg?: string;
  error?: string;
  [key: string]: unknown;
}
