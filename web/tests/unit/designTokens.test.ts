// Guards the one place a design decision is written twice: the token table in
// `.agents/CONTRACT.md` and the `@theme` block it is supposed to describe. A literal copy
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

const contract = read('..', '..', '..', '.agents', 'CONTRACT.md');
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

// `@tailwindcss/typography` styles Markdown through `--tw-prose-*` custom properties and ships a
// light-surface palette (body `oklch(37.3% …)`, near-black). Without this binding every prose
// paragraph renders as a dark slab on the blue-black background. The layer matters as much as the
// value: `.prose-invert` declares the same variables from `@layer utilities`, and a later layer
// wins over an earlier one regardless of source order, so a binding in `@layer base` is dropped.
test('prose palette: Markdown colours resolve to the site tokens, from the utilities layer', () => {
  const binding = /@layer utilities\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1];
  assert.ok(binding, 'app.css has no @layer utilities block for the prose palette');
  assert.ok(
    /\.prose\s*\{/.test(binding),
    'the prose palette must be declared in @layer utilities, or .prose-invert overrides it',
  );

  const bound = new Map<string, string>();
  for (const m of binding
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/--tw-prose-([\w-]+)\s*:\s*([^;]+);/g)) {
    bound.set(m[1]!, m[2]!.trim());
  }
  assert.ok(bound.size > 0, 'no --tw-prose-* variables parsed');

  // Every variable must name a site token, so the palette follows the token it came from
  // instead of drifting into a second set of literals.
  const declared = themeTokens(appCss);
  for (const [name, value] of bound) {
    const token = /^var\(--color-([\w-]+)\)$/.exec(value)?.[1];
    assert.ok(token, `--tw-prose-${name} is not a site token: ${value}`);
    assert.ok(
      declared.has(`color-${token}`),
      `--tw-prose-${name} reads --color-${token}, which app.css does not declare`,
    );
  }

  // Body text is the one readers look at most; it must not fall back to the plugin's own value.
  assert.equal(bound.get('body'), 'var(--color-foreground)');
  assert.equal(bound.get('headings'), 'var(--color-foreground)');
  assert.equal(bound.get('links'), 'var(--color-primary)');
});

// GitHub runs every heading at one weight and pairs h1/h2 with a hairline; the typography plugin
// ships 800/700/600/600/400/400, which leaves h5 and h6 set exactly like body text — the faintest
// tier in a document. These rules pin GitHub's structure. `:where()` keeps them at zero specificity
// so they cannot outrank an interactive rule in `MarkdownView`'s own stylesheet.
test('prose structure: headings, quote and separators follow GitHub markdown', () => {
  const block = /@layer utilities\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1];
  assert.ok(block, 'app.css has no @layer utilities block for the prose palette');
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '');

  // One weight for every level, so no heading reads lighter than the one above it.
  assert.match(
    css,
    /\.prose\s*:where\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*font-weight:\s*600/,
    'every heading must sit at one weight, or h5/h6 fall back to body text weight',
  );

  // GitHub's ladder: 2 / 1.5 / 1.25 / 1 / .875 em, with h5 and h6 sharing a size.
  for (const [level, size] of [
    ['h1', '2em'],
    ['h2', '1.5em'],
    ['h3', '1.25em'],
    ['h4', '1em'],
  ]) {
    assert.match(
      css,
      new RegExp(
        `\\.prose\\s*:where\\(${level}\\)\\s*\\{[^}]*font-size:\\s*${size.replace(/\./g, '\\.')}`,
      ),
      `${level} must be ${size}`,
    );
  }
  assert.match(css, /\.prose\s*:where\(h5, h6\)\s*\{[^}]*font-size:\s*0\.875em/);

  // The sectioning hairline under the two top levels.
  assert.match(css, /\.prose\s*:where\(h1, h2\)\s*\{[^}]*border-bottom:\s*1px solid/);

  // The quote is an indent plus a 0.25em bar, and it is not bold or italic.
  assert.match(css, /\.prose\s*:where\(blockquote\)\s*\{[^}]*border-left-width:\s*0\.25em/);
  assert.match(
    css,
    /\.prose\s*:where\(blockquote\)\s*\{[^}]*font-weight:\s*400[^}]*font-style:\s*normal/,
    'a quote must not be bold or italic',
  );

  // Inline code is a chip, not bare text.
  assert.match(
    css,
    /\.prose\s*:where\(code\):not\(:where\(pre code\)\)\s*\{[^}]*padding:\s*0\.2em 0\.4em[^}]*border-radius:\s*6px/,
  );

  // Structure must not be written as a bare literal colour.
  for (const literal of css.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
    assert.fail(`prose structure hardcodes ${literal}; use a site token`);
  }
});

// The typography plugin gives every `img` inside `.prose` a `1.71429em` top and bottom margin —
// its paragraph rhythm, equal to `prose-sm`'s line-height, so an image between two paragraphs
// reads as one blank line. A block that is *only* an image has no neighbour to absorb it and the
// margin shows as raw whitespace, so the margin is collapsed where the image opens or closes the
// block. Pinned here because the value itself looks like an arbitrary plugin internal.
test('prose rhythm: a block-opening or block-closing image carries no margin', () => {
  const block = /@layer utilities\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1];
  assert.ok(block, 'app.css has no @layer utilities block for the prose palette');
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(
    css,
    /\.prose\s*:where\(p\):first-child\s*:where\(img\)[^{]*\{[^}]*margin-top:\s*0/,
    'an image opening the block must not carry the paragraph rhythm margin',
  );
  assert.match(
    css,
    /\.prose\s*:where\(p\):last-child\s*:where\(img\)[^{]*\{[^}]*margin-bottom:\s*0/,
    'an image closing the block must not carry the paragraph rhythm margin',
  );
  // An image between paragraphs keeps the plugin's rhythm — a blanket `img { margin: 0 }`
  // would flatten multi-image announcements too.
  assert.doesNotMatch(css, /\.prose\s*:where\(img\)\s*\{[^}]*margin/);
});

// The plugin injects decorative text through `::before` / `::after` in two places: typographic
// quotes on a quote's first and last paragraph, and a literal backtick around every inline
// `<code>`. Both are *text*, so a reader copying the line carries them along, and neither is
// needed — the quote bar marks the quote and the chip marks the code. GitHub emits no glyphs.
test('prose glyphs: no decorative text is injected into a rendered line', () => {
  const block = /@layer utilities\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1];
  assert.ok(block, 'app.css has no @layer utilities block for the prose palette');
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(
    css,
    /\.prose\s*:where\(blockquote p:first-of-type\)::before[^{]*,\s*\n?\s*\.prose\s*:where\(blockquote p:last-of-type\)::after\s*\{[^}]*content:\s*none/,
    'a quote must not hang open-quote / close-quote glyphs on its first and last paragraph',
  );
  assert.match(
    css,
    /\.prose\s*:where\(code\)::before[^{]*,\s*\n?\s*\.prose\s*:where\(code\)::after\s*\{[^}]*content:\s*none/,
    'inline code must not be wrapped in literal backtick glyphs',
  );
  // `:where()` keeps each override at the plugin's own zero specificity, so it wins on order
  // inside the layer instead of outranking a rule elsewhere.
  assert.match(css, /:where\(blockquote p:first-of-type\)::before/);
  assert.match(css, /:where\(code\)::before/);
  // Nothing in this layer may inject text of its own.
  assert.doesNotMatch(css, /content:\s*["']/, 'the prose overrides must not add text content');
});

// The plugin's `prose-sm` variant sets `.857143em` on a table — 12px against the 14px body — so
// every cell read smaller than the prose around it. GitHub sets no table font-size at all: a table
// is body text in a grid. The rest of the rule set is GitHub's too: a collapsed 1px grid, a heavier
// header row, zebra rows, and a wide table scrolling instead of squeezing its columns.
test('prose table: body-size text, a collapsed grid and horizontal scroll', () => {
  const block = /@layer utilities\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1];
  assert.ok(block, 'app.css has no @layer utilities block for the prose palette');
  const css = block.replace(/\/\*[\s\S]*?\*\//g, '');

  const table = /\.prose\s*:where\(table\)\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(table, 'app.css has no .prose :where(table) rule');
  assert.match(table, /font-size:\s*100%/, 'a table must not shrink away from the body size');
  assert.match(table, /border-collapse:\s*collapse/);
  assert.match(table, /border-spacing:\s*0/);
  assert.match(table, /display:\s*block/, 'a wide table scrolls as a block, it does not wrap');
  assert.match(table, /overflow:\s*auto/);
  assert.match(table, /max-width:\s*100%/);
  assert.match(table, /font-variant-numeric:\s*tabular-nums/);

  assert.match(css, /\.prose\s*:where\(table th, table td\)\s*\{[^}]*padding:\s*6px 13px/);
  assert.match(
    css,
    /\.prose\s*:where\(table th, table td\)\s*\{[^}]*border:\s*1px solid var\(--color-border\)/,
  );
  assert.match(css, /\.prose\s*:where\(table th\)\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /\.prose\s*:where\(table tr:nth-child\(2n\)\)\s*\{[^}]*background-color:/);

  // No literal colour in any table rule — the zebra tint is derived from a token.
  for (const literal of table.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
    assert.fail(`the table rule hardcodes ${literal}; use a site token`);
  }
});
