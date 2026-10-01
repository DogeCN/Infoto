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
      // Keep the local Worker on the official Turnstile test keys; the E2E helper
      // stubs the browser API, and verifyTurnstile accepts this published test secret.
      command:
        'npm run db:local && npm run dev:worker -- --var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA',
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
    {
      // Pipeline integration tests upload through the local facade stand-in.
      command: 'npm run dev:media',
      cwd: '..',
      port: 8788,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
