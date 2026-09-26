import { defineConfig } from '@playwright/test';

// E2E: real Chromium against the Vite dev server, every API call proxied to the
// local Worker (`wrangler dev`, port 8787) on its local D1. Serial because all
// tests share that one local D1.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    // 本机（Windows）未下载 Playwright 的 chromium 构建，直接用系统 Edge；
    // 其他平台（如 CI Linux）回退到 Playwright 自带的 chromium。
    // PW_CHANNEL 可显式覆盖（如 CI 上指定 chrome）。
    channel: process.env['PW_CHANNEL'] || (process.platform === 'win32' ? 'msedge' : undefined),
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
      // Wrangler startup can stall on telemetry/update probes under
      // restricted local-network setups; give it room before failing.
      timeout: 180_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
