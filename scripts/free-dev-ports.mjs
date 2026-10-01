#!/usr/bin/env node
// Free the ports `npm run dev` binds, so a leftover or half-dead instance cannot make
// wrangler, Vite, or the local media host fail with EADDRINUSE.
//
// Only processes bound to those exact ports are killed — never "every node", which would
// take down the agent shell bridge along with them. Run automatically as `predev`.
//
// A wrangler supervisor respawns its workerd child the moment it dies, so a single kill is
// not enough: the port is re-checked and re-killed for a few rounds until it stays free.
// workerd is matched by name because orphaned copies also squat on 8787 after their
// supervisor is gone, holding a socket nothing will ever release.

import { execFileSync } from 'node:child_process';

const PORTS = [8787, 8788, 5173, 5174];
/** Rounds of kill-then-recheck; a respawning supervisor needs several. */
const ROUNDS = 6;

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  } catch (e) {
    // taskkill still narrates what it killed when it exits non-zero.
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

/**
 * Kill `pid` and its children, and report the parent it belonged to.
 *
 * Killing a listener is not enough for 8787: workerd is a leaf, and the wrangler
 * supervisor above it respawns it within milliseconds. Neither wmic nor Get-CimInstance is
 * usable on this host, but taskkill narrates the tree it walked ("... child process of PID
 * N"), which is the one reliable way left to discover the parent.
 */
function killTree(pid) {
  const out = win ? run('taskkill', ['/PID', pid, '/T', '/F']) : run('kill', ['-TERM', pid]);
  // taskkill narrates every hop: "PID a (child process of PID b) has been terminated".
  // The topmost parent is the last one named that is not itself listed as a child.
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

/**
 * Whether anything still listens on `port`.
 *
 * This reads the OS socket table rather than probing with a bind: Node sets SO_REUSEADDR,
 * so a probe for 127.0.0.1:5173 *succeeds* while Vite holds 0.0.0.0:5173, which would
 * report the port free and skip the one process that most often blocks a restart.
 */
const isFree = (port) => listeners(port).length === 0;

/**
 * Walk up from a killed listener and stop each supervisor we find, so nothing respawns
 * what we just freed. Only node hosts are considered: cmd.exe / powershell.exe parents
 * belong to the user's terminal, not to a stale dev run.
 */
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
    // 8787's listener is workerd with a node supervisor above it; the others are plain
    // node listeners with nothing to stop.
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
