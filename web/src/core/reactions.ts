// 公告表情反应的共享常量与聚合（spec: "公告侧边栏"）——固定八枚表情，
// 每用户每公告仅一条回应。

import type { Announcement } from '$shared/types';

/** 固定表情集合（顺序即渲染顺序）。 */
export const EMOJI_SET = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🤔'] as const;

export interface ReactionCount {
	emoji: string;
	count: number;
	/** 当前用户是否已用该表情回应。 */
	selfReacted: boolean;
}

/**
 * 按固定表情集顺序聚合某公告的回应；未出现过的表情不渲染。
 * 同一用户对同一公告只保留一条回应（服务端保证），此处按出现计数。
 */
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
