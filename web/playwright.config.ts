import { defineConfig } from '@playwright/test';

// E2E: real Chromium against the Vite dev server. Every API call is forwarded
// by the dev proxy to the test deployment (INFOTO_API_ORIGIN, default
// https://dev.infoto.cc.cd) — no local Worker / local database ever runs here.
export default defineConfig({
	testDir: './tests/e2e',
	timeout: 120_000,
	retries: 0,
	use: {
		baseURL: 'http://localhost:5173',
		browserName: 'chromium',
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:5173',
		reuseExistingServer: true,
		timeout: 30_000,
	},
});
