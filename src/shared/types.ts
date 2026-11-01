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

/** Full photo metadata, downloaded wholesale with the `welcome` snapshot. */
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

/** All op kinds the write path accepts, applied in order by the /ws Durable Object. */
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
  // feedback area (create is everyone; delete/reorder are root only)
  | 'fb_create' // everyone
  | 'fb_delete' // root only
  | 'fb_reorder' // root only
  // reaction area
  | 'react'
  // announcement area (root only; the admin CRUD moved off HTTP per ADR 0026)
  | 'ann_create'
  | 'ann_update'
  | 'ann_delete'
  | 'ann_reorder'
  // poll area (root only; a save overwrites the whole poll, votes included — ADR 0022)
  | 'poll_create'
  | 'poll_update'
  | 'poll_delete'
  | 'poll_reorder';

/** Payload carried by an `upload` op (metadata of a photo already on the host). */
export interface UploadPayload {
  /** Server-assigned photo id, present on applied echoes and omitted by upload clients. */
  id?: number;
  sha256: string;
  /** Image-host direct URL returned by /upload (`data` field). */
  url: string;
  width: number;
  height: number;
  size: number;
  type: MediaType;
  /** When the upload URL was obtained (ms epoch), reported by the uploading client and
   *  bounded by the server clock. The client stamps this when it commits the op, so an
   *  offline backlog lands with its real per-photo ordering (ADR 0026). */
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

/** One op-log entry, applied strictly in array order. */
export interface Op {
  type: OpType;
  /** Poll ID for votes; announcement ID for reactions. Photo operations use targetSha instead. */
  target?: number | null;
  /** Photo ops: the target photo's sha256. */
  targetSha?: string;
  payload?: OpPayload | null;
  /** Client nonce correlating an op with the ack that confirms it. The server stores it
   *  with the op and echoes it in broadcasts and catch-up, which makes a re-sent backlog
   *  idempotent and lets the originating tab skip its own echo. */
  cid?: string;
  /** Millisecond epoch when the client committed the op — display metadata only. The
   *  authoritative ts is generated by the Durable Object (ADR 0026); a client clock can
   *  never move server state into the future. */
  ct?: number;
}

/** The album state a client hydrates from, carried whole in `welcome`. */
export interface AlbumSnapshot {
  photos: Photo[];
  /** Every locale's rows: the client filters by its content locale, so a language switch
   *  never needs another round trip. */
  announcements: Announcement[];
  polls: Poll[];
  /** Real data for the root user only; empty for everyone else. */
  feedback: Feedback[];
}

/** One full snapshot plus the identity context it arrived with. `welcome` flattens its
 *  nested snapshot into this shape; the IndexedDB snapshot cache keeps it, so a snapshot
 *  cached by an older build simply carries ignored extra fields. */
export type SyncResponse = AlbumSnapshot & {
  selfId: number;
  /** Where the browser POSTs artifacts. The standalone facade owns the image host and its
   *  credentials, so this server never sees an upload or a TC_SECRET. */
  mediaHostUrl: string;
};

/** One applied op as broadcast to every connection and replayed on catch-up. */
export interface AppliedOp {
  /** Server-assigned order across the whole album (single Durable Object). */
  seq: number;
  op: Op;
  /** User id of the writer. */
  actor: number;
  /** Authoritative server stamp (ms epoch) — generated by the Durable Object. */
  ts: number;
  /** Echoed from the client's op, for ack correlation. */
  cid?: string;
}

/** Client → server frames on the /ws WebSocket (ADR 0026). */
export interface WsHelloFrame {
  type: 'hello';
  /** Required when the upgrade request's uuid cookie resolved no identity. */
  turnstileToken?: string;
  /** Highest applied-op sequence this client has already seen; the server answers with
   *  the ops after it, or a whole snapshot when the gap is beyond its retained window. */
  lastSeq?: number;
}
export interface WsOpsFrame {
  type: 'ops';
  /** The whole pending backlog in one frame; chunked only past MAX_SYNC_OPS. */
  ops: Op[];
}
export interface WsPingFrame {
  type: 'ping';
}
export type WsClientFrame = WsHelloFrame | WsOpsFrame | WsPingFrame;

/** Server → client frames on the /ws WebSocket. */
export interface WsWelcomeFrame {
  type: 'welcome';
  selfId: number;
  /** The session identity; the client mirrors it into its uuid cookie. */
  uuid: string;
  mediaHostUrl: string;
  /** Highest applied-op sequence on the server at welcome time. The coordinator adopts it
   *  as its stored position — which also resets a client whose stored lastSeq was left
   *  ahead of a rehydrated log, instead of starving it on whole snapshots. */
  seq: number;
  /** Carried whole when the client's lastSeq is behind the retained window (or absent);
   *  absent when the client is catching up incrementally. */
  snapshot?: AlbumSnapshot;
  /** The ops after the client's lastSeq, when no snapshot rides along. */
  ops?: AppliedOp[];
}
export interface WsErrorFrame {
  type: 'error';
  error: string;
  /** Public Turnstile site key, carried by `turnstile_required`. */
  turnstileSiteKey?: string | null;
  /** The refused op's client nonce, carried by `op_dropped`. */
  cid?: string;
}
export interface WsOpsBroadcastFrame {
  type: 'ops';
  /** The ops one ingest batch produced, in application order — every connection gets it. */
  applied: AppliedOp[];
}
export interface WsPongFrame {
  /** The keepalive answer only; nobody reads a clock off it — op timestamps are
   *  server-stamped at ingest. */
  type: 'pong';
}
export type WsServerFrame = WsWelcomeFrame | WsErrorFrame | WsOpsBroadcastFrame | WsPongFrame;

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
