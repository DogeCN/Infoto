// Infoto shared contract types — used by both runtimes (Worker / local Node)
// and the frontend (phase 2+). Keep this file stable and complete.

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

export interface Announcement {
	id: number;
	title: string;
	contentMd: string;
	/** Display order; normalized to 0…n-1 by ann_reorder. */
	sort: number;
	/** Millisecond epoch. */
	updatedAt: number;
	reactions: Array<{ userId: number; emoji: string }>;
}

export interface Feedback {
	id: number;
	userId: number;
	contentMd: string;
	createdAt: number;
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
	// announcement area (root only)
	| 'ann_create'
	| 'ann_update'
	| 'ann_delete'
	| 'ann_reorder'
	// feedback area
	| 'fb_create' // everyone
	| 'fb_delete' // root only
	// reaction area
	| 'react';

/** Payload carried by an `upload` op (metadata of a finished stage-2 upload). */
export interface UploadPayload {
	sha256: string;
	/** Image-host direct URL returned by /upload (`data` field). */
	url: string;
	width: number;
	height: number;
	size: number;
	type: MediaType;
}

/** Payload for `ann_create` / `ann_update`. */
export interface AnnouncementPayload {
	title: string;
	contentMd: string;
}

/** Payload for `fb_create`. */
export interface FeedbackPayload {
	contentMd: string;
}

/** Payload for `react`; empty/absent emoji clears the reaction. */
export interface ReactPayload {
	emoji?: string | null;
}

export type OpPayload =
	| UploadPayload
	| AnnouncementPayload
	| FeedbackPayload
	| ReactPayload
	| number[] // ann_reorder: full ordered id sequence
	| Record<string, unknown>;

/** One op-log entry, applied by /sync strictly in array order. */
export interface Op {
	type: OpType;
	/** Photo / announcement / feedback id the op applies to (null for `upload` / `ann_create` / `fb_create`). */
	target?: number | null;
	payload?: OpPayload | null;
}

export interface SyncRequest {
	/** Required exactly once, when no identity exists yet. */
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
 * 401 `turnstile_required` body — carries the public site key so the client
 * can render the Turnstile widget without any extra config endpoint.
 */
export interface TurnstileRequiredError {
	ok: false;
	error: 'turnstile_required';
	turnstileSiteKey: string | null;
}

/**
 * Image-host JSON returned verbatim by POST /upload.
 * Success: URL lives in `data`. Failure: human message in `msg` / `error`.
 */
export interface TcUploadResponse {
	data?: string;
	msg?: string;
	error?: string;
	[key: string]: unknown;
}
