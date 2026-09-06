/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Single-origin SPA: every backend call goes to {origin} (the Worker sends no
// CORS headers). Dev proxy forwards API paths to the backend stack;
// INFOTO_BACKEND lets E2E point the proxy at a local wrangler/node stack
// (default: the real test domain).
const backend = process.env.INFOTO_BACKEND ?? 'https://dev.infoto.cc.cd';

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
};

export default defineConfig({
	plugins: [svelte()],
	resolve: { alias },
	// Build straight into the Worker ASSETS directory (dist/ is committed).
	build: { outDir: '../dist', emptyOutDir: true },
	server: {
		port: 5173,
		proxy: {
			'/sync': proxy(),
			'/upload': proxy({ proxyTimeout: 120_000 }),
			'/l': proxy({ cookieDomainRewrite: false }),
		},
	},
	test: {
		include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'node',
	},
} as never);
