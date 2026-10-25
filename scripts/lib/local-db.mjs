// The one owner of "which local D1 database is active".
//
// `node:sqlite` is loaded through `createRequire` because Vite's SSR transform strips the
// `node:` prefix from a static import, and the load stays lazy so a runtime without the module
// is a fallible call rather than an unimportable file.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const DIRECTORY = path.resolve(
  import.meta.dirname,
  '../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
);

/** The `DatabaseSync` class from `node:sqlite`. */
export function databaseSync() {
  return require('node:sqlite').DatabaseSync;
}

/**
 * Local D1 database files, newest first.
 *
 * The `metadata.*` sidecar and a zero-byte file (a database wrangler is still creating) are not
 * candidates: either one would make a rename or a half-written state look like a second
 * database. Newest-first is what makes "the active one" resolvable once more than one survives.
 */
export function localDbFiles() {
  if (!existsSync(DIRECTORY)) return [];
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.sqlite') && !name.startsWith('metadata.'))
    .map((name) => path.join(DIRECTORY, name))
    .filter((file) => statSync(file).size > 0)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** Open the single local D1 database without creating or selecting a remote database. */
export function openLocalDb(readOnly = false) {
  const files = localDbFiles();
  if (files.length !== 1)
    throw new Error('Expected one local D1 database. Run npm run db:local first.');
  const DatabaseSync = databaseSync();
  return new DatabaseSync(files[0], { readOnly });
}
