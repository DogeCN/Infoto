#!/usr/bin/env node
// Apply the local schema when tables are missing. Accepts --force and --quiet.

import { ensureLocalSchema } from './lib/apply-local-schema.mjs';

const argv = process.argv.slice(2);
process.exit(
  ensureLocalSchema({
    force: argv.includes('--force'),
    quiet: argv.includes('--quiet'),
  }),
);
