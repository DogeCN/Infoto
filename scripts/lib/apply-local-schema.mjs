// Shared: bring the local D1 up to schema.sql — quietly, and only when needed.
//
// Why this exists instead of a bare `wrangler d1 execute`:
//  1. Noise. When stdout is not a TTY (always true under `npm run dev`'s pipes)
//     wrangler dumps one JSON object per statement, which buries the worker's
//     own startup log. We drop stdout and keep stderr for real failures.
//  2. Cost. schema.sql is all CREATE TABLE IF NOT EXISTS, so re-applying never
//     drops data — but it still boots miniflare on every `npm run dev`. Skip it
//     once the tables are there; `deploy.yml` gates its remote apply on the very
//     same check, so local and CI agree on what "initialized" means.
//
// Detection is only an optimization: applying is idempotent and silent, so a
// wrong guess costs a few ms and never data.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const root = path.resolve(import.meta.dirname, '..', '..');
const WRANGLER = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const SQLITE_DIR = path.join(root, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const PROBE_TABLE = 'users';

/**
 * Local D1 sqlite files, newest first. Wrangler names the file after a hash of
 * the database name + binding, so renaming those in wrangler.toml leaves a
 * stale sibling behind — hence "exactly one file" as the only unambiguous case.
 */
function localDbFiles() {
  if (!existsSync(SQLITE_DIR)) return [];
  return readdirSync(SQLITE_DIR)
    .filter((f) => f.endsWith('.sqlite') && !f.startsWith('metadata.'))
    .map((f) => path.join(SQLITE_DIR, f))
    .filter((f) => statSync(f).size > 0)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/**
 * True when the local D1 already carries the schema.
 * Deliberately conservative — every "I can't tell" path returns false, because
 * the only consequence is a redundant (harmless) apply.
 */
export function hasLocalSchema() {
  const files = localDbFiles();
  if (files.length !== 1) return false; // no DB yet, or an ambiguous rename
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return false; // runtime without node:sqlite
  }
  let db;
  try {
    db = new DatabaseSync(files[0], { readOnly: true });
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(PROBE_TABLE) !== undefined
    );
  } catch {
    return false; // locked or unreadable — re-applying is still safe
  } finally {
    db?.close();
  }
}

/**
 * Run `wrangler d1 execute infoto-dev --local --file=schema.sql`.
 * Idempotent: schema.sql is all CREATE TABLE IF NOT EXISTS, so it never drops data.
 * @returns {{ ok: true } | { ok: false, detail: string }}
 */
export function applyLocalSchema() {
  const r = spawnSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'infoto-dev', '--local', '--file=schema.sql'],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
  );
  if (r.status === 0) return { ok: true };
  const detail =
    (r.stderr ?? '').trim() || r.error?.message || `wrangler exited with code ${r.status}`;
  return { ok: false, detail };
}

/**
 * Apply schema.sql only if the local D1 lacks it.
 * @param {{ force?: boolean, quiet?: boolean }} [opts]
 * @returns {number} process exit code
 */
export function ensureLocalSchema(opts = {}) {
  const { force = false, quiet = false } = opts;
  if (!force && hasLocalSchema()) {
    if (!quiet) console.log('local D1 already has the schema — skipping');
    return 0;
  }
  const r = applyLocalSchema();
  if (!r.ok) {
    console.error('failed to apply schema.sql to the local D1:\n' + r.detail);
    console.error('hint: `npm run db:reset` rebuilds the local D1 from scratch');
    return 1;
  }
  if (!quiet) console.log('local D1 schema applied');
  return 0;
}
