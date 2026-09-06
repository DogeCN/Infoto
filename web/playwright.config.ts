import { defineConfig } from '@playwright/test';

// B2 E2E：真实 Chromium。A 线（身份/op 语义）打本地 wrangler dev；
// B 线（转码上传管线）经 Vite dev proxy 打真实测试域名。
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
