// Optimistic pending-card projection — pure, so the upload store only wires it to state.

import type { Photo } from '$shared/types';
import type { MarkSet } from './ops';
import type { PhotoRecord } from './oplog';

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

/** The fields a hosted photo record states — everything a card renders, minus what the store
 *  owns (`id`, `uploader`, `marks`). */
export interface HostedPhotoFields {
  sha256: string;
  url: string;
  width: number;
  height: number;
  size: number;
  type: Photo['type'];
  createdAt: number;
}

/**
 * The cards the photo records still describe, in upload order.
 *
 * A record is the client's own durable word about a photo the album does not have yet: the worker
 * writes it as `uploading`, the page turns it into `hosted` in the same transaction that appends
 * the upload op, and a successful sync deletes it. So this projection is a filter, not a
 * reconstruction — there is no second place a photo's existence could be read from and disagree.
 *
 * `landed` is the album's own hashes and `live` the hashes of cards an in-memory job already
 * owns, so a photo is never drawn twice: the moment a snapshot carries a sha, or a job owns it,
 * its record-derived card is gone.
 */
export function hostedPhotoCards(
  records: readonly PhotoRecord[],
  seen: { landed: ReadonlySet<string>; live: ReadonlySet<string> },
): HostedPhotoFields[] {
  const out: HostedPhotoFields[] = [];
  for (const record of records) {
    // Only the hosted state has a URL and an upload op behind it; `uploading` and `failed`
    // records belong to the worker, which replays them as jobs of its own.
    if (record.status !== 'hosted') continue;
    const { sha256, url, meta, createdAt } = record;
    if (!url || !meta || createdAt === undefined) continue;
    if (seen.landed.has(sha256) || seen.live.has(sha256)) continue;
    out.push({
      sha256,
      url,
      width: meta.width,
      height: meta.height,
      size: meta.size,
      type: meta.type,
      createdAt,
    });
  }
  return out;
}

/** Whether two projections are the same cards, field for field. A re-read that changed nothing
 *  must not hand the layout a new array, or a failed sync would re-key the whole grid. */
export function sameHostedCards(
  a: readonly HostedPhotoFields[],
  b: readonly HostedPhotoFields[],
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
