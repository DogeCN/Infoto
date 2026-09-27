import { describe, expect, it } from 'vitest';
import {
  acceptLanguages,
  activeLocale,
  copy,
  DEFAULT_LOCALE,
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

// ---- shape ----------------------------------------------------------------

/** Every leaf path in a copy table, dotted (`admin.announcement.empty`). Plural
 *  messages are leaves too — their forms are checked separately. */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || isPluralLeaf(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** `{ one, other }`-shaped leaves are plural messages, not plain strings. */
function isPluralLeaf(value: unknown): value is PluralMessage {
  return typeof value === 'object' && value !== null && 'other' in value;
}

describe('locale tables', () => {
  it('every locale mirrors en-US exactly — no missing and no extra keys', () => {
    const source = paths(enUS).sort();
    for (const [code, table] of Object.entries(locales)) {
      expect(paths(table).sort(), `${code} key set`).toEqual(source);
    }
  });

  it('plural forms only use categories the locale can actually produce', () => {
    // A form for a category the locale never selects is dead weight, and a missing
    // one that it does select silently falls back to `other`.
    for (const [code, table] of Object.entries(locales)) {
      const rules = new Intl.PluralRules(code);
      const reachable = new Set(
        Array.from({ length: 200 }, (_, n) => rules.select(n)).filter((k) => k !== 'other'),
      );
      for (const leaf of paths(table)) {
        const node = leaf
          .split('.')
          .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], table);
        if (!isPluralLeaf(node)) continue;
        expect(
          Object.keys(node).filter((k) => k !== 'other'),
          `${code} ${leaf}`,
        ).toEqual([...reachable].sort());
      }
    }
  });

  it('leaves the deliberately untranslated strings alone', () => {
    // The 404/500 heading is a fixed HTTP status label, not prose, and `ID` is a
    // column key that reads the same everywhere. Any *other* English string left in
    // the Chinese table is an untranslated leftover — the compiler can require a key
    // to exist, but only this can require it to be translated.
    const allowed = new Set([
      'errorPage.pageHeading',
      'errorPage.notFoundTitle',
      'errorPage.serverErrorTitle',
      'admin.feedback.idLabel',
    ]);
    const zh = locales['zh-CN'];
    for (const leaf of paths(zh)) {
      if (allowed.has(leaf)) continue;
      const read = (table: Copy) =>
        leaf.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], table);
      if (isPluralLeaf(read(zh))) {
        for (const form of Object.keys(read(zh) as PluralMessage)) {
          expect((read(zh) as Record<string, string>)[form], `${leaf}.${form}`).not.toBe(
            (read(enUS) as Record<string, string>)[form],
          );
        }
      } else {
        expect(read(zh), leaf).not.toBe(read(enUS));
      }
    }
  });
});

// ---- helpers ----------------------------------------------------------------

describe('fmt', () => {
  it('fills known placeholders and leaves the rest alone', () => {
    expect(fmt('a {x} c', { x: 'B' })).toBe('a B c');
    expect(fmt('{x} {y}', { x: 1 })).toBe('1 {y}');
    expect(fmt('{x}')).toBe('{x}');
  });
});

describe('plural', () => {
  const forms: PluralMessage = { one: '{n} file', other: '{n} files' };

  it('uses the locale’s own CLDR rules', () => {
    expect(plural(1, forms, 'en-US')).toBe('{n} file');
    expect(plural(2, forms, 'en-US')).toBe('{n} files');
    // Chinese has a single category, so `one` is never selected.
    expect(plural(1, forms, 'zh-CN')).toBe('{n} files');
    // Russian distinguishes few/many — an English table collapses to `other` there.
    expect(plural(1, forms, 'ru-RU')).toBe('{n} file');
    expect(plural(3, forms, 'ru-RU')).toBe('{n} files');
  });

  it('falls back to `other` for a category the message omits', () => {
    expect(plural(5, { other: '{n} items' }, 'en-US')).toBe('{n} items');
  });

  it('counts by magnitude, so a fractional value still reads as its unit', () => {
    expect(plural(1.4, forms, 'en-US')).toBe('{n} file');
  });
});

describe('acceptLanguages', () => {
  it('orders by q value and drops q=0', () => {
    expect(acceptLanguages('zh-CN;q=0.9, en-US, fr-FR;q=0')).toEqual(['en-US', 'zh-CN']);
  });

  it('is empty for a missing header', () => {
    expect(acceptLanguages(null)).toEqual([]);
    expect(acceptLanguages('')).toEqual([]);
  });
});

// ---- negotiation ---------------------------------------------------------------

describe('pickLocale', () => {
  it('takes the first tag this build ships', () => {
    expect(pickLocale(['fr-FR', 'zh-CN', 'en-US'])).toBe('zh-CN');
  });

  it('matches exactly, without folding subtags', () => {
    // `zh` is not `zh-CN`: the tables are keyed by the tags browsers actually report,
    // so a half-matching tag must not silently pick a translation.
    expect(pickLocale(['zh'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale(['zh-Hans-CN'])).toBe(DEFAULT_LOCALE);
  });

  it('falls back to the default when nothing matches or nothing is reported', () => {
    expect(pickLocale(['fr-FR', 'de-DE'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale([])).toBe(DEFAULT_LOCALE);
    expect(pickLocale(undefined)).toBe(DEFAULT_LOCALE);
  });
});

// ---- the live view --------------------------------------------------------------

describe('module-level copy', () => {
  it('follows the active locale instead of freezing one table', () => {
    setActiveLocale('en-US');
    expect(activeLocale()).toBe('en-US');
    expect(copy.settings.language).toBe('Language');
    setActiveLocale('zh-CN');
    expect(copy.settings.language).toBe('语言');
    setActiveLocale('en-US');
    expect(copy.settings.language).toBe('Language');
  });

  it('hands back the real table of the active locale, not a merged copy', () => {
    setActiveLocale('zh-CN');
    expect(copy.sync).toBe(locales['zh-CN'].sync);
  });

  it('ignores a tag this build does not ship', () => {
    setActiveLocale('en-US');
    setActiveLocale('fr-FR' as LocaleCode);
    expect(activeLocale()).toBe('en-US');
  });

  it('plural() defaults to the active locale', () => {
    setActiveLocale('en-US');
    expect(plural(1, { one: '{n} vote', other: '{n} votes' })).toBe('{n} vote');
    setActiveLocale('zh-CN');
    expect(plural(1, { other: '{n} 票' })).toBe('{n} 票');
    setActiveLocale('en-US');
  });
});

describe('the Copy contract', () => {
  it('is satisfied by every registered table', () => {
    for (const table of Object.values(locales)) {
      const typed: Copy = table;
      expect(Object.keys(typed).length).toBe(Object.keys(enUS).length);
    }
  });
});
