#!/usr/bin/env node
// Download the seed-media set once into scripts/seed-media/ so the seeding
// script can read local files and the flaky download step never blocks a reseed.
// Run: node scripts/download-seed-media.mjs

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA } from './seed-media-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'seed-media');
mkdirSync(OUT_DIR, { recursive: true });

// 1×1 transparent gif fallback if the giphy download fails.
const FALLBACK_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function log(...a) {
  console.log('[download]', ...a);
}

async function fetchFirst(spec) {
  for (const url of spec.urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        log(`  ${url} → ${res.status}, skip`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) {
        log(`  ${url} → too small, skip`);
        continue;
      }
      return buf;
    } catch (e) {
      log(`  ${url} → ${e.message}`);
    }
  }
  return null;
}

const force = process.argv.includes('--force');
let ok = 0,
  skipped = 0,
  failed = 0;
for (const spec of MEDIA) {
  const fp = path.join(OUT_DIR, spec.name);
  if (existsSync(fp) && !force) {
    log('exists %s (skip; --force to redownload)', spec.name);
    skipped++;
    continue;
  }
  log('downloading %s ...', spec.name);
  let buf = await fetchFirst(spec);
  if (!buf) {
    if (spec.type === 1) {
      buf = FALLBACK_GIF;
      log('  gif sources failed — writing 1×1 fallback');
    } else {
      log(`  FAILED ${spec.name} (all sources failed)`);
      failed++;
      continue;
    }
  }
  writeFileSync(fp, buf);
  log(`  saved ${spec.name} (${buf.length} bytes)`);
  ok++;
}
log(`done: ${ok} saved, ${skipped} skipped, ${failed} failed → ${OUT_DIR}`);
process.exit(failed > 0 && ok === 0 ? 1 : 0);
