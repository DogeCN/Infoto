#!/usr/bin/env node
// Local image-host simulation: accepts multipart uploads, stores them on disk,
// and serves them back over HTTP. Used by the Worker's /upload proxy in dev.
// Usage: node scripts/local-media-host.mjs [--port 8788] [--dir .local-media]

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const dirIdx = args.indexOf('--dir');
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) : 8788;
const MEDIA_DIR = path.resolve(dirIdx !== -1 ? args[dirIdx + 1] : '.local-media');

mkdirSync(MEDIA_DIR, { recursive: true });

const MIME_BY_EXT = {
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
};

function safeFilename(name) {
  const base = path.basename(name);
  if (!/^[\w.-]+$/.test(base)) return null;
  return base;
}

function parseMultipart(buf, boundary) {
  const segments = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (true) {
    const start = buf.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const end = buf.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (end === -1) break;
    const segment = buf.subarray(start + boundaryBuf.length, end);
    segments.push(segment);
    pos = end;
  }
  const files = [];
  for (const seg of segments) {
    const headerEnd = seg.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = seg.subarray(0, headerEnd).toString('utf8');
    const body = seg.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(header);
    const filenameMatch = /filename="([^"]*)"/.exec(header);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(header);
    if (!nameMatch || !filenameMatch) continue;
    files.push({
      field: nameMatch[1],
      filename: filenameMatch[1],
      contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      data: body,
    });
  }
  return files;
}

// The browser uploads here from the page origin, so the dev stand-in must answer CORS
// exactly like the real facade does — otherwise dev fails for a reason production would not.
// Mirrored from the reference facade (removed from this repo's history in v0.1.2;
// contract in README §Media host facade). Two of these are load-bearing:
//   - max-age: without it the browser re-preflights every upload here, while production
//     caches the preflight for a day.
//   - JSON error envelopes: the client parses a failure body as JSON, so a plain-text reply
//     surfaces as bad_response instead of the real status.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  // Mirrors the facade: the rate-limit hints it relays are unreadable cross-origin
  // without this, since only safelisted response headers survive by default.
  'access-control-expose-headers': 'retry-after, x-ratelimit-limit, x-ratelimit-remaining',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const json = (body, status) => {
    res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  // The facade exposes exactly two routes. Serving stored files is a stand-in extra — the
  // real facade hands back a CDN URL and never serves bytes itself.
  const isKnownRoute = url.pathname === '/upload' || url.pathname === '/health';

  if (req.method === 'OPTIONS') {
    if (!isKnownRoute) return json({ error: 'not_found' }, 404);
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    json({ ok: true }, 200);
    return;
  }

  if (url.pathname === '/upload') {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const ct = req.headers['content-type'] ?? '';
    const bm = /boundary=(.+)/.exec(ct);
    if (!bm) return json({ error: 'bad_content_type' }, 400);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const files = parseMultipart(buf, bm[1]);
      const file = files.find((f) => f.field === 'file');
      if (!file || !file.filename) return json({ error: 'no_file' }, 400);
      const ext = path.extname(file.filename).toLowerCase();
      const id = crypto.randomBytes(16).toString('hex');
      const stored = `${id}${ext}`;
      writeFileSync(path.join(MEDIA_DIR, stored), file.data);
      // Same envelope as the facade: the client reads `data` and nothing else.
      json({ data: `http://127.0.0.1:${PORT}/${stored}` }, 200);
    });
    return;
  }

  const fname = safeFilename(url.pathname.slice(1));
  if (!fname) return json({ error: 'bad_filename' }, 400);
  const fp = path.join(MEDIA_DIR, fname);
  if (!existsSync(fp) || !statSync(fp).isFile()) return json({ error: 'not_found' }, 404);
  const mime = MIME_BY_EXT[path.extname(fname).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    ...CORS,
    'content-type': mime,
    'cache-control': 'public, max-age=31536000, immutable',
  });
  res.end(readFileSync(fp));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[media-host] listening on http://127.0.0.1:${PORT}, serving ${MEDIA_DIR}`);
});
