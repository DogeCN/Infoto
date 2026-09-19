import { defineConfig } from '@playwright/test';

// E2E: real Chromium against the Vite dev server. Every API call is forwarded by
// the dev proxy to the local Worker started with `wrangler dev` (port 8787) over
// its local D1 — no test-deployment redirect. Serial because all tests share
// that one local D1.
export default defineConfig({
	testDir: './tests/e2e',
	timeout: 120_000,
	retries: 0,
	workers: 1,
	use: {
		baseURL: 'http://localhost:5173',
		browserName: 'chromium',
		viewport: { width: 1280, height: 800 },
	},
	webServer: [
		{
			// Bootstrap the local D1 (idempotent: schema.sql is IF NOT EXISTS) then
			// serve the Worker. Both run from the repo root.
			command: 'npm run db:local && npm run dev:worker',
			cwd: '..',
			// Wait on the listening port: the Worker only answers 200 to
			// authenticated POSTs, so a URL probe would read its 404 as "not ready".
			port: 8787,
			reuseExistingServer: true,
			timeout: 60_000,
		},
		{
			command: 'npm run dev',
			url: 'http://localhost:5173',
			reuseExistingServer: true,
			timeout: 30_000,
		},
	],
});
