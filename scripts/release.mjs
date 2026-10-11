#!/usr/bin/env node
// Cut a release: bump both manifests and the lockfile, commit, tag, push.
//
// The tag is what ships — the deploy workflow triggers on `v*`, and the SPA's version label
// reads the latest tag at build time — so this script's job is to keep `package.json` and the
// lockfile honest alongside it, in one command. Four version fields move together: the two
// manifests and the lockfile's root + workspace entries. They are written here in JavaScript
// rather than through `npm version`, which would need a shell on Windows (`npm.cmd` cannot be
// spawned directly) and would put the tag summary in reach of shell quoting. Each file is
// re-serialised with the exact shape prettier demands, so `npm run lint` stays green.
//
// Usage: npm run release -- <patch|minor|major|x.y.z> ["what changed"]
//        npm run release -- minor --dry-run

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Releases are cut from the branch whose tag push deploys production. */
const BRANCH = 'main';
/** The SPA workspace: its directory is also its key inside the lockfile. */
const WORKSPACE = 'web';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const [bump, ...summaryWords] = argv.filter((arg) => !arg.startsWith('--'));
const summary = summaryWords.join(' ').trim();

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}
const git = (...args) => run('git', args);

function nextVersion(current, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [major, minor, patch] = current.split('.').map(Number);
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Re-serialise one JSON file after mutating it, keeping the formatting prettier requires. */
function edit(file, mutate) {
  const abs = path.join(root, file);
  const data = JSON.parse(readFileSync(abs, 'utf8'));
  mutate(data);
  writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
}

function setVersion(version) {
  edit('package.json', (pkg) => {
    pkg.version = version;
  });
  edit(path.join(WORKSPACE, 'package.json'), (pkg) => {
    pkg.version = version;
  });
  edit('package-lock.json', (lock) => {
    lock.version = version;
    lock.packages[''].version = version;
    const workspace = lock.packages[WORKSPACE];
    if (!workspace) fail(`package-lock.json has no "${WORKSPACE}" entry to version`);
    workspace.version = version;
  });
}

if (!bump) fail('usage: npm run release -- <patch|minor|major|x.y.z> ["what changed"]');
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) fail(`not a release argument: ${bump}`);

let branch;
try {
  branch = git('symbolic-ref', '--short', '-q', 'HEAD');
} catch {
  fail('detached HEAD — check out a branch first');
}
if (branch !== BRANCH) fail(`on ${branch}; releases are cut from ${BRANCH}`);

const dirty = git('status', '--porcelain');
if (dirty) fail(`working tree is not clean — commit or stash first:\n${dirty}`);

const current = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const version = nextVersion(current, bump);
const tag = `v${version}`;
if (git('tag', '-l', tag)) fail(`${tag} already exists`);

console.log(`release: ${current} -> ${version} (${tag})${summary ? ` — ${summary}` : ''}`);
if (dryRun) {
  console.log('release: dry run, nothing written');
  process.exit(0);
}

setVersion(version);
git('add', 'package.json', path.join(WORKSPACE, 'package.json'), 'package-lock.json');
git('commit', '-m', `Release ${tag}`);
git('tag', '-a', tag, '-m', summary ? `${tag}: ${summary}` : tag);

try {
  git('push', '--follow-tags');
} catch {
  fail(`${tag} is committed and tagged locally; push it with \`git push --follow-tags\``);
}

console.log(`release: pushed ${tag}; the deploy workflow builds and deploys it from the tag`);
