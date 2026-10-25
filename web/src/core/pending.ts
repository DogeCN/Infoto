// Optimistic pending-card projection — pure, so the upload store only wires it to state.

import type { Photo } from '$shared/types';
import type { MarkSet } from './ops';

/** How far the hosted copy of a pending card's media has got in this page. */
export type HostedReadiness = 'pending' | 'ready' | 'failed';

/** The subset of a task snapshot that decides whether it renders a card. */
export interface CardStage {
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
