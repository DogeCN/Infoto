// Guards AGENTS.md red line 5: every import points down the layer direction
// (`routes → components → state/core → base → shared`). The rule was convention
// only before this file existed, so nothing failed when a lower layer reached up.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const WEB_SRC = path.join(import.meta.dirname, '..', '..', 'src');
const ROOT_SRC = path.join(WEB_SRC, '..', '..', 'src');

const ALIASES = new Map([
  ['$base', path.join(WEB_SRC, 'base')],
  ['$lib', path.join(WEB_SRC, 'lib')],
  ['$shared', path.join(ROOT_SRC, 'shared')],
]);

/** A file may import from its own rank or below; anything above is an inversion. */
const RANK = { shared: 0, base: 1, core: 2, state: 3, components: 4, routes: 5 } as const;
type Layer = keyof typeof RANK;

/** Root modules are app-level composition, except `settings.ts`: it is pure domain
 *  logic over `core`/`base` that components legitimately consume. */
const ROOT_MODULES: Record<string, Layer> = {
  'App.svelte': 'routes',
  'Root.svelte': 'routes',
  'main.ts': 'routes',
  'routing.ts': 'routes',
  'settings.ts': 'core',
};

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

/** The import specifiers of a source file; a Svelte file contributes only its scripts. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const source = file.endsWith('.svelte')
    ? [...text.matchAll(SCRIPT_BLOCK)].map((match) => match[1]).join('\n')
    : text;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        found.push(node.moduleSpecifier.text);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        found.push(ref.expression.text);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        found.push(node.argument.literal.text);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) found.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

/** A specifier's file path, or null for a package that resolves outside the layers. */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return path.resolve(path.dirname(from), specifier);
  const [head, ...rest] = specifier.split('/');
  const alias = head ? ALIASES.get(head) : undefined;
  return alias ? path.resolve(alias, ...rest) : null;
}

/** The layer a path belongs to; `null` for anything outside the two source trees. */
function layerOf(file: string): Layer | 'worker' | null {
  if (file.startsWith(ROOT_SRC + path.sep)) {
    const [first] = path.relative(ROOT_SRC, file).split(path.sep);
    return first === 'shared' ? 'shared' : 'worker';
  }
  if (!file.startsWith(WEB_SRC + path.sep)) return null;
  const [first, second] = path.relative(WEB_SRC, file).split(path.sep);
  switch (first) {
    case 'base':
      return 'base';
    case 'core':
    case 'transcode':
      return 'core';
    case 'state':
      return 'state';
    case 'lib':
      return second === 'components' ? 'components' : 'base';
    case 'routes':
      return 'routes';
    default:
      return ROOT_MODULES[first] ?? null;
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => path.join(dir, String(entry)))
    .filter((file) => /\.(?:ts|svelte)$/.test(file) && !file.endsWith('.d.ts'));
}

const relative = (file: string): string => path.relative(WEB_SRC, file).replaceAll(path.sep, '/');

function violationsIn(root: string, accept: (from: Layer, to: Layer) => boolean): string[] {
  const violations: string[] = [];
  for (const file of walk(root)) {
    const from = layerOf(file);
    if (!from || from === 'worker') continue;
    for (const specifier of importsOf(file)) {
      const target = resolveSpecifier(file, specifier);
      if (!target) continue;
      const to = layerOf(target);
      if (to === null) continue;
      if (to === 'worker' || !accept(from, to)) {
        violations.push(`${relative(file)} (${from}) → ${specifier} (${to})`);
      }
    }
  }
  return violations;
}

// A violation can only be reported by a walker that read something, and an empty walk reports
// no violations for the same reason a clean tree does. This guard fails when the paths or the
// script extractor stop matching, which is the one way both tests below could rot silently.
test('layering: the guard reads the real source tree', () => {
  const files = walk(WEB_SRC);
  assert.ok(files.length > 80, `walked only ${files.length} files under ${WEB_SRC}`);
  const aliased = files.filter((file) => importsOf(file).some((spec) => spec.startsWith('$')));
  assert.ok(aliased.length > 20, `only ${aliased.length} files import through an alias`);
  const svelte = files.filter((file) => file.endsWith('.svelte'));
  assert.ok(
    svelte.some((file) => importsOf(file).length > 0),
    'the <script> extractor found no imports in any component',
  );
});

test('layering: web imports only its own layer or below', () => {
  assert.deepEqual(
    violationsIn(WEB_SRC, (from, to) => RANK[to] <= RANK[from]),
    [],
  );
});

test('layering: src/shared imports no runtime layer', () => {
  assert.deepEqual(
    violationsIn(path.join(ROOT_SRC, 'shared'), (from, to) => from === to),
    [],
  );
});
