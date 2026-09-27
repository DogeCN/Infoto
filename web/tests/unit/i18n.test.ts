import { beforeEach, describe, expect, it } from 'vitest';
import {
  copy,
  detectLocale,
  getLocale,
  LOCALE_OPTIONS,
  setLocale,
} from '../../src/lib/i18n.svelte';
import { activeLocale, copy as moduleCopy, locales } from '$shared/copy';

/** Minimal in-memory Storage, so the tests never touch the runner's real one. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

beforeEach(() => setLocale('en-US'));

describe('detectLocale', () => {
  it('prefers a stored choice over the browser default', () => {
    expect(detectLocale(fakeStorage({ 'infoto-locale': 'zh-CN' }))).toBe('zh-CN');
  });

  it('ignores a stored tag this build does not ship', () => {
    expect(detectLocale(fakeStorage({ 'infoto-locale': 'fr-FR' }))).not.toBe('fr-FR');
  });

  it('survives storage being unavailable', () => {
    const blocked = {
      getItem() {
        throw new Error('denied');
      },
    };
    expect(() => detectLocale(blocked)).not.toThrow();
  });
});

describe('setLocale', () => {
  it('switches the reactive table components render from', () => {
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(copy.settings.language).toBe('语言');
    setLocale('en-US');
    expect(copy.settings.language).toBe('Language');
  });

  it('switches the module-level view plain modules read', () => {
    setLocale('zh-CN');
    expect(activeLocale()).toBe('zh-CN');
    expect(moduleCopy.settings.language).toBe('语言');
  });

  it('leaves the locale tables themselves untouched', () => {
    // `$state` deep-proxies what it is given. If `copy` wrapped a table directly,
    // switching would write *into* `locales` and every later read of that table
    // would return the other language — silently, and permanently.
    const before = JSON.stringify(locales);
    setLocale('zh-CN');
    setLocale('en-US');
    setLocale('zh-CN');
    expect(JSON.stringify(locales)).toBe(before);
    expect(locales['en-US'].settings.language).toBe('Language');
    expect(locales['zh-CN'].settings.language).toBe('语言');
  });

  it('remembers the choice', () => {
    const store = fakeStorage();
    setLocale('zh-CN', store);
    expect(store.map.get('infoto-locale')).toBe('zh-CN');
  });

  it('ignores an unknown tag and a no-op switch', () => {
    setLocale('zh-CN');
    const snapshot = copy.settings.language;
    setLocale('fr-FR' as never);
    expect(getLocale()).toBe('zh-CN');
    expect(copy.settings.language).toBe(snapshot);
  });

  it('applies the choice for the session even when storage throws', () => {
    const blocked = {
      setItem() {
        throw new Error('denied');
      },
    };
    expect(() => setLocale('zh-CN', blocked)).not.toThrow();
    expect(getLocale()).toBe('zh-CN');
  });
});

describe('LOCALE_OPTIONS', () => {
  it('offers every shipped locale, labelled in its own language', () => {
    expect(LOCALE_OPTIONS.map((o) => o.code).sort()).toEqual(Object.keys(locales).sort());
    for (const option of LOCALE_OPTIONS) {
      expect(option.label.length, option.code).toBeGreaterThan(0);
      expect(option.label, option.code).not.toBe(option.code);
    }
  });
});
