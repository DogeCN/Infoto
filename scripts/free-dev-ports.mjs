#!/usr/bin/env node
// Release ports used by the local Worker, Vite server, and media host.

import { execFileSync } from 'node:child_process';

const PORTS = [8787, 8788, 5173, 5174];
/** Maximum attempts to release ports held by restarting processes. */
const ROUNDS = 6;

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  } catch (e) {
    // Include process identifiers reported by taskkill.
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

const win = process.platform === 'win32';

/** Pids listening on `port`: netstat on Windows, lsof elsewhere. */
function listeners(port) {
  if (win) {
    const out = run('netstat', ['-ano', '-p', 'tcp']);
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = /\s+TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (m && Number(m[1]) === port) pids.add(m[2]);
    }
    return [...pids];
  }
  return run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Terminate a process tree and return a parent process ID when available. */
function killTree(pid) {
  const out = win ? run('taskkill', ['/PID', pid, '/T', '/F']) : run('kill', ['-TERM', pid]);
  // Parse parent-child relationships from taskkill output.
  const pairs = [...out.matchAll(/PID (\d+) \(child process of PID (\d+)\)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const children = new Set(pairs.map(([c]) => c));
  const parents = [...new Set(pairs.map(([, p]) => p))].filter((p) => !children.has(p));
  return parents[0] ?? null;
}

function processName(pid) {
  if (!win) return '';
  const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
  return out.split(',')[0]?.replace(/"/g, '').trim() ?? '';
}

/** This process and its ancestors must survive: they are the shell running dev. */
function protectedPids() {
  return new Set([process.pid, process.ppid]);
}

const keep = protectedPids();
const freed = [];

/** Check the OS listener table for a port. */
const isFree = (port) => listeners(port).length === 0;

/** Stop Node.js supervisors above a released listener. */
function stopSupervisor(startPid, depth = 3) {
  let pid = startPid;
  for (let hop = 0; hop < depth && pid; hop++) {
    if (keep.has(Number(pid))) return;
    const parent = killTree(pid);
    if (!parent || keep.has(Number(parent))) return;
    if (processName(parent).toLowerCase() !== 'node.exe') return;
    pid = parent;
  }
}

for (const port of PORTS) {
  if (isFree(port)) continue;
  for (const pid of listeners(port)) {
    if (keep.has(Number(pid))) continue;
    const parent = killTree(pid);
    // Stop the Wrangler supervisor for the Worker port.
    if (port === 8787 && parent && !keep.has(Number(parent))) {
      if (processName(parent).toLowerCase() === 'node.exe') stopSupervisor(parent);
    }
  }
  for (let round = 0; round < ROUNDS && !isFree(port); round++) {
    await new Promise((r) => setTimeout(r, 300));
    for (const pid of listeners(port)) {
      if (keep.has(Number(pid))) continue;
      killTree(pid);
    }
  }
  if (isFree(port)) freed.push(port);
  else console.warn(`port ${port} is still in use; dev may fail to start`);
}

console.log(freed.length > 0 ? `freed ${[...new Set(freed)].join(', ')}` : 'dev ports are free');
