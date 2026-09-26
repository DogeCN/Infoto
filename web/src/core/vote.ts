// `:::vote` parsing — a pure, DOM-free helper. Only the first `:::vote` block is
// used: the data model keeps a single per-user vote per announcement, so an
// announcement has at most one vote.

/** Positional variant: keeps the text before / after the `:::vote` line so
 *  renderers can place the VoteBlock exactly where it was authored. */
export interface SplitVote {
  options: string[];
  /** Markdown before the `:::vote` line (joined original lines). */
  before: string;
  /** Markdown after the `:::vote` line. Later `:::vote` lines stay here as plain text. */
  after: string;
}

function extractVoteLine(contentMd: string): { options: string[]; index: number } {
  const lines = contentMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].trim().match(/^:::vote\s*(.*)$/);
    if (!m) continue;
    const options: string[] = [];
    for (const part of m[1].split('|')) {
      const s = part.trim();
      if (s) options.push(s);
    }
    return { options, index: i };
  }
  return { options: [], index: -1 };
}

export function splitVote(contentMd: string): SplitVote {
  const { options, index } = extractVoteLine(contentMd);
  if (index < 0) return { options: [], before: contentMd, after: '' };
  const lines = contentMd.split(/\r?\n/);
  return {
    options,
    before: lines.slice(0, index).join('\n'),
    after: lines.slice(index + 1).join('\n'),
  };
}
