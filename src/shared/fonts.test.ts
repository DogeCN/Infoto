import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  APP_FONT_QUERY,
  FONT_RACE_SCRIPT,
  FONT_RACE_SHA256,
  FONT_SOURCES,
  fontHeadBlock,
  fontPageCsp,
  fontStylesheetUrl,
  injectFonts,
} from './fonts.ts';

const indexHtml = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'web/index.html'),
  'utf8',
);

test('web fonts: races every source and cancels the losers', () => {
  const block = fontHeadBlock(APP_FONT_QUERY);
  for (const source of FONT_SOURCES) {
    assert.ok(block.includes(`<link rel="stylesheet" data-font-race href="${source.css}/css2?`));
  }
  assert.equal(block.match(/rel="stylesheet"/g)?.length, FONT_SOURCES.length);
  assert.ok(indexHtml.includes('<!-- fonts -->'));
  const injected = injectFonts(indexHtml);
  assert.ok(!injected.includes('<!-- fonts -->'));
  assert.ok(injected.includes(block));
  assert.equal(
    fontStylesheetUrl(FONT_SOURCES[0], APP_FONT_QUERY),
    `https://fonts.googleapis.cn/css2?${APP_FONT_QUERY}`,
  );
});

// Keep every stylesheet host and file host in the markup and in the CSP.
test('web fonts: keeps each source a matching pair in markup and CSP', () => {
  const csp = fontPageCsp();
  const cssHosts = FONT_SOURCES.map((source) => source.css).join(' ');
  const fileHosts = FONT_SOURCES.map((source) => source.files).join(' ');
  assert.ok(csp.includes(`style-src 'unsafe-inline' ${cssHosts}`));
  assert.ok(csp.includes(`font-src ${fileHosts}`));
  assert.ok(csp.includes(`connect-src ${cssHosts} ${fileHosts}`));

  const block = fontHeadBlock(APP_FONT_QUERY);
  for (const source of FONT_SOURCES) {
    assert.ok(block.includes(`<link rel="preconnect" href="${source.css}" crossorigin>`));
    assert.ok(block.includes(`<link rel="preconnect" href="${source.files}" crossorigin>`));
  }
});

test('web fonts: keeps the unverified mirror out of the page', () => {
  const injected = injectFonts(indexHtml);
  for (const retired of ['ustclug.org']) {
    assert.ok(!injected.includes(retired));
    assert.ok(!fontPageCsp().includes(retired));
  }
});

// The CSP hash is a literal next to the script it must match, so pin them together.
test('web fonts: keeps the CSP hash equal to the race script', () => {
  assert.equal(
    FONT_RACE_SHA256,
    createHash('sha256').update(FONT_RACE_SCRIPT, 'utf8').digest('base64'),
  );
  assert.ok(fontPageCsp().includes(`script-src 'sha256-${FONT_RACE_SHA256}'`));
  // The hash allows this one script without re-opening inline script execution.
  assert.ok(!fontPageCsp().includes(`script-src 'unsafe-inline'`));
});

// The script is inlined between <script> tags, so neither a backtick (it would close the
// template literal the script is written in) nor "</script" (it would close the element) can
// appear inside it.
test('web fonts: keeps the race script safe to inline', () => {
  assert.ok(!FONT_RACE_SCRIPT.includes('`'));
  assert.doesNotMatch(FONT_RACE_SCRIPT, /<\/script/i);
});

// Minimal DOM stand-in: the script only touches these members.
type StubLink = {
  nodeType: number;
  tagName: string;
  /** Whether the element carries `data-font-race`. */
  fontRace: boolean;
  isConnected: boolean;
  /** Non-null once the stylesheet has applied; null while loading and after a failure. */
  sheet: object | null;
  removed: boolean;
  hasAttribute(name: string): boolean;
  addEventListener(type: string, fn: () => void): void;
  remove(): void;
  /** Apply the stylesheet without firing an event, as a cached response does. */
  apply(): void;
  fire(type: 'load' | 'error'): void;
};

function stubLink(options: { fontRace?: boolean } = {}): StubLink {
  const listeners = new Map<string, Array<() => void>>();
  const link: StubLink = {
    nodeType: 1,
    tagName: 'LINK',
    fontRace: options.fontRace ?? true,
    isConnected: true,
    sheet: null,
    removed: false,
    hasAttribute: (name) => name === 'data-font-race' && link.fontRace,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    remove() {
      link.isConnected = false;
      link.removed = true;
    },
    apply() {
      link.sheet = {};
    },
    fire(type) {
      if (type === 'load') link.apply();
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
  return link;
}

/**
 * Run the race script. The links arrive the way they do on a real page: the parser inserts them
 * one at a time, and the script claims each through its observer.
 */
function runRace(present: StubLink[] = []) {
  let notify: ((records: Array<{ addedNodes: StubLink[] }>) => void) | null = null;
  const MutationObserver = class {
    constructor(callback: (records: Array<{ addedNodes: StubLink[] }>) => void) {
      notify = callback;
    }
    observe() {
      /* the real target is documentElement */
    }
  };
  const document = { querySelectorAll: () => present, documentElement: {} };
  new Function('document', 'MutationObserver', FONT_RACE_SCRIPT)(document, MutationObserver);
  return {
    /** The parser inserts a link. */
    insert(link: StubLink) {
      notify?.([{ addedNodes: [link] }]);
    },
  };
}

test('web fonts: the first stylesheet to load removes every other one', () => {
  const [cn, global] = [stubLink(), stubLink()];
  const race = runRace();
  race.insert(cn);
  race.insert(global);

  cn.fire('load');
  assert.equal(cn.removed, false);
  assert.equal(global.removed, true);
});

test('web fonts: a source that fails removes only itself', () => {
  const [cn, global] = [stubLink(), stubLink()];
  const race = runRace();
  race.insert(cn);
  race.insert(global);

  cn.fire('error');
  assert.equal(cn.removed, true);
  assert.equal(global.removed, false);

  // The survivor still settles the race when it answers.
  global.fire('load');
  assert.equal(global.removed, false);
});

test('web fonts: a removed source cannot settle the race when it answers late', () => {
  const [cn, global] = [stubLink(), stubLink()];
  const race = runRace();
  race.insert(cn);
  race.insert(global);

  cn.fire('load');
  // The loser was detached, then its request finished and reported success anyway.
  global.fire('load');
  assert.equal(cn.removed, false);
});

test('web fonts: every source failing leaves nothing declared', () => {
  const [cn, global] = [stubLink(), stubLink()];
  const race = runRace();
  race.insert(cn);
  race.insert(global);

  cn.fire('error');
  global.fire('error');
  assert.deepEqual([cn.removed, global.removed], [true, true]);
});

// A stylesheet can already have applied before the script runs — a cached response, or a re-run.
// It will never report a `load` again, so the script has to read `sheet` instead of waiting.
test('web fonts: a source that applied before the script ran still wins', () => {
  const cn = stubLink();
  const global = stubLink();
  cn.apply();
  runRace([cn, global]);

  assert.equal(cn.removed, false);
  assert.equal(global.removed, true);
});

test('web fonts: a source that applied before the script ran cancels a still-loading rival', () => {
  const cn = stubLink();
  const global = stubLink();
  global.apply();
  runRace([cn, global]);

  assert.equal(global.removed, false);
  assert.equal(cn.removed, true);
});

test('web fonts: ignores nodes that are not racing stylesheets', () => {
  const other = stubLink({ fontRace: false });
  const cn = stubLink();
  const race = runRace();
  race.insert(other);
  race.insert(cn);

  cn.fire('load');
  assert.equal(other.removed, false);
});
