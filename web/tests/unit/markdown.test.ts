import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  insertImageAt,
  insertLinkAt,
  insertMediaAt,
  insertMarkdownBlock,
  isEmbeddableArtifact,
  mapOffsetThroughEdit,
  prefixSelectedLines,
  wrapSelection,
  markdownMediaKind,
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

  // Classifies a media URL by extension: video, audio, or (the default) image.
  {
    assert.equal(markdownMediaKind('https://host/a.webm'), 'video');
    assert.equal(markdownMediaKind('https://host/A.WEBM'), 'video');
    assert.equal(markdownMediaKind('https://host/a.webm?v=2#t=1'), 'video');
    assert.equal(markdownMediaKind('/static/a.webm'), 'video');
    assert.equal(markdownMediaKind('a.webm'), 'video');
    assert.equal(markdownMediaKind('https://host/clip.mp4'), 'video');
    assert.equal(markdownMediaKind('https://host/clip.mov'), 'video');
    assert.equal(markdownMediaKind('https://host/song.mp3'), 'audio');
    assert.equal(markdownMediaKind('https://host/song.flac'), 'audio');
    assert.equal(markdownMediaKind('https://host/a.webp'), 'image');
    assert.equal(markdownMediaKind('https://host/a.png'), 'image');
    assert.equal(markdownMediaKind('https://host/download?file=a.webm'), 'image');
    assert.equal(markdownMediaKind('not a url'), 'image');
    assert.equal(markdownMediaKind(null), 'image');
    assert.equal(markdownMediaKind(undefined), 'image');
    assert.equal(markdownMediaKind(''), 'image');
  }

  // Only a real media extension renders in place; a non-media file must land as a link.
  {
    assert.equal(isEmbeddableArtifact('https://host/a.png'), true);
    assert.equal(isEmbeddableArtifact('https://host/a.JPEG'), true);
    assert.equal(isEmbeddableArtifact('https://host/a.avif'), true);
    assert.equal(isEmbeddableArtifact('https://host/clip.mp4'), true);
    assert.equal(isEmbeddableArtifact('https://host/song.mp3'), true);
    assert.equal(isEmbeddableArtifact('https://host/notes.pdf'), false);
    assert.equal(isEmbeddableArtifact('https://host/archive.zip'), false);
    assert.equal(isEmbeddableArtifact('https://host/download?file=a.png'), false);
    assert.equal(isEmbeddableArtifact('https://host/noextension'), false);
    assert.equal(isEmbeddableArtifact('not a url'), false);
    assert.equal(isEmbeddableArtifact(null), false);
    assert.equal(isEmbeddableArtifact(undefined), false);
    assert.equal(isEmbeddableArtifact(''), false);
  }

  // Inserting a hosted file: media becomes ![name](url), everything else [name](url).
  {
    assert.equal(
      insertMediaAt('', 0, 'https://host/a.png', 'shot').value,
      '![shot](https://host/a.png)',
    );
    assert.equal(
      insertMediaAt('', 0, 'https://host/clip.mp4', 'clip').value,
      '![clip](https://host/clip.mp4)',
    );
    assert.equal(
      insertMediaAt('', 0, 'https://host/song.mp3', 'song').value,
      '![song](https://host/song.mp3)',
    );
    assert.equal(
      insertMediaAt('', 0, 'https://host/notes.pdf', 'notes').value,
      '[notes](https://host/notes.pdf)',
    );
    // An unknown extension falls back to the URL as its label, never an empty link.
    assert.equal(
      insertMediaAt('', 0, 'https://host/f.bin', '').value,
      '[https://host/f.bin](https://host/f.bin)',
    );
    // Brackets in a file name cannot break the link text.
    assert.equal(
      insertLinkAt('', 0, 'https://host/a.pdf', 'a]b[c').value,
      '[abc](https://host/a.pdf)',
    );
  }
});
