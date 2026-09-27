import { describe, expect, it } from 'vitest';
import {
  insertImageAt,
  insertMarkdownBlock,
  mapOffsetThroughEdit,
  prefixSelectedLines,
  wrapSelection,
  isAnimatedArtifact,
} from '../../src/core/markdown';

describe('markdown toolbar transforms', () => {
  it('transforms Markdown selections and identifies animated artifacts', async () => {
    // Wraps, prefixes, inserts, and keeps carets stable.
    {
      expect(wrapSelection('hello world', { start: 6, end: 11 }, '**', '**', 'text')).toEqual({
        value: 'hello **world**',
        selection: { start: 8, end: 13 },
      });
      expect(wrapSelection('', { start: 0, end: 0 }, '*', '*', 'italic')).toEqual({
        value: '*italic*',
        selection: { start: 1, end: 7 },
      });
      expect(prefixSelectedLines('one\ntwo', { start: 0, end: 7 }, '> ')).toEqual({
        value: '> one\n> two',
        selection: { start: 2, end: 11 },
      });
      expect(insertMarkdownBlock('beforeafter', { start: 6, end: 6 }, '```\n\n```', 4)).toEqual({
        value: 'before\n```\n\n```\nafter',
        selection: { start: 11, end: 11 },
      });
      expect(insertImageAt('abcd', 99, 'https://img/x.webp')).toEqual({
        value: 'abcd![](https://img/x.webp)',
        selection: { start: 27, end: 27 },
      });
      expect(insertImageAt('', 0, 'https://img/x.webm', 'clip.gif')).toEqual({
        value: '![clip.gif](https://img/x.webm)',
        selection: { start: 31, end: 31 },
      });
      expect(insertImageAt('', 0, 'https://img/x.webm', 'a]b[c').value).toBe(
        '![abc](https://img/x.webm)',
      );
      expect(mapOffsetThroughEdit(4, 'abcd', 'abXcd')).toBe(5);
      expect(mapOffsetThroughEdit(8, 'abcdefgh', 'abXefgh')).toBe(7);
      expect(mapOffsetThroughEdit(2, 'abcd', 'aXbcd')).toBe(3);
    }

    // Prefixes the first empty line without moving the insertion to the second line.
    {
      expect(prefixSelectedLines('\ntext', { start: 0, end: 0 }, '> ')).toEqual({
        value: '> \ntext',
        selection: { start: 2, end: 2 },
      });
    }

    // Treats a .webm path as animated and ignores everything else.
    {
      expect(isAnimatedArtifact('https://host/a.webm')).toBe(true);
      expect(isAnimatedArtifact('https://host/A.WEBM')).toBe(true);
      expect(isAnimatedArtifact('https://host/a.webm?v=2#t=1')).toBe(true);
      expect(isAnimatedArtifact('/static/a.webm')).toBe(true);
      expect(isAnimatedArtifact('a.webm')).toBe(true);
      expect(isAnimatedArtifact('https://host/a.webp')).toBe(false);
      expect(isAnimatedArtifact('https://host/a.png')).toBe(false);
      expect(isAnimatedArtifact('https://host/download?file=a.webm')).toBe(false);
      expect(isAnimatedArtifact('not a url')).toBe(false);
      expect(isAnimatedArtifact(null)).toBe(false);
      expect(isAnimatedArtifact(undefined)).toBe(false);
      expect(isAnimatedArtifact('')).toBe(false);
    }
  });
});
