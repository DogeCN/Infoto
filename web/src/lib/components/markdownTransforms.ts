export interface TextSelection {
  start: number;
  end: number;
}

export interface TextTransform {
  value: string;
  selection: TextSelection;
}

export function normalizeSelection(value: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(value.length, selection.start));
  const end = Math.max(start, Math.min(value.length, selection.end));
  return { start, end };
}

export function wrapSelection(
  value: string,
  selection: TextSelection,
  before: string,
  after: string,
  fallback: string,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const selected = value.slice(range.start, range.end) || fallback;
  return {
    value: value.slice(0, range.start) + before + selected + after + value.slice(range.end),
    selection: {
      start: range.start + before.length,
      end: range.start + before.length + selected.length,
    },
  };
}

export function prefixSelectedLines(
  value: string,
  selection: TextSelection,
  prefix: string,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const start = value.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  const selected = value.slice(start, range.end);
  const prefixed = selected
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
  return {
    value: value.slice(0, start) + prefixed + value.slice(range.end),
    selection: {
      start: start + prefix.length,
      end: start + prefixed.length,
    },
  };
}

export function insertMarkdownBlock(
  value: string,
  selection: TextSelection,
  block: string,
  caretOffset = block.length,
): TextTransform {
  const range = normalizeSelection(value, selection);
  const leadingBreak = range.start > 0 && value[range.start - 1] !== '\n' ? '\n' : '';
  const trailingBreak = range.end < value.length && value[range.end] !== '\n' ? '\n' : '';
  const inserted = leadingBreak + block + trailingBreak;
  return {
    value: value.slice(0, range.start) + inserted + value.slice(range.end),
    selection: {
      start: range.start + leadingBreak.length + caretOffset,
      end: range.start + leadingBreak.length + caretOffset,
    },
  };
}

export function insertImageAt(value: string, position: number, url: string): TextTransform {
  const safePosition = Math.max(0, Math.min(value.length, position));
  const markdown = `![](${url})`;
  return {
    value: value.slice(0, safePosition) + markdown + value.slice(safePosition),
    selection: {
      start: safePosition + markdown.length,
      end: safePosition + markdown.length,
    },
  };
}

export function mapOffsetThroughEdit(offset: number, before: string, after: string): number {
  if (before === after) return Math.max(0, Math.min(before.length, offset));
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (offset <= prefix) return offset;
  if (offset >= before.length - suffix) {
    return Math.max(0, Math.min(after.length, offset + after.length - before.length));
  }
  return prefix;
}
