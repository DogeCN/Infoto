// Optimistic pending-card projection — pure, so the upload store only wires it to state.

import type { Photo } from '$shared/types';
import type { MarkSet } from './ops';

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
