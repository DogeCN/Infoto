/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Single-origin SPA: every backend call goes to {origin} (the Worker sends no
// CORS headers). In dev the proxy forwards API paths to the local Worker started
// by `wrangler dev` at the repo root (`npm run dev:worker`, port 8787) — no
// test-site redirect, no local shim runtime. The target is fixed by contract.
const backend = 'http://localhost:8787';

/**
 * Turnstile 站点密钥（公开值）。生产由服务端 401 body 下发；dev 下从根目录
 * `.dev.vars` 读同一份，让首访直接进 Turnstile，省掉一次必然 401 的探测请求。
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
  // 仅在有值时注入：undefined 会破坏 import.meta.env 访问
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
    // 临时脚本/输出若落在 web/ 根目录，Vite 一监听到就整页 reload —— 脚本每写一次
    // 日志就重载一次页面，能把用户标签页刷成"卡死"、把 Worker 一起拖崩。显式忽略。
    watch: {
      ignored: ['**/.tmp-*', '**/*.out', '**/.chk*', '**/.shot*', '**/test-results/**'],
    },
    proxy: {
      '/sync': proxy(),
      '/upload': proxy({ proxyTimeout: 120_000 }),
      '/l': proxy({ cookieDomainRewrite: false }),
      // 只代理 admin 下的真实接口。/admin 页面本身是前端路由：若整路径
      // 代理给 Worker，它会返回构建产物 dist/index.html（引用带哈希的
      // /assets/index-*.js/css），而这些文件在 dev server 上不存在，
      // Vite 回退返回 index.html(text/html) → 浏览器按 MIME 拦截 → /admin
      // 白屏。dev 下由 Vite 的 SPA 回退吐出 dev shell（/src/main.ts），
      // 根用户边界由 /sync 下发的 selfId === 0 在前端兜底（同 e2e 约定）。
      '/admin/migrate': proxy(),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
} as never);
