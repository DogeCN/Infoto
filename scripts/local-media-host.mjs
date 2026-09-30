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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET') {
    const fname = safeFilename(url.pathname.slice(1));
    if (!fname) {
      res.writeHead(400).end('bad filename');
      return;
    }
    const fp = path.join(MEDIA_DIR, fname);
    if (!existsSync(fp) || !statSync(fp).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const ext = path.extname(fname).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': mime,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(readFileSync(fp));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/upload') {
    const ct = req.headers['content-type'] ?? '';
    const bm = /boundary=(.+)/.exec(ct);
    if (!bm) {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end('{"error":"bad_content_type"}');
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const files = parseMultipart(buf, bm[1]);
      const file = files.find((f) => f.field === 'file');
      if (!file || !file.filename) {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"no_file"}');
        return;
      }
      const ext = path.extname(file.filename).toLowerCase();
      const id = crypto.randomBytes(16).toString('hex');
      const stored = `${id}${ext}`;
      writeFileSync(path.join(MEDIA_DIR, stored), file.data);
      const publicUrl = `http://127.0.0.1:${PORT}/${stored}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: publicUrl, data: publicUrl }));
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[media-host] listening on http://127.0.0.1:${PORT}, serving ${MEDIA_DIR}`);
});
