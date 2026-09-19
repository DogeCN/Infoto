/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Single-origin SPA: every backend call goes to {origin} (the Worker sends no
// CORS headers). In dev the proxy forwards API paths to the local Worker started
// by `wrangler dev` at the repo root (`npm run dev:worker`, port 8787) — no
// test-site redirect, no local shim runtime. The target is fixed by contract.
const backend = 'http://localhost:8787';

const proxy = (extra: Record<string, unknown> = {}) => ({
	target: backend,
	changeOrigin: true,
	cookieDomainRewrite: 'localhost',
	...extra,
});

// Shared code has a single source of truth in the base repo tree one level up:
// $shared = contract types, $base = DOM-free base libs + upload pipeline.
const alias = {
	$shared: fileURLToPath(new URL('../src/shared', import.meta.url)),
	$base: fileURLToPath(new URL('../src/ui', import.meta.url)),
	$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
};

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: { alias },
	// Pre-bundle at server start: discovering these deps mid-session (first page
	// that loads the video worker) re-optimizes deps and full-reloads the page —
	// fatal for e2e (execution contexts destroyed mid-test).
	optimizeDeps: { include: ['mediabunny', 'hash-wasm'] },
	// Build straight into the Worker ASSETS directory. dist/ is gitignored —
	// the deploy workflow builds it (see .github/workflows/deploy.yml).
	build: { outDir: '../dist', emptyOutDir: true },
	server: {
		port: 5173,
		proxy: {
			'/sync': proxy(),
			'/upload': proxy({ proxyTimeout: 120_000 }),
			'/l': proxy({ cookieDomainRewrite: false }),
			'/admin': proxy(),
		},
	},
	test: {
		include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'node',
	},
} as never);
