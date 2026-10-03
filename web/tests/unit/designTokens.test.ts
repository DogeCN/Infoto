// Guards the one place a design decision is written twice: the token table in
// `.ai/CONTRACT.md` and the `@theme` block it is supposed to describe. A literal copy
// does not follow the token it came from, and a spec nobody diffs against is a spec that
// silently stops being true — which is how this project's predecessor went stale.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { GLITCH_PALETTE } from '../../../src/shared/glitch.ts';
import { FALLBACK_EASE, FALLBACK_MS, type MotionPhase } from '../../src/base/lib/motion.ts';

const read = (...parts: string[]): string =>
  readFileSync(path.join(import.meta.dirname, ...parts), 'utf8');

const contract = read('..', '..', '..', '.ai', 'CONTRACT.md');
const webSrc = path.join(import.meta.dirname, '..', '..', 'src');
const appCss = read('..', '..', 'src', 'app.css');

/** The declarations inside an `@theme { … }` block, comments stripped. */
function themeTokens(css: string): Map<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
  assert.ok(block, 'app.css has no @theme block');
  const out = new Map<string, string>();
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** The `| \`--token\` | \`value\` | … |` rows of the contract's §1.1 table. */
function contractTokens(): Map<string, string> {
  const section = /###\s+1\.1[\s\S]*?\n###\s/.exec(contract)?.[0];
  assert.ok(section, 'CONTRACT.md has no §1.1 token table');
  const out = new Map<string, string>();
  for (const m of section.matchAll(/^\|\s*`(--[\w-]+)`\s*\|\s*`([^`]*)`\s*\|/gm)) {
    const name = m[1]!.slice(2);
    assert.equal(out.has(name), false, `CONTRACT.md lists --${name} twice`);
    out.set(name, m[2]!);
  }
  assert.ok(out.size > 0, 'CONTRACT.md §1.1 parsed no rows');
  return out;
}

/** `280ms` / `0.4s` to milliseconds. */
const toMs = (value: string): number => {
  const m = /^(-?[\d.]+)(s|ms)$/.exec(value);
  assert.ok(m, `not a duration: ${value}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
};

const MISSING = (where: string, names: string[]): string =>
  `${where} is missing: ${names.join(', ')}`;

test('design tokens: the CONTRACT.md table is exactly the app.css @theme block', () => {
  const declared = themeTokens(appCss);
  const documented = contractTokens();

  const undocumented = [...declared.keys()].filter((name) => !documented.has(name));
  const nonexistent = [...documented.keys()].filter((name) => !declared.has(name));
  assert.equal(undocumented.length, 0, MISSING('CONTRACT.md §1.1', undocumented));
  assert.equal(nonexistent.length, 0, MISSING('app.css @theme', nonexistent));

  for (const [name, value] of documented) {
    assert.equal(declared.get(name), value, `--${name} differs between app.css and the contract`);
  }
});

/** Every `.svelte` / `.css` under `web/src`, as repo-relative paths for messages. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => /\.(svelte|css)$/.test(name))
    .map((name) => path.join(dir, name));
}

/**
 * A literal easing curve or non-zero duration inside a `transition` block.
 *
 * `animation` is deliberately out of scope: the glitch's `steps(2)` jitter and the
 * upload sweep's `1.3s linear infinite` are loop timings for a decorative effect, not a
 * state transition, so they belong to no motion phase. `0s` is the standard way to make a
 * property change instantaneously while sharing a transition list, so it stays legal.
 */
function transitionBypasses(text: string): string[] {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  for (const m of stripped.matchAll(/transition\s*:\s*([^;}]+)[;}]/g)) {
    const block = m[1]!;
    if (
      /cubic-bezier/.test(block) ||
      /(?<![\w.-])[1-9][0-9]*(?:\.[0-9]+)?m?s(?![\w-])/.test(block)
    ) {
      out.push(block.replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

test('motion bypass: no transition carries a literal duration or easing curve', () => {
  const bypasses: string[] = [];
  for (const file of sourceFiles(webSrc)) {
    for (const block of transitionBypasses(readFileSync(file, 'utf8'))) {
      bypasses.push(`${path.relative(webSrc, file)}: ${block}`);
    }
  }
  assert.deepEqual(
    bypasses,
    [],
    'these transitions bypass the motion tokens in @theme — declare a phase instead:\n' +
      bypasses.join('\n'),
  );
});

test('glitch palette: the shared error-page colours are the contract tokens', () => {
  // `src/shared/glitch.ts` is compiled into the Worker as well as the SPA, so it cannot read
  // `app.css` at runtime. Its hexes are the fallback side of every `var(--token, fallback)`
  // in GLITCH_CSS, which makes them a copy of the palette that nothing else would catch.
  const tokens = themeTokens(appCss);
  const pairs = [
    ['background', '--color-background'],
    ['foreground', '--color-foreground'],
    ['muted', '--color-muted-foreground'],
    ['primary', '--color-primary'],
  ] as const;
  for (const [key, token] of pairs) {
    assert.equal(
      GLITCH_PALETTE[key],
      tokens.get(token.slice(2)),
      `${token} differs from GLITCH_PALETTE.${key}`,
    );
  }
});

test('motion fallbacks: motion.ts mirrors the app.css motion tokens', () => {
  const declared = themeTokens(appCss);

  for (const phase of Object.keys(FALLBACK_MS) as MotionPhase[]) {
    assert.equal(
      toMs(declared.get(`duration-${phase}`)!),
      FALLBACK_MS[phase],
      `--duration-${phase} differs between app.css and the motion.ts fallback`,
    );
    assert.equal(
      declared.get(`ease-${phase}`),
      FALLBACK_EASE[phase],
      `--ease-${phase} differs between app.css and the motion.ts fallback`,
    );
  }
});
