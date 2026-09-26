// Wipes local D1 (wrangler dev's local sqlite state) and rebuilds the schema.
// Usage: node scripts/reset-local-db.mjs
// Only touches .wrangler/state/v3/d1 and cache — the hosted D1 is unaffected.

import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { applyLocalSchema } from './lib/apply-local-schema.mjs';

const root = path.resolve(import.meta.dirname, '..');
const targets = [
  path.join(root, '.wrangler/state/v3/d1'),
  path.join(root, '.wrangler/state/v3/cache'),
];

for (const t of targets) {
  if (existsSync(t)) {
    await rm(t, { recursive: true, force: true });
    console.log('removed', path.relative(root, t));
  }
}

const r = applyLocalSchema();
if (!r.ok) {
  console.error('failed to apply schema.sql after reset:\n' + r.detail);
  process.exit(1);
}
console.log('local D1 reset + schema applied');
