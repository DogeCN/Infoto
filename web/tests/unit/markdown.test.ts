import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  insertImageAt,
  insertMarkdownBlock,
  mapOffsetThroughEdit,
  prefixSelectedLines,
  wrapSelection,
  isAnimatedArtifact,
} from '../../src/core/markdown';

test('markdown toolbar transforms: transforms Markdown selections and identifies animated artifacts', () => {
  // Wraps, prefixes, inserts, and keeps carets stable.
  {
    assert.deepEqual(wrapSelection('hello world', { start: 6, end: 11 }, '**', '**', 'text'), {
      value: 'hello **world**',
      selection: { start: 8, end: 13 },
    });
    assert.deepEqual(wrapSelection('', { start: 0, end: 0 }, '*', '*', 'italic'), {
      value: '*italic*',
      selection: { start: 1, end: 7 },
    });
    assert.deepEqual(prefixSelectedLines('one\ntwo', { start: 0, end: 7 }, '> '), {
      value: '> one\n> two',
      selection: { start: 2, end: 11 },
    });
    assert.deepEqual(insertMarkdownBlock('beforeafter', { start: 6, end: 6 }, '```\n\n```', 4), {
      value: 'before\n```\n\n```\nafter',
      selection: { start: 11, end: 11 },
    });
    assert.deepEqual(insertImageAt('abcd', 99, 'https://img/x.webp'), {
      value: 'abcd![](https://img/x.webp)',
      selection: { start: 27, end: 27 },
    });
    assert.deepEqual(insertImageAt('', 0, 'https://img/x.webm', 'clip.gif'), {
      value: '![clip.gif](https://img/x.webm)',
      selection: { start: 31, end: 31 },
    });
    assert.equal(
      insertImageAt('', 0, 'https://img/x.webm', 'a]b[c').value,
      '![abc](https://img/x.webm)',
    );
    assert.equal(mapOffsetThroughEdit(4, 'abcd', 'abXcd'), 5);
    assert.equal(mapOffsetThroughEdit(8, 'abcdefgh', 'abXefgh'), 7);
    assert.equal(mapOffsetThroughEdit(2, 'abcd', 'aXbcd'), 3);
  }

  // Prefixes the first empty line without moving the insertion to the second line.
  {
    assert.deepEqual(prefixSelectedLines('\ntext', { start: 0, end: 0 }, '> '), {
      value: '> \ntext',
      selection: { start: 2, end: 2 },
    });
  }

  // Treats a .webm path as animated and ignores everything else.
  {
    assert.equal(isAnimatedArtifact('https://host/a.webm'), true);
    assert.equal(isAnimatedArtifact('https://host/A.WEBM'), true);
    assert.equal(isAnimatedArtifact('https://host/a.webm?v=2#t=1'), true);
    assert.equal(isAnimatedArtifact('/static/a.webm'), true);
    assert.equal(isAnimatedArtifact('a.webm'), true);
    assert.equal(isAnimatedArtifact('https://host/a.webp'), false);
    assert.equal(isAnimatedArtifact('https://host/a.png'), false);
    assert.equal(isAnimatedArtifact('https://host/download?file=a.webm'), false);
    assert.equal(isAnimatedArtifact('not a url'), false);
    assert.equal(isAnimatedArtifact(null), false);
    assert.equal(isAnimatedArtifact(undefined), false);
    assert.equal(isAnimatedArtifact(''), false);
  }
});
