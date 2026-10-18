// Guards wrangler.toml's `run_worker_first` against the Worker's own route table.
//
// Cloudflare serves static assets before the Worker, and a request it does not serve never
// reaches it: a browser navigation gets index.html from `not_found_handling`, and any other
// method gets a bare 405 with an empty body. Both failures are invisible locally — wrangler dev
// routes everything to the Worker, and a curl without Sec-Fetch-* is not a navigation. Listing
// a route here is therefore the only thing standing between a new endpoint and a production
// 405, so the list is asserted against `createApp()` rather than left to review.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp, type AppEnv } from './app.ts';

const toml = readFileSync(path.join(import.meta.dirname, '..', '..', 'wrangler.toml'), 'utf8');

/** The patterns as a route table would see them, without needing a TOML parser. */
function runWorkerFirst(): string[] {
  const m = toml.match(/^run_worker_first\s*=\s*\[([^\]]*)\]/m);
  assert.ok(m, 'wrangler.toml has no run_worker_first array');
  return (m[1]!.match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1));
}

/** Does a concrete request path satisfy a `run_worker_first` pattern? */
function matches(pattern: string, routePath: string): boolean {
  const rx = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  // `/admin/announcements/:id` is one segment; substitute a sample value so the shape is
  // what gets matched rather than the literal parameter name.
  const concrete = routePath.replace(/:[^/]+/g, 'sample');
  return rx.test(concrete);
}

/** `/admin/*` in Hono is the catch-all for the management page, not a served API path. */
function isWorkerOwned(routePath: string): boolean {
  return routePath !== '/' && !routePath.endsWith('/*');
}

test('run_worker_first: every Worker route reaches the Worker', () => {
  const patterns = runWorkerFirst();
  assert.ok(patterns.length > 0, 'run_worker_first is empty — no request can reach the Worker');

  const app = createApp({ db: {} as AppEnv['db'] });
  const uncovered: string[] = [];
  for (const route of app.routes) {
    if (!isWorkerOwned(route.path)) continue;
    const label = `${route.method} ${route.path}`;
    if (!patterns.some((p) => matches(p, route.path))) uncovered.push(label);
  }
  assert.deepEqual(
    uncovered,
    [],
    'these routes are not in run_worker_first and will not be served',
  );
});

test('run_worker_first: the API collections are covered bare and by sub-path', () => {
  const patterns = runWorkerFirst();
  // Cloudflare does not document whether `*` crosses `/`, so a collection whose sub-resources
  // are a segment deeper than the base needs both forms present.
  for (const base of ['/admin/announcements', '/admin/polls', '/admin/feedback']) {
    assert.ok(patterns.includes(base), `run_worker_first is missing the bare ${base}`);
    assert.ok(
      patterns.includes(`${base}/*`),
      `run_worker_first is missing ${base}/* (sub-resources such as ${base}/:id)`,
    );
  }
});

test('run_worker_first: the SPA shell stays with the asset layer', () => {
  const patterns = runWorkerFirst();
  // `/` and `/admin` are the two client routes; the asset layer is what serves the shell, and
  // the Worker's own fallback answers them from the ASSETS binding instead.
  assert.equal(patterns.includes('/'), false);
  assert.equal(
    patterns.some((p) => p === '/admin' || p === '/admin/*'),
    false,
  );
});
