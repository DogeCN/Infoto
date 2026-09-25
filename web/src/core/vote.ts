// `:::vote` parsing — a pure, DOM-free helper (spec: "Markdown 编辑器" /
// "数据模型"). Only the first `:::vote` block is used: the data model keeps a
// single per-user vote per announcement, so an announcement has at most one vote.

export interface ParsedVote {
  /** Vote option labels, 0-based order. Empty when the body has no `:::vote`. */
  options: string[];
  /** contentMd with the `:::vote` line stripped, for safe display. */
  body: string;
}

export function parseVote(contentMd: string): ParsedVote {
  const lines = contentMd.split(/\r?\n/);
  const options: string[] = [];
  const body: string[] = [];
  let used = false;
  for (const line of lines) {
    const m = line.trim().match(/^:::vote\s*(.*)$/);
    if (m && !used) {
      used = true;
      for (const part of m[1].split('|')) {
        const s = part.trim();
        if (s) options.push(s);
      }
      continue;
    }
    body.push(line);
  }
  return { options, body: body.join('\n') };
}
