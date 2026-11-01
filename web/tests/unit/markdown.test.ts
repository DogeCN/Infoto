import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import {
  createMarkdownRenderer,
  MARKDOWN_PUBLIC,
  MARKDOWN_SANITIZER_CONFIG,
  MARKDOWN_TRUSTED,
  markdownSanitizerHooks,
  type UponSanitizeElement,
  insertImageAt,
  insertLinkAt,
  insertMediaAt,
  insertMediaLinesAt,
  insertMarkdownBlock,
  isEmbeddableArtifact,
  isImageFile,
  mapOffsetThroughEdit,
  markdownImageRule,
  markdownMediaKind,
  prefixSelectedLines,
  wrapSelection,
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

  // The editor previews a picked file locally: an image qualifies by MIME or by name, so a
  // Windows pick with an empty MIME still previews instead of silently not.
  {
    assert.equal(isImageFile({ type: 'image/png', name: 'a.bin' }), true);
    assert.equal(isImageFile({ type: '', name: 'a.JPEG' }), true);
    assert.equal(isImageFile({ type: '', name: 'noextension' }), false);
    assert.equal(isImageFile({ type: 'video/mp4', name: 'clip.mp4' }), false);
    assert.equal(isImageFile({ type: 'application/pdf', name: 'notes.pdf' }), false);
    assert.equal(isImageFile({ type: '', name: '' }), false);
    assert.equal(isImageFile({}), false);
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

  // A multi-file pick lands one line per file — never one concatenated run.
  {
    const batch = insertMediaLinesAt('intro', 5, [
      'https://host/a.png',
      'https://host/notes.pdf',
      'https://host/clip.mp4',
    ]);
    assert.equal(
      batch.value,
      [
        'intro',
        '![](https://host/a.png)',
        '[https://host/notes.pdf](https://host/notes.pdf)',
        '![](https://host/clip.mp4)',
      ].join('\n'),
    );
    // One hosted URL alone takes the single-file path, so its name still lands as alt.
    assert.equal(
      insertMediaAt('', 0, 'https://host/a.png', 'shot').value,
      '![shot](https://host/a.png)',
    );
    // The caret sits after the inserted block, on its own line.
    assert.equal(batch.selection.start, batch.value.length, 'caret after the whole block');
    // Inserting mid-document keeps a newline on both sides of the block.
    const middle = insertMediaLinesAt('ab\ncd', 2, ['https://host/x.png']);
    assert.equal(middle.value, 'ab\n![](https://host/x.png)\ncd');
  }
});

// The renderer emits the final element, so the document never sees a placeholder `<img>` that
// would fetch the file before it could be replaced. This is a pure string assertion: the same
// rule the component installs is run against real Markdown.
test('markdown media: the renderer emits the final element, not an image to upgrade', () => {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  md.renderer.rules.image = markdownImageRule;

  const video = md.render('![clip](https://host/clip.mp4)');
  assert.match(video, /<video src="https:\/\/host\/clip\.mp4"[^>]*autoplay[^>]*muted/);
  assert.match(video, /aria-label="clip"/);
  assert.doesNotMatch(video, /<img/);

  const audio = md.render('![song](https://host/song.mp3)');
  assert.match(
    audio,
    /<audio src="https:\/\/host\/song\.mp3" class="markdown-audio" controls aria-label="song"><\/audio>/,
  );
  assert.doesNotMatch(audio, /md-media/);

  const image = md.render('![shot](https://host/a.webp)');
  assert.match(
    image,
    /<span class="md-media skeleton"><img src="https:\/\/host\/a\.webp" alt="shot"><\/span>/,
  );

  const file = md.render('![notes](https://host/notes.pdf)');
  assert.match(file, /<a class="markdown-file" href="https:\/\/host\/notes\.pdf" download/);
  assert.match(file, />notes<\/a>/);
  assert.doesNotMatch(file, /<img/);

  // No alt: the link label falls back to the URL; the image keeps an empty alt.
  assert.match(md.render('![](https://host/f.bin)'), />https:\/\/host\/f\.bin<\/a>/);
  assert.match(md.render('![](https://host/a.png)'), /alt=""/);

  // Alt text is escaped, not injected as markup.
  assert.match(md.render('![a"b](https://host/a.png)'), /alt="a&quot;b"/);
});

// The extension `extFor` writes into the multipart filename survives into the returned URL,
// and this module reads it back to pick the element. The two tables therefore have to agree:
// a video MIME whose extension is unknown here renders as a plain download link instead of a
// player, which reads as "the editor uploaded something it cannot show". `extFor` is private,
// so its table is read from source (the pattern `gifFrameTiming.test.ts` uses for the worker).
test('markdown media: every MIME the upload client names maps to an extension this module knows', () => {
  const source = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'src', 'core', 'api', 'uploadClient.ts'),
    'utf8',
  );
  const table = /const known: Record<string, string> = \{([\s\S]*?)\n {2}\};/.exec(source);
  assert.ok(table, 'uploadClient.ts has no extFor MIME table');
  const pairs = [...table[1]!.matchAll(/'([\w.+-]+\/[\w.+-]+)':\s*'([\w]+)'/g)].map((match) => ({
    mime: match[1]!,
    ext: match[2]!,
  }));
  // A table parsed as empty would pass every assertion below for the same reason a correct one
  // does, so the scan states its own size.
  assert.ok(pairs.length >= 20, `parsed only ${pairs.length} MIME→extension pairs`);

  for (const { mime, ext } of pairs) {
    const family = mime.slice(0, mime.indexOf('/'));
    const kind = family === 'image' ? 'image' : family === 'video' ? 'video' : 'audio';
    const url = `https://host/x.${ext}`;
    assert.equal(markdownMediaKind(url), kind, `${mime} uploads as .${ext}`);
    assert.equal(
      isEmbeddableArtifact(url),
      true,
      `${mime} uploads as .${ext}, which renders as a link`,
    );
  }
});

// Appended to web/tests/unit/markdown.test.ts by a one-shot patch; kept as a file so quotes and
// backticks are literal rather than doubly escaped through a template string.
// GFM is CommonMark plus five extensions. Tables, emphasis and links were already correct; the
// other three were silently missing, which is the worst failure mode for a Markdown dialect —
// the author writes spec-correct syntax and nothing happens. Every case below is taken from the
// spec's own example list (https://github.github.com/gfm/), so the assertions are the spec's
// output rather than this implementation's current output.
test('markdown gfm: strikethrough, task lists and autolinks follow the spec examples', () => {
  const md = createMarkdownRenderer(MARKDOWN_TRUSTED);

  // §6.5 example 1: one or two tildes, and <del> — not the bundled rule's two-or-more and <s>.
  assert.equal(
    md.render('~~Hi~~ Hello, ~there~ world!').trim(),
    '<p><del>Hi</del> Hello, <del>there</del> world!</p>',
  );
  // §6.5 example 3: three tildes are not a strike.
  assert.equal(
    md.render('This will ~~~not~~~ strike.').trim(),
    '<p>This will ~~~not~~~ strike.</p>',
  );

  // §5.3: a leading task marker becomes a disabled checkbox; nesting works.
  const tasks = md.render('- [ ] foo\n- [x] bar');
  assert.match(tasks, /<li><input type="checkbox" disabled>foo<\/li>/);
  assert.match(tasks, /<li><input type="checkbox" disabled checked>bar<\/li>/);
  assert.doesNotMatch(tasks, /\[[ x]\]/, 'the literal brackets must be consumed by the marker');
  assert.match(
    md.render('- [x] foo\n  - [ ] bar\n- [ ] bim'),
    /<li><input type="checkbox" disabled checked>foo\n<ul>\n<li><input type="checkbox" disabled>bar/,
  );
  // A marker that is not at the head of the item's first block is not a task, per the definition.
  assert.equal(md.render('foo [ ] bar').trim(), '<p>foo [ ] bar</p>');
  assert.equal(md.render('- [no] x').trim(), '<ul>\n<li>[no] x</li>\n</ul>');

  // §6.9: a bare domain autolinks, which linkify-it does not do by default.
  assert.equal(
    md.render('www.commonmark.org').trim(),
    '<p><a href="http://www.commonmark.org">www.commonmark.org</a></p>',
  );
  assert.match(
    md.render('Visit www.commonmark.org/help'),
    /href="http:\/\/www\.commonmark\.org\/help"/,
  );
});

// The two renderer configurations differ in exactly two ways, and both are load-bearing: a
// visitor authors public text, and an announcement is authored by the album's owner.
test('markdown renderers: public text drops HTML and media, trusted text accepts both', () => {
  const publicMd = createMarkdownRenderer(MARKDOWN_PUBLIC);
  const trusted = createMarkdownRenderer(MARKDOWN_TRUSTED);

  // Raw HTML: refused for a visitor's text, parsed for the owner's.
  assert.equal(
    publicMd.render('press <kbd>Ctrl</kbd>').trim(),
    '<p>press &lt;kbd&gt;Ctrl&lt;/kbd&gt;</p>',
  );
  assert.equal(trusted.render('press <kbd>Ctrl</kbd>').trim(), '<p>press <kbd>Ctrl</kbd></p>');
  assert.match(trusted.render('<details><summary>s</summary>body</details>'), /<details>/);

  // Media: dropped for public text, rendered in place for announcements.
  assert.equal(
    publicMd.render('look ![shot](https://h/a.png) here').trim(),
    '<p>look shot here</p>',
  );
  assert.match(
    trusted.render('![clip](https://h/clip.mp4)'),
    /<video src="https:\/\/h\/clip\.mp4"/,
  );
  // ⚠️ The public renderer once emitted "!shot": disabling markdown-it's image rule leaves the
  // leading `!` behind for the link rule to split around. The stray bang must not come back.
  assert.doesNotMatch(publicMd.render('![shot](https://h/a.png)'), /!/);
});

// Appended to web/tests/unit/markdown.test.ts by a one-shot patch.
// The rendering half of the pipeline is plain strings, but the *reader's* output goes through
// DOMPurify, and the node test environment has no DOM. So the sanitizer's own decision —
// which `<input>` survives — is tested here against a fake element, and the end-to-end result
// was verified in a browser. Testing only the rendered string is what let a checkbox-less task
// list ship: the string was right, the page was empty.
class FakeNode {
  nodeName: string;
  parentNode: { removeChild: (node: FakeNode) => void } | null;
  removed = false;
  private attrs: Array<{ name: string; value: string }>;

  constructor(name: string, attrs: Record<string, string> = {}) {
    this.nodeName = name.toUpperCase();
    this.attrs = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    this.parentNode = { removeChild: () => void (this.removed = true) };
  }

  get attributes() {
    return [...this.attrs];
  }
  getAttribute(name: string) {
    return this.attrs.find((a) => a.name === name)?.value ?? null;
  }
  removeAttribute(name: string) {
    this.attrs = this.attrs.filter((a) => a.name !== name);
  }
  setAttribute(name: string, value: string) {
    if (!this.attrs.some((a) => a.name === name)) this.attrs.push({ name, value });
  }
  names() {
    return this.attrs.map((a) => a.name);
  }
}

test('markdown sanitizer hooks: only the task checkbox survives an <input>', () => {
  const hooks: UponSanitizeElement[] = [];
  const fake = {
    addHook: (_name: 'uponSanitizeElement', fn: UponSanitizeElement) => void hooks.push(fn),
  };
  markdownSanitizerHooks(fake);
  assert.equal(hooks.length, 1, 'exactly one hook is registered');
  // The hook is declared against `Node`; the fake only implements the attribute surface the hook
  // actually reads, so the single call site is widened here rather than at every assertion.
  const run = (node: FakeNode) => hooks[0]!(node as unknown as Node);

  // A task checkbox is narrowed to the shape the renderer emits: decorative and inert.
  const checkbox = new FakeNode('input', { type: 'checkbox', checked: '' });
  run(checkbox);
  assert.equal(checkbox.removed, false);
  assert.ok(checkbox.getAttribute('disabled') !== null, 'a rendered checkbox must be disabled');
  assert.deepEqual(checkbox.names().sort(), ['checked', 'disabled', 'type']);

  // Anything that could carry a payload or look like a real field is gone.
  const sneaky = new FakeNode('input', {
    type: 'checkbox',
    name: 'pw',
    formaction: 'https://evil.example',
  });
  run(sneaky);
  assert.equal(sneaky.removed, false, 'a checkbox itself survives');
  assert.equal(sneaky.getAttribute('name'), null, 'name must not ride along');
  assert.equal(sneaky.getAttribute('formaction'), null, 'formaction must not ride along');

  // A non-checkbox input is removed outright — the phishing shape.
  for (const attrs of [
    { type: 'text', placeholder: 'Password' },
    { type: 'password', name: 'pw' },
    { type: 'image', formaction: 'https://evil.example' },
    {} as Record<string, string>,
  ]) {
    const node = new FakeNode('input', attrs);
    run(node);
    assert.equal(node.removed, true, `input ${JSON.stringify(attrs)} must be removed`);
  }

  // The hook must not touch anything that is not an input.
  const div = new FakeNode('div', { class: 'x' });
  run(div);
  assert.equal(div.removed, false);
  assert.deepEqual(div.names(), ['class']);
});

// The end-to-end claim: the configuration keeps forms out and the attribute that carries GFM
// table alignment in. Verified against real DOMPurify in a browser; asserted here as policy.
test('markdown sanitizer config: forms out, the style attribute stays', () => {
  const tags = MARKDOWN_SANITIZER_CONFIG.FORBID_TAGS;
  for (const tag of ['form', 'textarea', 'select', 'button', 'iframe', 'object', 'embed']) {
    assert.ok(tags.includes(tag), `${tag} must be stripped`);
  }
  // ⚠️ `input` must NOT be listed: the task-list checkbox is an `<input>`, and a blanket ban
  // removed it silently. The hook narrows it per element instead.
  assert.ok(!tags.includes('input'), 'input is narrowed by the hook, not banned wholesale');
  assert.ok(!Object.keys(MARKDOWN_SANITIZER_CONFIG).includes('FORBID_ATTR'), 'style must stay');
});
