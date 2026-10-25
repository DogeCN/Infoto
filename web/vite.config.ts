/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import type { InlineConfig } from 'vitest/node';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { injectFonts } from '../src/shared/fonts.ts';

/** `git` output, or null when git is unavailable (a tarball build). */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The latest tag is the version, whether or not HEAD sits on it: a build off `main` shows the
 * release it descends from, which is what a reader of the sidebar wants. `package.json` is the
 * fallback for a build with no git and no tags, not the source of truth — a release is a tag
 * push, with no file to edit.
 */
function buildVersion(): { version: string; hash: string } {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return {
    version: git(['describe', '--tags', '--abbrev=0']) ?? `v${pkg.version}`,
    hash: git(['rev-parse', '--short', 'HEAD']) ?? 'unknown',
  };
}

const { version: appVersion, hash: commitHash } = buildVersion();

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

function fontsPlugin(): Plugin {
  return {
    name: 'fonts',
    transformIndexHtml(html) {
      return injectFonts(html);
    },
  };
}

const config = {
  plugins: [fontsPlugin(), tailwindcss(), svelte()],
  resolve: { alias },
  // The sidebar's version label; see `buildVersion()`.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
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
      '/l': proxy({ cookieDomainRewrite: false }),
      // Proxy admin API endpoints while retaining the SPA fallback for /admin.
      '/admin/migrate': proxy(),
      '/admin/announcements': proxy(),
      '/admin/polls': proxy(),
      '/admin/feedback': proxy(),
      '/admin/translate': proxy(),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
} satisfies UserConfig & { test: InlineConfig };

export default defineConfig(config);
