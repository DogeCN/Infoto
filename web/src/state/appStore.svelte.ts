// Svelte 5 runes thin adapter — core logic stays Svelte-free (contract's
// directory note). Mirrors engine / pipeline snapshots into reactive state
// for the harness (and future UI) to subscribe to.

import type { SyncResponse } from '$shared/types';
import type { EngineState, SyncEngine } from '../core/sync/engine';
import type { PipelineTaskSnapshot } from '../transcode/pipeline';

/** Svelte 5 runes: $state only works in .ts inside a .svelte.ts file — that is this file's convention. */

export interface AppStore {
	engineState: EngineState;
	lastSync: SyncResponse | null;
	/** jobId → task snapshot. */
	tasks: Map<string, PipelineTaskSnapshot>;
	log: string[];
}

export function createAppStore(engine: SyncEngine): AppStore {
	return {
		engineState: $state<EngineState>({ syncing: false, pending: 0 }),
		lastSync: $state<SyncResponse | null>(null),
		tasks: $state<Map<string, PipelineTaskSnapshot>>(new Map()),
		log: $state<string[]>([]),
	};
}
