// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to
// reactive state. Every write goes op-log → /sync (spec: "设计理念"): mutate
// local state optimistically, append the op, let the engine submit.
//
// API surface used by call sites:
//   createAppStore()            — App.svelte (engine bound later via bindEngine)
//   createAppStore(engine)      — Admin.svelte
//   store.bindEngine(engine)    — subscribe engine state (syncing / pending)
//   store.applySync(response)   — server snapshot is authoritative; remap temp ids
//   store.removePhotos(ids)     — optimistic local removal (root delete)

import type { Announcement, Feedback, Op, Photo, SyncResponse } from '$shared/types';
import type { EngineState, SyncEngine } from '../core/sync/engine';
import type { PipelineTaskSnapshot } from '../transcode/pipeline';
import * as ops from '../core/ops';

/** 负数临时 id 分配器（ann_create / fb_create 乐观条目）。 */
let nextTempId = -1;
const takeTempId = (): number => nextTempId--;

class AppState {
	engineState = $state<EngineState>({ syncing: false, pending: 0 });
	lastSync = $state<SyncResponse | null>(null);
	/** jobId → task snapshot（harness / 未来 UI 订阅用）。 */
	tasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
	log = $state<string[]>([]);
	selfId = $state<number>(-1);
	photos = $state<Photo[]>([]);
	announcements = $state<Announcement[]>([]);
	feedback = $state<Feedback[]>([]);

	/** 尚未被服务端确认的临时 id（ann_create / fb_create 顺序）。 */
	private pendingAnnTempIds: number[] = [];
	private pendingFbTempIds: number[] = [];
	/** 最近一次服务端快照里出现过的真实 id，用于识别「新增」。 */
	private knownAnnIds = new Set<number>();
	private engine: SyncEngine | null = null;

	/** 订阅引擎状态（syncing / pending）。可重复调用，只绑定一次。 */
	bindEngine(engine: SyncEngine): void {
		if (this.engine === engine) return;
		this.engine = engine;
		engine.onState((s) => {
			this.engineState = { ...s };
		});
	}

	/** 提交一个 op 到 op-log（引擎负责在阈值 / 触发点提交）。 */
	private submit(op: Op): void {
		void this.engine?.addOp(op);
	}

	// ---- /sync 快照校正 -------------------------------------------------------

	/**
	 * 以服务端全量下发为准校正本地状态；临时 id 映射回真实 id。
	 * 「同步成功后本地状态以服务端全量下发为准校正」的唯一入口。
	 */
	applySync(r: SyncResponse): void {
		this.selfId = r.selfId;
		this.photos = r.photos;

		const { mapping, unresolved } = ops.resolveTempIds(
			this.pendingAnnTempIds,
			this.knownAnnIds,
			r.announcements,
		);
		this.announcements = r.announcements;
		// 已映射的临时 id 出队；未映射的（服务端还没返回）保留等待下次
		this.pendingAnnTempIds = unresolved;
		this.knownAnnIds = new Set(r.announcements.map((a) => a.id));
		void mapping;

		// feedback 只对根用户下发：根用户以服务端为准，非根用户清空乐观条目
		this.feedback = r.selfId === 0 ? r.feedback : [];
		this.pendingFbTempIds = [];

		this.lastSync = r;
	}

	// ---- 照片 -----------------------------------------------------------------

	/** 乐观移除（根用户 delete，无确认）。 */
	removePhotos(ids: number[]): void {
		this.photos = ops.applyDelete(this.photos, ids);
	}

	setMark(photoId: number, kind: ops.MarkKind, add: boolean): void {
		if (this.selfId < 0) return;
		this.photos = ops.applyMark(this.photos, photoId, kind, this.selfId, add);
		this.submit({ type: ops.markOpType(kind, add), target: photoId });
	}

	/** 单击切换：已标记则取消，未标记则标记。 */
	toggleMark(photoId: number, kind: ops.MarkKind): void {
		const p = this.photos.find((x) => x.id === photoId);
		if (!p) return;
		const field = kind === 'like' ? 'likes' : kind === 'dislike' ? 'dislikes' : 'reports';
		this.setMark(photoId, kind, !p[field].includes(this.selfId));
	}

	setMarkMany(ids: number[], kind: ops.MarkKind, add: boolean): void {
		if (this.selfId < 0) return;
		this.photos = ops.applyMarkMany(this.photos, ids, kind, this.selfId, add);
		for (const id of ids) this.submit({ type: ops.markOpType(kind, add), target: id });
	}

	/** 根用户删除（无确认，spec: "多选模式"）。 */
	deletePhotos(ids: number[]): void {
		if (this.selfId !== 0) return;
		this.removePhotos(ids);
		for (const id of ids) this.submit({ type: 'delete', target: id });
	}

	// ---- 公告 -----------------------------------------------------------------

	annCreate(title: string, contentMd: string): number {
		const tempId = takeTempId();
		this.announcements = ops.applyAnnCreate(this.announcements, tempId, title, contentMd, Date.now());
		this.pendingAnnTempIds.push(tempId);
		this.submit({ type: 'ann_create', payload: { title, contentMd } });
		return tempId;
	}

	annUpdate(id: number, title: string, contentMd: string): void {
		this.announcements = ops.applyAnnUpdate(this.announcements, id, title, contentMd, Date.now());
		this.submit({ type: 'ann_update', target: id, payload: { title, contentMd } });
	}

	annDelete(id: number): void {
		this.announcements = ops.applyAnnDelete(this.announcements, id);
		this.submit({ type: 'ann_delete', target: id });
	}

	/** 拖动排序：本地立即应用，同时提交全量 id 序列（重放安全）。 */
	annReorder(orderedIds: number[]): void {
		this.announcements = ops.applyAnnReorder(this.announcements, orderedIds);
		this.submit({ type: 'ann_reorder', payload: orderedIds });
	}

	react(annId: number, emoji: string | null): void {
		this.announcements = ops.applyReact(this.announcements, annId, this.selfId, emoji);
		this.submit({ type: 'react', target: annId, payload: { emoji } });
	}

	vote(annId: number, option: number | null): void {
		this.announcements = ops.applyVote(this.announcements, annId, this.selfId, option);
		this.submit({ type: 'vote', target: annId, payload: { option } });
	}

	// ---- 反馈 -----------------------------------------------------------------

	fbCreate(contentMd: string): void {
		const tempId = takeTempId();
		this.feedback = ops.applyFbCreate(this.feedback, tempId, this.selfId, contentMd, Date.now());
		this.pendingFbTempIds.push(tempId);
		this.submit({ type: 'fb_create', payload: { contentMd } });
	}

	fbDelete(id: number): void {
		this.feedback = ops.applyFbDelete(this.feedback, id);
		this.submit({ type: 'fb_delete', target: id });
	}

	/** 导入成功后清空本地状态，等待下一次全量 /sync 重建（spec: "SQL 导入"）。 */
	resetAfterImport(): void {
		this.announcements = [];
		this.feedback = [];
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
