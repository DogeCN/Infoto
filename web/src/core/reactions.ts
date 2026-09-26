// Shared constants and aggregation for announcement emoji reactions — eight fixed
// emojis, one response per user per announcement.

import type { Announcement } from '$shared/types';

/** Fixed emoji set (the order is the render order). */
export const EMOJI_SET = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🤔'] as const;

export interface ReactionCount {
  emoji: string;
  count: number;
  /** Whether the current user already reacted with this emoji. */
  selfReacted: boolean;
}

/** Aggregate an announcement's responses in fixed emoji order (emojis that never
 * appeared are skipped). The server keeps one response per user per announcement,
 * so this side only counts occurrences. */
export function reactionCounts(ann: Announcement, selfId: number): ReactionCount[] {
  const map = new Map<string, { count: number; selfReacted: boolean }>();
  for (const r of ann.reactions) {
    const entry = map.get(r.emoji) ?? { count: 0, selfReacted: false };
    entry.count++;
    if (r.userId === selfId) entry.selfReacted = true;
    map.set(r.emoji, entry);
  }
  return EMOJI_SET.filter((e) => map.has(e)).map((emoji) => ({ emoji, ...map.get(emoji)! }));
}
