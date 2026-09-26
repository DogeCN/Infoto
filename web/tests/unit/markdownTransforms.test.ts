import { describe, expect, it } from 'vitest';
import {
  insertImageAt,
  insertMarkdownBlock,
  mapOffsetThroughEdit,
  prefixSelectedLines,
  wrapSelection,
} from '../../src/lib/components/markdownTransforms';

describe('markdown toolbar transforms', () => {
  it('wraps the selected text and restores the selection', () => {
    expect(wrapSelection('hello world', { start: 6, end: 11 }, '**', '**', 'text')).toEqual({
      value: 'hello **world**',
      selection: { start: 8, end: 13 },
    });
    expect(wrapSelection('', { start: 0, end: 0 }, '*', '*', 'italic')).toEqual({
      value: '*italic*',
      selection: { start: 1, end: 7 },
    });
  });

  it('prefixes every selected line for quote and list tools', () => {
    expect(prefixSelectedLines('one\ntwo', { start: 0, end: 7 }, '> ')).toEqual({
      value: '> one\n> two',
      selection: { start: 2, end: 11 },
    });
  });

  it('isolates block syntax and places the code caret inside the block', () => {
    expect(insertMarkdownBlock('beforeafter', { start: 6, end: 6 }, '```\n\n```', 4)).toEqual({
      value: 'before\n```\n\n```\nafter',
      selection: { start: 11, end: 11 },
    });
  });

  it('inserts an image at a clamped remembered caret', () => {
    expect(insertImageAt('abcd', 99, 'https://img/x.webp')).toEqual({
      value: 'abcd![](https://img/x.webp)',
      selection: { start: 27, end: 27 },
    });
  });

  it('carries the source file name into the alt text', () => {
    expect(insertImageAt('', 0, 'https://img/x.webm', 'clip.gif')).toEqual({
      value: '![clip.gif](https://img/x.webm)',
      selection: { start: 31, end: 31 },
    });
  });

  it('strips brackets out of the alt text so the link stays parseable', () => {
    expect(insertImageAt('', 0, 'https://img/x.webm', 'a]b[c').value).toBe(
      '![abc](https://img/x.webm)',
    );
  });

  it('keeps asynchronous carets stable across edits before the insertion point', () => {
    expect(mapOffsetThroughEdit(4, 'abcd', 'abXcd')).toBe(5);
    expect(mapOffsetThroughEdit(8, 'abcdefgh', 'abXefgh')).toBe(7);
    expect(mapOffsetThroughEdit(2, 'abcd', 'aXbcd')).toBe(3);
  });
});
