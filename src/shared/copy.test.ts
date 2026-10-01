import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

describe('copy', () => {
  it('keeps localized Han text inside the shared copy module', () => {
    const copyPath = resolve(ROOT, 'src/shared/copy.ts');
    for (const path of sourceFiles(ROOT)) {
      if (path === copyPath) continue;
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('keeps every locale table aligned with en-US and actually translated', () => {
    const source = paths(enUS).sort();
    const allowed = new Set([
      'errorPage.pageHeading',
      'errorPage.notFoundTitle',
      'errorPage.serverErrorTitle',
      'admin.feedback.idLabel',
    ]);
    for (const [code, table] of Object.entries(locales)) {
      expect(paths(table).sort(), `${code} key set`).toEqual(source);
      const typed: Copy = table;
      expect(Object.keys(typed).length).toBe(Object.keys(enUS).length);
      const rules = new Intl.PluralRules(code);
      const reachable = [...new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)))]
        .filter((k) => k !== 'other')
        .sort();
      for (const leaf of paths(table)) {
        const node = read(table, leaf);
        if (!isPluralLeaf(node)) continue;
        expect(
          Object.keys(node)
            .filter((k) => k !== 'other')
            .sort(),
          `${code} ${leaf}`,
        ).toEqual(reachable);
      }
    }
    const zh = locales['zh-CN'];
    for (const leaf of paths(zh)) {
      if (allowed.has(leaf)) continue;
      const zhNode = read(zh, leaf);
      const enNode = read(enUS, leaf);
      if (isPluralLeaf(zhNode)) {
        for (const form of Object.keys(zhNode)) {
          expect((zhNode as Record<string, string>)[form], `${leaf}.${form}`).not.toBe(
            (enNode as Record<string, string>)[form],
          );
        }
      } else {
        expect(zhNode, leaf).not.toBe(enNode);
      }
    }
  });

  it('formats placeholders and plural categories', () => {
    expect(fmt('a {x} c', { x: 'B' })).toBe('a B c');
    expect(fmt('{x} {y}', { x: 1 })).toBe('1 {y}');
    expect(fmt('{x}')).toBe('{x}');
    const forms: PluralMessage = { one: '{n} file', other: '{n} files' };
    expect(plural(1, forms, 'en-US')).toBe('{n} file');
    expect(plural(1.4, forms, 'en-US')).toBe('{n} file');
    expect(plural(2, forms, 'en-US')).toBe('{n} files');
    expect(plural(1, forms, 'zh-CN')).toBe('{n} files');
    expect(plural(1, forms, 'ru-RU')).toBe('{n} file');
    expect(plural(3, forms, 'ru-RU')).toBe('{n} files');
    expect(plural(5, { other: '{n} items' }, 'en-US')).toBe('{n} items');
  });

  it('negotiates an exact shipped tag and follows the active locale', () => {
    expect(acceptLanguages('zh-CN;q=0.9, en-US, fr-FR;q=0')).toEqual(['en-US', 'zh-CN']);
    expect(acceptLanguages('en-US;q=0.8, zh-CN;q=1.1, fr-FR;q=0')).toEqual(['en-US']);
    expect(acceptLanguages('en-US;q=0.9, zh-CN;q=0.1234')).toEqual(['en-US']);
    expect(acceptLanguages(null)).toEqual([]);
    expect(acceptLanguages('')).toEqual([]);
    expect(pickLocale(['fr-FR', 'zh-CN', 'en-US'])).toBe('zh-CN');
    expect(pickLocale(['zh'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale(['zh-Hans-CN'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale(['fr-FR', 'de-DE'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale([])).toBe(DEFAULT_LOCALE);
    expect(pickLocale(undefined)).toBe(DEFAULT_LOCALE);

    setActiveLocale('en-US');
    expect(activeLocale()).toBe('en-US');
    expect(copy.settings.language).toBe('Language');
    expect(plural(1, { one: '{n} vote', other: '{n} votes' })).toBe('{n} vote');
    setActiveLocale('zh-CN');
    expect(copy.settings.language).toBe(locales['zh-CN'].settings.language);
    expect(copy.sync).toBe(locales['zh-CN'].sync);
    expect(plural(2, locales['zh-CN'].vote.count)).toBe(locales['zh-CN'].vote.count.other);
    setActiveLocale('fr-FR' as LocaleCode);
    expect(activeLocale()).toBe('zh-CN');
    setActiveLocale('en-US');
  });

  // Reject keys that are not registered as own properties of the locale table.
  it('accepts only registered locale tags', () => {
    for (const code of Object.keys(locales)) {
      expect(isLocaleCode(code)).toBe(true);
    }
    for (const value of ['fr-FR', 'zh', 'zh-Hans-CN', 'EN-US', 'en-US ', '', 'en_US']) {
      expect(isLocaleCode(value)).toBe(false);
    }
    for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(isLocaleCode(value)).toBe(false);
    }
    for (const value of [null, undefined, 0, 1, true, {}, [], ['en-US'], Symbol('en-US')]) {
      expect(isLocaleCode(value)).toBe(false);
    }
  });

  // Preserve the type predicate at its call site.
  it('narrows an unknown value to LocaleCode', () => {
    const raw: unknown = 'zh-CN';
    if (!isLocaleCode(raw)) throw new Error('expected a registered tag');
    const narrowed: LocaleCode = raw;
    expect(narrowed).toBe('zh-CN');
  });
});
