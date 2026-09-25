// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to
// reactive state. Every write goes op-log → /sync: mutate
// local state optimistically, append the op, let the engine submit.
//
// API surface used by call sites:
//   createAppStore()            — App.svelte (engine bound later via bindEngine)
//   createAppStore(engine)      — Admin.svelte
//   store.bindEngine(engine)    — subscribe engine state (syncing / pending)
//   store.applySync(response)   — server snapshot is authoritative; remap temp ids
//   store.removePhotos(ids)     — optimistic local removal (root delete)

import type { Announcement, Feedback, Op, Photo, SyncResponse } from '$shared/types';
import type { EngineState, SyncEngine, SyncSnapshotContext } from '../core/sync/engine';
import type { PipelineTaskSnapshot } from '../transcode/pipeline';
import * as ops from '../core/ops';

/** Allocate descending temporary IDs for optimistic announcements and feedback. */
let nextTempId = -1;
const takeTempId = (): number => nextTempId--;

export type AnnouncementReorderResult =
	| { ok: true }
	| { ok: false; reason: 'temporary-id' | 'enqueue-failed' | 'sync-failed' };

class AppState {
	engineState = $state<EngineState>({ syncing: false, pending: 0 });
	lastSync = $state<SyncResponse | null>(null);
	/** Task snapshots keyed by job ID. */
	tasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
	log = $state<string[]>([]);
	selfId = $state<number>(-1);
	photos = $state<Photo[]>([]);
	announcements = $state<Announcement[]>([]);
	feedback = $state<Feedback[]>([]);
	pendingAnnouncementIds = $state<Set<number>>(new Set());

	private pendingAnnTempIds: number[] = [];
	private pendingFbTempIds: number[] = [];
	private pendingAnnouncementMutations: ops.PendingAnnouncementMutation[] = [];
	private knownAnnIds = new Set<number>();
	private engine: SyncEngine | null = null;

	/** Bind engine state; repeated calls with the same engine are ignored. */
	bindEngine(engine: SyncEngine): void {
		if (this.engine === engine) return;
		this.engine = engine;
		engine.onState((state) => {
			this.engineState = { ...state };
		});
	}

	private submit(op: Op): Promise<number | null> {
		return this.engine?.addOp(op) ?? Promise.resolve(null);
	}

	private trackAnnouncement(ids: number[], reorder = false): void {
		this.pendingAnnouncementMutations = ops.markAnnouncementPending(
			this.pendingAnnouncementMutations,
			ids,
			this.engine?.currentSyncAttempt ?? 0,
			reorder,
		);
		this.pendingAnnouncementIds = new Set(
			this.pendingAnnouncementMutations.flatMap((mutation) => mutation.ids),
		);
	}

	/** Apply one authoritative full snapshot and return its temp-ID mapping. */
	applySync(r: SyncResponse, context?: SyncSnapshotContext): Map<number, number> {
		this.selfId = r.selfId;
		this.photos = r.photos;

		const { mapping, unresolved } = ops.resolveTempIds(
			this.pendingAnnTempIds,
			this.knownAnnIds,
			r.announcements,
		);
		const snapshotAttempt = context?.attempt ?? (this.engine?.currentSyncAttempt ?? 0) + 1;
		const serverIds = new Set(r.announcements.map((announcement) => announcement.id));
		const pending = ops.reconcileAnnouncementPending(
			this.pendingAnnouncementMutations,
			serverIds,
			mapping,
			snapshotAttempt,
		);
		const protectedIds = new Set(
			pending.mutations.flatMap((mutation) => mutation.ids),
		);
		if (protectedIds.size > 0) {
			let next = [...r.announcements];
			for (const local of this.announcements) {
				const localId = mapping.get(local.id) ?? local.id;
				if (!protectedIds.has(localId)) continue;
				const index = next.findIndex((announcement) => announcement.id === localId);
				if (index >= 0) next[index] = { ...local, id: localId };
				else next.push({ ...local, id: localId });
			}
			if (pending.mutations.some((mutation) => mutation.reorder)) {
				const localOrder = this.announcements.map((announcement) => mapping.get(announcement.id) ?? announcement.id);
				next = ops.applyAnnReorder(next, localOrder);
			}
			this.announcements = next;
		} else {
			this.announcements = r.announcements;
		}
		this.pendingAnnouncementMutations = pending.mutations;
		this.pendingAnnouncementIds = pending.pendingIds;
		this.pendingAnnTempIds = unresolved;
		this.knownAnnIds = new Set(serverIds);
		this.feedback = r.selfId === 0 ? r.feedback : [];
		this.pendingFbTempIds = [];
		this.lastSync = r;
		return mapping;
	}

	// Photos

	/** Optimistic root delete without confirmation. */
	removePhotos(ids: number[]): void {
		this.photos = ops.applyDelete(this.photos, ids);
	}

	setMark(photoId: number, kind: ops.MarkKind, add: boolean): void {
		if (this.selfId < 0) return;
		this.photos = ops.applyMark(this.photos, photoId, kind, this.selfId, add);
		void this.submit({ type: ops.markOpType(kind, add), target: photoId });
	}

	/** Toggle one mark; likes and dislikes remain mutually exclusive. */
	toggleMark(photoId: number, kind: ops.MarkKind): void {
		const p = this.photos.find((x) => x.id === photoId);
		if (!p) return;
		const field = kind === 'like' ? 'likes' : kind === 'dislike' ? 'dislikes' : 'reports';
		const has = p[field].includes(this.selfId);
		if (!has && kind !== 'report') {
			// One photo can carry either like or dislike, never both.
			const other = kind === 'like' ? 'dislikes' : 'likes';
			const otherKind: ops.MarkKind = kind === 'like' ? 'dislike' : 'like';
			if (p[other].includes(this.selfId)) this.setMark(photoId, otherKind, false);
		}
		this.setMark(photoId, kind, !has);
	}

	setMarkMany(ids: number[], kind: ops.MarkKind, add: boolean): void {
		if (this.selfId < 0) return;
		this.photos = ops.applyMarkMany(this.photos, ids, kind, this.selfId, add);
		for (const id of ids) void this.submit({ type: ops.markOpType(kind, add), target: id });
	}

	/** Optimistic root delete for multi-selection. */
	deletePhotos(ids: number[]): void {
		if (this.selfId !== 0) return;
		this.removePhotos(ids);
		for (const id of ids) void this.submit({ type: 'delete', target: id });
	}

	// Announcements

	annCreate(title: string, contentMd: string): number {
		const tempId = takeTempId();
		this.announcements = ops.applyAnnCreate(this.announcements, tempId, title, contentMd, Date.now());
		this.pendingAnnTempIds.push(tempId);
		this.trackAnnouncement([tempId]);
		void this.submit({ type: 'ann_create', payload: { title, contentMd } });
		return tempId;
	}

	annUpdate(id: number, title: string, contentMd: string): void {
		this.announcements = ops.applyAnnUpdate(this.announcements, id, title, contentMd, Date.now());
		this.trackAnnouncement([id]);
		void this.submit({ type: 'ann_update', target: id, payload: { title, contentMd } });
	}

	annDelete(id: number): void {
		this.announcements = ops.applyAnnDelete(this.announcements, id);
		void this.submit({ type: 'ann_delete', target: id });
	}

	async annReorder(orderedIds: number[]): Promise<AnnouncementReorderResult> {
		if (orderedIds.some((id) => id < 0)) return { ok: false, reason: 'temporary-id' };
		if (!this.engine) return { ok: false, reason: 'enqueue-failed' };
		const previousIds = this.announcements.map((announcement) => announcement.id);
		this.announcements = ops.applyAnnReorder(this.announcements, orderedIds);
		this.trackAnnouncement(orderedIds, true);
		let version: number;
		try {
			const queuedVersion = await this.submit({ type: 'ann_reorder', payload: orderedIds });
			if (queuedVersion === null) throw new Error('sync engine unavailable');
			version = queuedVersion;
		} catch {
			this.announcements = ops.rollbackAnnouncementOrder(this.announcements, previousIds);
			const failedIndex = this.pendingAnnouncementMutations.findLastIndex(
				(mutation) => mutation.reorder && mutation.ids.join(',') === orderedIds.join(','),
			);
			this.pendingAnnouncementMutations = this.pendingAnnouncementMutations.filter(
				(_, index) => index !== failedIndex,
			);
			this.pendingAnnouncementIds = new Set(
				this.pendingAnnouncementMutations.flatMap((mutation) => mutation.ids),
			);
			return { ok: false, reason: 'enqueue-failed' };
		}
		const result = await this.engine.flushThrough(version);
		if (!result.ok) {
			this.announcements = ops.rollbackAnnouncementOrder(this.announcements, previousIds);
			return { ok: false, reason: 'sync-failed' };
		}
		return { ok: true };
	}

	react(annId: number, emoji: string | null): void {
		this.announcements = ops.applyReact(this.announcements, annId, this.selfId, emoji);
		void this.submit({ type: 'react', target: annId, payload: { emoji } });
	}

	vote(annId: number, option: number | null): void {
		this.announcements = ops.applyVote(this.announcements, annId, this.selfId, option);
		void this.submit({ type: 'vote', target: annId, payload: { option } });
	}

	// Feedback

	fbCreate(contentMd: string): void {
		const tempId = takeTempId();
		this.feedback = ops.applyFbCreate(this.feedback, tempId, this.selfId, contentMd, Date.now());
		this.pendingFbTempIds.push(tempId);
		void this.submit({ type: 'fb_create', payload: { contentMd } });
	}

	fbDelete(id: number): void {
		this.feedback = ops.applyFbDelete(this.feedback, id);
		void this.submit({ type: 'fb_delete', target: id });
	}

	/** Clear local state after SQL import and wait for a full snapshot. */
	resetAfterImport(): void {
		this.announcements = [];
		this.feedback = [];
		this.pendingAnnouncementIds = new Set();
		this.pendingAnnouncementMutations = [];
		this.pendingAnnTempIds = [];
		this.pendingFbTempIds = [];
		this.knownAnnIds = new Set();
	}
}

export type AppStore = AppState;

export function createAppStore(engine?: SyncEngine): AppState {
	const store = new AppState();
	if (engine) store.bindEngine(engine);
	return store;
}
