// The one place local dev configuration is read from.
//
// `.dev.vars` is wrangler's own dev-vars file: the Worker already loads it, so this
// module makes the node scripts read the same file rather than carry their own copy of
// a value the Worker also needs. One file, one value — a port that disagrees with the
// Worker is a confusing failure, not a harmless default.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** @type {string} Repo root, resolved from this file's location (`scripts/`). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** @type {string} The tracked template a fresh clone copies to `.dev.vars`. */
export const DEV_VARS_EXAMPLE = path.join(REPO_ROOT, '.dev.vars.example');

/** @type {string} The gitignored dev-vars file itself. */
export const DEV_VARS = path.join(REPO_ROOT, '.dev.vars');

/**
 * Every `KEY=value` pair in a dev-vars file. Values may be quoted.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseVars(text) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    vars.set(name, value.replace(/^["']|["']$/g, ''));
  }
  return vars;
}

/**
 * A value from `.dev.vars`, or from the tracked `.dev.vars.example` when the local file
 * is absent. The example fallback lets a fresh clone run the dev scripts before it has
 * copied anything — the values there are the published Cloudflare test keys and a
 * loopback origin, neither of which is a credential.
 * @param {string} name
 * @returns {string | undefined}
 */
export function devVar(name) {
  for (const file of [DEV_VARS, DEV_VARS_EXAMPLE]) {
    try {
      const value = parseVars(readFileSync(file, 'utf8')).get(name);
      if (value !== undefined && value !== '') return value;
    } catch {
      // Not present yet — try the next source.
    }
  }
  return undefined;
}

/**
 * The port `MEDIA_HOST_URL` names, so a script binds exactly the origin the Worker will
 * publish in /sync. An https URL without an explicit port means 443; anything else
 * without one means 80. `URL` has already validated the port is in range, and a
 * malformed value is a loud failure rather than a silent fallback to a port nobody
 * chose — that mismatch is how a stand-in ends up somewhere /sync never points at.
 * @param {number} [fallback]
 * @returns {number}
 */
export function mediaHostPort(fallback = 8788) {
  const raw = devVar('MEDIA_HOST_URL');
  if (!raw) return fallback;
  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MEDIA_HOST_URL="${raw}" in .dev.vars is not a URL`);
  }
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}
