import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptLanguages,
  activeLocale,
  copy,
  DEFAULT_LOCALE,
  isLocaleCode,
  enUS,
  fmt,
  locales,
  pickLocale,
  plural,
  setActiveLocale,
  type Copy,
  type LocaleCode,
  type PluralMessage,
} from './copy.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.yaml',
  '.yml',
]);
const IGNORED_DIRECTORIES = new Set([
  '.ai',
  '.arena',
  '.cache',
  '.git',
  '.local',
  '.next',
  '.nuxt',
  '.output',
  '.pytest_cache',
  '.svelte-kit',
  '.turbo',
  '.venv',
  '.vite',
  '.wrangler',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'target',
  'test-results',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return IGNORED_DIRECTORIES.has(name) ? [] : sourceFiles(path);
    }
    return SOURCE_EXTENSIONS.has(extname(name)) ? [path] : [];
  });
}

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || isPluralLeaf(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function isPluralLeaf(value: unknown): value is PluralMessage {
  return typeof value === 'object' && value !== null && 'other' in value;
}

function read(table: Copy, leaf: string): unknown {
  return leaf
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], table);
}

test('copy: keeps localized Han text inside the shared copy module', () => {
  const copyPath = resolve(ROOT, 'src/shared/copy.ts');
  for (const path of sourceFiles(ROOT)) {
    if (path === copyPath) continue;
    assert.doesNotMatch(readFileSync(path, 'utf8'), /[\u3400-\u9fff]/u, relative(ROOT, path));
  }
});

test('copy: keeps every locale table aligned with en-US and actually translated', () => {
  const source = paths(enUS).sort();
  const allowed = new Set([
    'errorPage.pageHeading',
    'errorPage.notFoundTitle',
    'errorPage.serverErrorTitle',
    'admin.feedback.idLabel',
  ]);
  for (const [code, table] of Object.entries(locales)) {
    assert.deepEqual(paths(table).sort(), source, `${code} key set`);
    const typed: Copy = table;
    assert.equal(Object.keys(typed).length, Object.keys(enUS).length);
    const rules = new Intl.PluralRules(code);
    const reachable = [...new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)))]
      .filter((k) => k !== 'other')
      .sort();
    for (const leaf of paths(table)) {
      const node = read(table, leaf);
      if (!isPluralLeaf(node)) continue;
      assert.deepEqual(
        Object.keys(node)
          .filter((k) => k !== 'other')
          .sort(),
        reachable,
        `${code} ${leaf}`,
      );
    }
  }
  const zh = locales['zh-CN'];
  for (const leaf of paths(zh)) {
    if (allowed.has(leaf)) continue;
    const zhNode = read(zh, leaf);
    const enNode = read(enUS, leaf);
    if (isPluralLeaf(zhNode)) {
      for (const form of Object.keys(zhNode)) {
        assert.notEqual(
          (zhNode as Record<string, string>)[form],
          (enNode as Record<string, string>)[form],
          `${leaf}.${form}`,
        );
      }
    } else {
      assert.notEqual(zhNode, enNode, leaf);
    }
  }
});

// A key no source reads is dead weight: it lingers unnoticed because the alignment test
// above only compares key sets, and it gets copied into every new language table. Fail on
// any registered leaf whose name appears nowhere outside the copy module.
test('copy: references every registered key from source', () => {
  const copyPath = resolve(ROOT, 'src/shared/copy.ts');
  const source = sourceFiles(ROOT)
    .filter((path) => path !== copyPath)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const unused = paths(enUS).filter((leaf) => {
    const key = leaf.split('.').pop() ?? leaf;
    return !new RegExp(`\\b${key}\\b`).test(source);
  });
  assert.deepEqual(unused, []);
});

test('copy: formats placeholders and plural categories', () => {
  assert.equal(fmt('a {x} c', { x: 'B' }), 'a B c');
  assert.equal(fmt('{x} {y}', { x: 1 }), '1 {y}');
  assert.equal(fmt('{x}'), '{x}');
  const forms: PluralMessage = { one: '{n} file', other: '{n} files' };
  assert.equal(plural(1, forms, 'en-US'), '{n} file');
  assert.equal(plural(1.4, forms, 'en-US'), '{n} file');
  assert.equal(plural(2, forms, 'en-US'), '{n} files');
  assert.equal(plural(1, forms, 'zh-CN'), '{n} files');
  assert.equal(plural(1, forms, 'ru-RU'), '{n} file');
  assert.equal(plural(3, forms, 'ru-RU'), '{n} files');
  assert.equal(plural(5, { other: '{n} items' }, 'en-US'), '{n} items');
});

test('copy: negotiates an exact shipped tag and follows the active locale', () => {
  assert.deepEqual(acceptLanguages('zh-CN;q=0.9, en-US, fr-FR;q=0'), ['en-US', 'zh-CN']);
  assert.deepEqual(acceptLanguages('en-US;q=0.8, zh-CN;q=1.1, fr-FR;q=0'), ['en-US']);
  assert.deepEqual(acceptLanguages('en-US;q=0.9, zh-CN;q=0.1234'), ['en-US']);
  assert.deepEqual(acceptLanguages(null), []);
  assert.deepEqual(acceptLanguages(''), []);
  assert.equal(pickLocale(['fr-FR', 'zh-CN', 'en-US']), 'zh-CN');
  assert.equal(pickLocale(['zh']), DEFAULT_LOCALE);
  assert.equal(pickLocale(['zh-Hans-CN']), DEFAULT_LOCALE);
  assert.equal(pickLocale(['fr-FR', 'de-DE']), DEFAULT_LOCALE);
  assert.equal(pickLocale([]), DEFAULT_LOCALE);
  assert.equal(pickLocale(undefined), DEFAULT_LOCALE);

  setActiveLocale('en-US');
  assert.equal(activeLocale(), 'en-US');
  assert.equal(copy.settings.language, 'Language');
  assert.equal(plural(1, { one: '{n} vote', other: '{n} votes' }), '{n} vote');
  setActiveLocale('zh-CN');
  assert.equal(copy.settings.language, locales['zh-CN'].settings.language);
  assert.equal(copy.sync, locales['zh-CN'].sync);
  assert.equal(plural(2, locales['zh-CN'].vote.count), locales['zh-CN'].vote.count.other);
  setActiveLocale('fr-FR' as LocaleCode);
  assert.equal(activeLocale(), 'zh-CN');
  setActiveLocale('en-US');
});

// Reject keys that are not registered as own properties of the locale table.
test('copy: accepts only registered locale tags', () => {
  for (const code of Object.keys(locales)) {
    assert.equal(isLocaleCode(code), true);
  }
  for (const value of ['fr-FR', 'zh', 'zh-Hans-CN', 'EN-US', 'en-US ', '', 'en_US']) {
    assert.equal(isLocaleCode(value), false);
  }
  for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(isLocaleCode(value), false);
  }
  for (const value of [null, undefined, 0, 1, true, {}, [], ['en-US'], Symbol('en-US')]) {
    assert.equal(isLocaleCode(value), false);
  }
});

// Preserve the type predicate at its call site.
test('copy: narrows an unknown value to LocaleCode', () => {
  const raw: unknown = 'zh-CN';
  if (!isLocaleCode(raw)) throw new Error('expected a registered tag');
  const narrowed: LocaleCode = raw;
  assert.equal(narrowed, 'zh-CN');
});
