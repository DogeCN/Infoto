/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Single-origin SPA: every backend call goes to {origin} (the Worker sends no CORS headers). In dev the
// proxy forwards API paths to the local Worker started by `wrangler dev` at the repo root (`npm run
// dev:worker`, port 8787) — no test-site redirect, no local shim runtime; the target is fixed by contract.
const backend = 'http://localhost:8787';

/**
 * Turnstile site key (public value). In production the server sends it in the 401 body; in dev we
 * read the same value from `.dev.vars` at the repo root, so the first visit goes straight into
 * Turnstile and skips a probe request that is bound to 401.
 */
function devTurnstileSiteKey(): string | undefined {
  const fromEnv = process.env['VITE_TURNSTILE_SITE_KEY'];
  if (fromEnv) return fromEnv;
  try {
    const vars = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    const m = /^TURNSTILE_SITE_KEY=(.+)$/m.exec(vars);
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const turnstileSiteKey = devTurnstileSiteKey();

const proxy = (extra: Record<string, unknown> = {}) => ({
  target: backend,
  changeOrigin: true,
  cookieDomainRewrite: 'localhost',
  ...extra,
});

// Shared code: $shared = contract types (one level up, next to the Worker),
// $base = DOM-free base libs + upload pipeline (web/src/base).
const alias = {
  $shared: fileURLToPath(new URL('../src/shared', import.meta.url)),
  $base: fileURLToPath(new URL('./src/base', import.meta.url)),
  $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
};

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: { alias },
  // Only inject when we have a value: undefined would break import.meta.env access
  define: turnstileSiteKey
    ? { 'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(turnstileSiteKey) }
    : {},
  // Pre-bundle at server start: discovering these deps mid-session (first page
  // that loads the video worker) re-optimizes deps and full-reloads the page —
  // fatal for e2e (execution contexts destroyed mid-test).
  optimizeDeps: { include: ['mediabunny', 'hash-wasm'] },
  // Build straight into the Worker ASSETS directory. dist/ is gitignored —
  // the deploy workflow builds it (see .github/workflows/deploy.yml).
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Temp scripts/output landing in web/ root make Vite full-reload on every watch event — each log
    // write would reload the page, freezing the user's tab and taking Workers down with it. Ignored explicitly.
    watch: {
      ignored: ['**/.tmp-*', '**/*.out', '**/.chk*', '**/.shot*', '**/test-results/**'],
    },
    proxy: {
      '/sync': proxy(),
      '/upload': proxy({ proxyTimeout: 120_000 }),
      '/l': proxy({ cookieDomainRewrite: false }),
      // Only proxy real endpoints under /admin; the /admin page itself is a front-end route. Proxying the whole path to the Worker returns the
      // built dist/index.html (hashed /assets) that does not exist on the dev server → Vite answers text/html, the browser blocks it → white
      // screen. In dev Vite's SPA fallback serves the shell (/src/main.ts) and the root check falls back to selfId === 0 from /sync (same as e2e).
      '/admin/migrate': proxy(),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
} as never);
