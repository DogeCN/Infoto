<script lang="ts">
	// Dev-only panel: buttons trigger each flow + event log. Not polished, never
	// shipped in the product bundle.
	import { onMount } from 'svelte';
import { ensureIdentity } from '../core/identity';
import { getEngine } from '../core/sync/engine';
import { UploadPipeline } from '../transcode/pipeline';
import type { PipelineTaskSnapshot } from '../transcode/pipeline';
import { postSync } from '../core/api/syncClient';

let engine = $state<ReturnType<typeof getEngine> | null>(null);
let pending = $state(0);
let syncing = $state(false);
let logLines = $state<string[]>([]);
let tasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
let selfId = $state<number | null>(null);
let photoCount = $state<number | null>(null);
let fileInput = $state<HTMLInputElement | null>(null);

function log(line: string) {
	logLines = [...logLines.slice(-200), `${new Date().toLocaleTimeString()} ${line}`];
}

let pipeline: UploadPipeline | null = null;

onMount(() => {
	const eng = getEngine({
		onSyncResponse: (r) => {
			selfId = r.selfId;
			photoCount = r.photos.length;
			log(`/sync ok: selfId=${r.selfId} photos=${r.photos.length}`);
		},
		onError: (phase, e) => log(`/sync failed (${phase}): ${String(e)}`),
	});
	engine = eng;
	eng.onState((s) => {
		pending = s.pending;
		syncing = s.syncing;
	});
	void eng.init();
	eng.install(window);

	pipeline = new UploadPipeline({ onEvent: log });
	pipeline.onTask((t) => {
		tasks = new Map(tasks);
		tasks.set(t.jobId, t);
	});
	pipeline.start();
	log('harness ready (SharedWorker / BroadcastChannel connected)');
	// E2E injection point (dev harness only, never in product code)
	(window as unknown as { __pipeline?: unknown }).__pipeline = pipeline;
});

async function runIdentity() {
		log('identity flow: probing with an empty /sync for 401…');
		const e2e = new URLSearchParams(window.location.search).has('e2e');
		try {
			const { response, firstEntry } = await ensureIdentity([], {
				postSyncFn: postSync,
				// E2E: skip the real widget; the dev deployment's allow-branch
				// (Turnstile secret unset) accepts the fake token
				...(e2e ? { getTokenFn: async () => 'e2e-token' } : {}),
			});
		selfId = response.selfId;
		photoCount = response.photos.length;
		log(`identity flow done firstEntry=${firstEntry} selfId=${response.selfId}`);
	} catch (e) {
		log(`identity flow failed: ${String(e)}`);
	}
}

function pickFiles() {
	// accept matches routeByMime coverage: image/*,video/* (contract audit clause)
	fileInput?.click();
}

function onFiles(e: Event) {
	const input = e.target as HTMLInputElement;
	if (input.files?.length) pipeline?.addFiles(input.files);
	input.value = '';
}

async function manualSync() {
	log('manual /sync…');
	await engine?.sync();
}

function phaseText(p: string): string {
	return p;
}
</script>

<div style="font-family: monospace; padding: 16px; background: #0a0e1a; color: #e2e8f0; min-height: 100vh">
	<h1 style="font-size: 18px; margin: 0 0 12px">Infoto dev harness (not shipped)</h1>

	<section style="margin-bottom: 12px">
		<button onclick={runIdentity}>identity (Turnstile → /sync)</button>
		<button onclick={pickFiles}>pick files (image/*,video/*)</button>
		<button onclick={manualSync}>manual sync</button>
		<input bind:this={fileInput} type="file" accept="image/*,video/*" multiple hidden onchange={onFiles} />
	</section>

	<section style="margin-bottom: 12px">
		<div>pending ops: {pending}{syncing ? ' (syncing…)' : ''}</div>
		<div>selfId: {selfId ?? 'none'}　photos: {photoCount ?? '-'}</div>
	</section>

	<section style="margin-bottom: 12px">
		<h2 style="font-size: 14px; margin: 0 0 6px">tasks</h2>
		{#each tasks.values() as t (t.jobId)}
			<div style="margin-bottom: 4px">
				{t.fileName} — {phaseText(t.phase)}
				{#if t.fraction !== undefined}({Math.round(t.fraction * 100)}%){/if}
				{#if t.phase === 'failed'}
					<button onclick={() => pipeline?.retry(t.jobId)}>retry</button>
				{/if}
				{#if t.url}<span style="color: #10b981">done</span>{/if}
			</div>
		{/each}
	</section>

	<section>
		<h2 style="font-size: 14px; margin: 0 0 6px">event log</h2>
		<div style="max-height: 50vh; overflow-y: auto; white-space: pre-wrap; color: #7b85a0">
			{#each logLines as line}
				<div>{line}</div>
			{/each}
		</div>
	</section>
</div>
