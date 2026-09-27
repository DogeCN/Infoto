import { defineConfig } from '@playwright/test';

// Browser regressions use Vite and the local Worker; UI tests mock album responses.
// Run serially because integration tests share local D1.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    // Use PW_CHANNEL when supplied, system Edge on Windows, or bundled Chromium elsewhere.
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
