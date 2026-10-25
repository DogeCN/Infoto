// Optimistic pending-card projection — pure, so the upload store only wires it to state.

import { MEDIA_TYPE, type Op, type Photo, type UploadPayload } from '$shared/types';
import type { MarkSet } from './ops';

/** How far the hosted copy of a pending card's media has got in this page. */
export type HostedReadiness = 'pending' | 'ready' | 'failed';

/**
 * The curtain a pending card draws over its media, threaded store → layout → card.
 *
 * `fraction` is upload progress for the lifting veil; `failed` replaces it with the full cover
 * and its retry. `preview` marks media that has not been hosted yet, so a decode failure is
 * treated as transient rather than as a missing file.
 */
export interface UploadOverlay {
  fraction?: number;
  failed?: boolean;
  /** Localised summary of the failure, shown on the cover. */
  error?: string;
  preview?: boolean;
}

/** The subset of a task snapshot that decides whether it renders a card. */
interface CardStage {
  phase: string;
  url?: string;
  meta?: unknown;
}

/**
 * Whether a task renders a card in the waterfall.
 *
 * Uploading and done jobs do. A failure only does once it reached the upload leg — it then has
 * an artifact on disk to preview and a retry that reuses it. A transcode failure leaves nothing
 * behind (the encoder aborts its partial file) and its source is a Blob that died with the page,
 * so it is a toast and no card: an empty card would be a hole in the grid whose retry starts the
 * whole job over.
 */
export function rendersCard(task: CardStage): boolean {
  if (task.phase === 'uploading' || task.phase === 'done') return true;
  return task.phase === 'failed' && (!!task.url || !!task.meta);
}

/**
 * The URL a pending card should render.
 *
 * While the hosted copy is still loading here, the already-decoded local preview keeps its
 * place: swapping `src` the moment the upload finishes replaced a painted image with one the
 * document had not fetched yet, which is the skeleton the user saw at completion. A failed
 * hosted load falls through to the hosted URL anyway, so the card can report the failure
 * instead of hiding it behind a stale local copy.
 */
export function pendingMediaUrl(
  hosted: string,
  local: string,
  readiness: HostedReadiness | undefined,
): string {
  if (hosted && readiness === 'pending' && local) return local;
  return hosted || local;
}

/** The fields one unconfirmed `upload` op states — everything a card renders, minus what the
 *  store owns (`id`, `uploader`, `marks`). */
export interface QueuedUploadFields {
  sha256: string;
  url: string;
  width: number;
  height: number;
  size: number;
  type: Photo['type'];
  createdAt: number;
}

/** A whole number within the range the server accepts for one media field. `min` is 0 for the
 *  box and the size because `/sync`'s `count()` accepts 0, and a zero box is the layout's job
 *  (`w: p.width || 1`), not a reason to hide a photo the server would keep. */
const mediaInt = (v: unknown, min: number): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : null;

/** A non-empty string within `max` characters, as `/sync`'s `text()` demands. */
const mediaText = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * The card an unconfirmed `upload` op describes, or null when the op is not a complete one.
 *
 * An upload op is written only once the facade has returned the photo's URL, so it is the whole
 * record of a photo that is hosted and paid for but not yet in the album — which is exactly what
 * a reload otherwise loses, because the card showing it lived in the upload store's memory and
 * the SharedWorker drops its resume record the moment the upload succeeds.
 *
 * The acceptance rules are the server's own (`routes/sync.ts` `planOp`), deliberately: an op the
 * server would drop must not draw a card that nothing can ever confirm, and an op it would keep
 * must not be hidden, which is the bug this projection exists to fix. `isAllowedMediaUrl` is the
 * one rule that cannot be mirrored here — it needs the Worker's environment — and a rejected URL
 * shows up as the card's own load failure instead.
 */
export function queuedUploadFromOp(op: Op): QueuedUploadFields | null {
  if (op.type !== 'upload') return null;
  const payload = (op.payload ?? {}) as Partial<UploadPayload>;
  const sha256 = mediaText(payload.sha256, 128);
  const url = mediaText(payload.url, 2048);
  if (!sha256 || !url) return null;
  const width = mediaInt(payload.width, 0);
  const height = mediaInt(payload.height, 0);
  const size = mediaInt(payload.size, 0);
  if (width === null || height === null || size === null) return null;
  const type = payload.type;
  if (type !== MEDIA_TYPE.IMAGE && type !== MEDIA_TYPE.ANIMATED && type !== MEDIA_TYPE.VIDEO)
    return null;
  const createdAt = mediaInt(payload.createdAt, 1);
  if (createdAt === null) return null;
  return { sha256, url, width, height, size, type, createdAt };
}

/**
 * The cards the op log states, in submission order — the cards a page load must show before any
 * sync trigger runs.
 *
 * `landed` is the album's own hashes and `live` the hashes of cards an in-memory job already
 * owns, so this projection can never double-draw a photo: the moment a snapshot carries a sha,
 * or a job owns it, the op-derived card is gone.
 *
 * Per sha the log's own last word decides, which is what keeps the card honest about deletion: an
 * `upload` op draws it, and a later `delete` for the same sha withdraws it. That tombstone is the
 * only durable record that the photo is gone — the withdrawal cannot remove the upload op
 * (`removeOpsBySha` matches `targetSha`, and an upload op carries none) — so without it, deleting
 * a card and reloading before the next sync brought the photo back. A later upload for the same
 * sha is the user putting the file back: it revives the card, and the newest op describes it.
 */
export function queuedUploadCards(
  ops: readonly Op[],
  seen: { landed: ReadonlySet<string>; live: ReadonlySet<string> },
): QueuedUploadFields[] {
  const cards = new Map<string, QueuedUploadFields>();
  for (const op of ops) {
    if (op.type === 'delete') {
      if (op.targetSha) cards.delete(op.targetSha);
      continue;
    }
    const fields = queuedUploadFromOp(op);
    if (!fields) continue;
    // Re-setting moves the sha to the end, so a re-upload keeps the log's order rather than the
    // position of the op it superseded.
    cards.delete(fields.sha256);
    cards.set(fields.sha256, fields);
  }
  const out: QueuedUploadFields[] = [];
  for (const [sha, fields] of cards) {
    if (seen.landed.has(sha) || seen.live.has(sha)) continue;
    out.push(fields);
  }
  return out;
}

/** Whether two projections are the same cards, field for field. A re-read that changed nothing
 *  must not hand the layout a new array, or a failed sync would re-key the whole grid. */
export function sameQueuedUploads(
  a: readonly QueuedUploadFields[],
  b: readonly QueuedUploadFields[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.sha256 !== y.sha256 ||
      x.url !== y.url ||
      x.width !== y.width ||
      x.height !== y.height ||
      x.size !== y.size ||
      x.type !== y.type ||
      x.createdAt !== y.createdAt
    )
      return false;
  }
  return true;
}

export interface PendingPhotoFields {
  id: number;
  sha256: string;
  url: string;
  uploader: number;
  width: number;
  height: number;
  size: number;
  type: Photo['type'];
  createdAt: number;
  marks: MarkSet;
}

/** The Photo an upload's optimistic card renders. */
export function pendingPhoto(fields: PendingPhotoFields): Photo {
  return {
    id: fields.id,
    sha256: fields.sha256,
    url: fields.url,
    uploader: fields.uploader,
    width: fields.width,
    height: fields.height,
    size: fields.size,
    createdAt: fields.createdAt,
    type: fields.type,
    likes: fields.marks.likes,
    dislikes: fields.marks.dislikes,
    reports: fields.marks.reports,
  };
}

/**
 * True when `cached` already describes these fields. The projection returns the cached object
 * while nothing changed, so a progress tick that did not touch this card does not hand Svelte a
 * new identity. Mark arrays compare by reference: the store replaces them only on a mark change.
 */
export function samePendingPhoto(cached: Photo | undefined, fields: PendingPhotoFields): boolean {
  return (
    cached !== undefined &&
    cached.id === fields.id &&
    cached.sha256 === fields.sha256 &&
    cached.url === fields.url &&
    cached.uploader === fields.uploader &&
    cached.width === fields.width &&
    cached.height === fields.height &&
    cached.size === fields.size &&
    cached.type === fields.type &&
    cached.createdAt === fields.createdAt &&
    cached.likes === fields.marks.likes &&
    cached.dislikes === fields.marks.dislikes &&
    cached.reports === fields.marks.reports
  );
}
