#!/usr/bin/env node
// Transcode seed media with ffmpeg: stills to WebP, animations to silent WebM, and videos to WebM with Opus. Outputs go to seed-media/transcoded; --force overwrites them.

import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MEDIA } from './seed-media-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'seed-media');
const OUT_DIR = path.join(__dirname, 'seed-media', 'transcoded');
mkdirSync(OUT_DIR, { recursive: true });

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const force = process.argv.includes('--force');
const baseOf = (name) => name.replace(/\.[^.]+$/, '');

function log(...a) {
  console.log('[transcode]', ...a);
}

function runFf(bin, args) {
  try {
    execFileSync(bin, args, { stdio: 'ignore', shell: true });
    return true;
  } catch (e) {
    log(`  ffmpeg failed: ${e.message.split('\n')[0]}`);
    return false;
  }
}

let ok = 0,
  skipped = 0,
  failed = 0;
for (const spec of MEDIA) {
  const inPath = path.join(RAW_DIR, spec.name);
  if (!existsSync(inPath)) {
    log('skip %s (raw missing — run seed:media first)', spec.name);
    failed++;
    continue;
  }
  const ext = spec.type === 0 ? 'webp' : 'webm';
  const outPath = path.join(OUT_DIR, `${baseOf(spec.name)}.${ext}`);
  if (existsSync(outPath) && !force) {
    log('exists %s (skip; --force to redo)', path.basename(outPath));
    skipped++;
    continue;
  }

  let args;
  if (spec.type === 0) {
    args = ['-y', '-i', inPath, '-c:v', 'libwebp', '-quality', '95', outPath];
  } else if (spec.type === 1) {
    args = [
      '-y',
      '-i',
      inPath,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      '-an',
      outPath,
    ];
  } else {
    args = [
      '-y',
      '-i',
      inPath,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      '-b:a',
      '96k',
      outPath,
    ];
  }
  log('transcoding %s → %s', spec.name, path.basename(outPath));
  if (runFf(FFMPEG, args) && existsSync(outPath)) ok++;
  else failed++;
}
log('done: %d transcoded, %d skipped, %d failed → %s', ok, skipped, failed, OUT_DIR);
process.exit(failed > 0 && ok === 0 ? 1 : 0);
