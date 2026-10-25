import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  copy,
  detectLocale,
  getLocale,
  LOCALE_OPTIONS,
  setLocale,
} from '../../src/lib/i18n.svelte';
import { activeLocale, copy as moduleCopy, locales, otherLocale } from '$shared/copy';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

beforeEach(() => setLocale('en-US'));

test('i18n: detects, lists, validates, and persists locales without mutating copy tables', async () => {
  // Detects, switches, and persists a shipped locale without mutating the tables.
  {
    assert.equal(detectLocale(fakeStorage({ 'infoto-locale': 'zh-CN' })), 'zh-CN');
    assert.notEqual(detectLocale(fakeStorage({ 'infoto-locale': 'fr-FR' })), 'fr-FR');
    assert.doesNotThrow(() =>
      detectLocale({
        getItem() {
          throw new Error('denied');
        },
      }),
    );

    const before = JSON.stringify(locales);
    setLocale('zh-CN');
    assert.equal(getLocale(), 'zh-CN');
    assert.equal(copy.settings.volume, locales['zh-CN'].settings.volume);
    assert.equal(activeLocale(), 'zh-CN');
    assert.equal(moduleCopy.settings.volume, locales['zh-CN'].settings.volume);
    setLocale('en-US');
    assert.equal(copy.settings.volume, 'Volume');
    setLocale('zh-CN');
    assert.equal(JSON.stringify(locales), before);
    assert.equal(locales['en-US'].settings.volume, 'Volume');
    assert.equal(locales['zh-CN'].settings.volume, copy.settings.volume);

    const store = fakeStorage();
    setLocale('zh-CN', store);
    assert.equal(store.map.get('infoto-locale'), 'zh-CN');
    setLocale('fr-FR' as never);
    assert.equal(getLocale(), 'zh-CN');
    assert.doesNotThrow(() =>
      setLocale('en-US', {
        setItem() {
          throw new Error('denied');
        },
      }),
    );
    assert.equal(getLocale(), 'en-US');
  }

  // Translation targets the one other shipped locale.
  {
    assert.equal(otherLocale('en-US'), 'zh-CN');
    assert.equal(otherLocale('zh-CN'), 'en-US');
  }

  // Lists every shipped locale in its own language.
  {
    assert.deepEqual(LOCALE_OPTIONS.map((o) => o.code).sort(), Object.keys(locales).sort());
    for (const option of LOCALE_OPTIONS) {
      assert.ok(option.label.length > 0);
      assert.notEqual(option.label, option.code);
    }
  }

  // Rejects inherited object keys as locale names.
  {
    const { pickLocale, setActiveLocale } = await import('$shared/copy');
    for (const key of ['constructor', '__proto__', 'toString']) {
      assert.equal(pickLocale([key]), 'en-US');
      assert.equal(detectLocale(fakeStorage({ 'infoto-locale': key })), 'en-US');
      setLocale(key as never);
      setActiveLocale(key as never);
      assert.equal(getLocale(), 'en-US');
      assert.equal(activeLocale(), 'en-US');
    }
  }
});
