/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import type { InlineConfig } from 'vitest/node';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { seedMediaPlugin } from '../scripts/lib/seed-media.mjs';
import { injectFontRace } from '../src/shared/fonts.ts';

// Forward same-origin API requests to the local Worker.
const backend = 'http://127.0.0.1:8787';

const proxy = (extra: Record<string, unknown> = {}) => ({
  target: backend,
  changeOrigin: true,
  cookieDomainRewrite: '',
  ...extra,
});

// Resolve shared contracts, reusable utilities, and UI components.
const alias = {
  $shared: fileURLToPath(new URL('../src/shared', import.meta.url)),
  $base: fileURLToPath(new URL('./src/base', import.meta.url)),
  $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
};

function fontRacePlugin(): Plugin {
  return {
    name: 'font-race',
    transformIndexHtml(html) {
      return injectFontRace(html);
    },
  };
}

const config = {
  plugins: [seedMediaPlugin(), fontRacePlugin(), tailwindcss(), svelte()],
  resolve: { alias },
  // Pre-bundle worker dependencies before the first browser session.
  optimizeDeps: { include: ['mediabunny', 'hash-wasm'] },
  // Build straight into the Worker ASSETS directory. dist/ is gitignored —
  // the deploy workflow builds it (see .github/workflows/deploy.yml).
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    strictPort: true,
    port: 5173,
    // Exclude generated test artifacts from live reload.
    watch: {
      ignored: ['**/.tmp-*', '**/*.out', '**/.chk*', '**/.shot*', '**/test-results/**'],
    },
    proxy: {
      '/sync': proxy(),
      '/upload': proxy({ proxyTimeout: 120_000 }),
      '/l': proxy({ cookieDomainRewrite: false }),
      // Proxy admin API endpoints while retaining the SPA fallback for /admin.
      '/admin/migrate': proxy(),
      '/admin/announcements': proxy(),
      '/admin/feedback': proxy(),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
} satisfies UserConfig & { test: InlineConfig };

export default defineConfig(config);
