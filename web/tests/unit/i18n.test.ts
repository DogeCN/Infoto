import { beforeEach, describe, expect, it } from 'vitest';
import {
  copy,
  detectLocale,
  getLocale,
  LOCALE_OPTIONS,
  setLocale,
} from '../../src/lib/i18n.svelte';
import { activeLocale, copy as moduleCopy, locales } from '$shared/copy';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

beforeEach(() => setLocale('en-US'));

describe('i18n', () => {
  it('detects, lists, validates, and persists locales without mutating copy tables', async () => {
    // Detects, switches, and persists a shipped locale without mutating the tables.
    {
      expect(detectLocale(fakeStorage({ 'infoto-locale': 'zh-CN' }))).toBe('zh-CN');
      expect(detectLocale(fakeStorage({ 'infoto-locale': 'fr-FR' }))).not.toBe('fr-FR');
      expect(() =>
        detectLocale({
          getItem() {
            throw new Error('denied');
          },
        }),
      ).not.toThrow();

      const before = JSON.stringify(locales);
      setLocale('zh-CN');
      expect(getLocale()).toBe('zh-CN');
      expect(copy.settings.language).toBe(locales['zh-CN'].settings.language);
      expect(activeLocale()).toBe('zh-CN');
      expect(moduleCopy.settings.language).toBe(locales['zh-CN'].settings.language);
      setLocale('en-US');
      expect(copy.settings.language).toBe('Language');
      setLocale('zh-CN');
      expect(JSON.stringify(locales)).toBe(before);
      expect(locales['en-US'].settings.language).toBe('Language');
      expect(locales['zh-CN'].settings.language).toBe(copy.settings.language);

      const store = fakeStorage();
      setLocale('zh-CN', store);
      expect(store.map.get('infoto-locale')).toBe('zh-CN');
      setLocale('fr-FR' as never);
      expect(getLocale()).toBe('zh-CN');
      expect(() =>
        setLocale('en-US', {
          setItem() {
            throw new Error('denied');
          },
        }),
      ).not.toThrow();
      expect(getLocale()).toBe('en-US');
    }

    // Lists every shipped locale in its own language.
    {
      expect(LOCALE_OPTIONS.map((o) => o.code).sort()).toEqual(Object.keys(locales).sort());
      for (const option of LOCALE_OPTIONS) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.label).not.toBe(option.code);
      }
    }

    // Rejects inherited object keys as locale names.
    {
      const { pickLocale, setActiveLocale } = await import('$shared/copy');
      for (const key of ['constructor', '__proto__', 'toString']) {
        expect(pickLocale([key])).toBe('en-US');
        expect(detectLocale(fakeStorage({ 'infoto-locale': key }))).toBe('en-US');
        setLocale(key as never);
        setActiveLocale(key as never);
        expect(getLocale()).toBe('en-US');
        expect(activeLocale()).toBe('en-US');
      }
    }
  });
});
