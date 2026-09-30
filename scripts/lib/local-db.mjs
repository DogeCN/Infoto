import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const directory = path.resolve(
  import.meta.dirname,
  '../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
);

/** Open the single local D1 database without creating or selecting a remote database. */
export function openLocalDb(readOnly = false) {
  const files = readdirSync(directory).filter(
    (name) => name.endsWith('.sqlite') && !name.startsWith('metadata.'),
  );
  if (files.length !== 1)
    throw new Error('Expected one local D1 database. Run npm run db:local first.');
  return new DatabaseSync(path.join(directory, files[0]), { readOnly });
}
