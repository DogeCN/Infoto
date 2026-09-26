#!/usr/bin/env node
// Apply schema.sql to the local D1 — skipped when the tables are already there.
// Usage: node scripts/db-local.mjs [--force] [--quiet]
//
// Wired to `npm run db:local`, which `npm run dev` and the Playwright
// webServer both use to bootstrap before the Worker starts.

import { ensureLocalSchema } from './lib/apply-local-schema.mjs';

const argv = process.argv.slice(2);
process.exit(
  ensureLocalSchema({
    force: argv.includes('--force'),
    quiet: argv.includes('--quiet'),
  }),
);
