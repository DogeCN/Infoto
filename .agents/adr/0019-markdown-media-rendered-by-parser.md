# 0019: Markdown media is rendered by the parser, not upgraded after parsing

- **Date**: 2026-10-18
- **Status**: Accepted
- **Context**: markdown-it emits every `![alt](url)` as `<img src>`, because at parse time it
  cannot know what the URL points at. The editor accepts any file, so an announcement may embed
  a video, an audio file, or a plain download link (a `.pdf`, a `.zip`). The previous approach
  parsed into an inert `<template>`, walked the result and replaced each placeholder `<img>` with
  the element its extension named, then attached the finished tree. That worked, but it kept a
  second rendering pass, a template-specific `img.complete` trap, and a source-string test whose
  only job was to stop the upgrade from being moved back after attachment.
- **Decision**: Replace markdown-it's `image` renderer rule (trusted renderer only) with
  `markdownImageRule` in `web/src/core/markdown.ts`. The rule classifies the URL with the same
  predicates the editor uses (`isEmbeddableArtifact`, `markdownMediaKind`) and returns the final
  markup: `<img>`, `<video>`, `<audio controls>`, or `<a class="markdown-file" download>`. The
  sanitized string is assigned to the live container directly. Shimmer removal and aspect-ratio
  measurement are delegated listeners on the container; click-to-unmute is delegated the same
  way.
- **Consequences**:
  - No placeholder request exists, so the browser fetches exactly once per embedded file.
  - Classification is a pure string function, testable in Node against real Markdown output
    instead of by asserting the component's source.
  - The `<template>` stage and its `complete`/`naturalWidth` trap disappear.
  - `mdSafe` still disables images for public content; the rule is installed on `mdFull` only.
  - A future change that reintroduces a post-parse swap would restore the double request; the
    CONTRACT §3 rules call this out explicitly.
- **Alternatives considered**:
  - Keep the `<template>` upgrade: works, but retains a whole second pass and a DOM-only test
    strategy.
  - Rewrite non-media `![]()` into `[]()` in the Markdown source: rejected earlier — it loses the
    `markdown-file` class and `download` attribute, so a PDF stops reading as a download button.
  - Render media from a Svelte component per URL: needs a custom tokenizer and breaks the
    one-string sanitization boundary; the renderer rule is the smallest correct point.
