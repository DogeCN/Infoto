// id36 — autoincrement id <-> base-36 string (0-9a-z), pure functions.
// External media id representation (spec: "媒体 ID 与地址策略"):
// 7 -> "7", 35 -> "z", 36 -> "10".

/** Numeric id -> base-36 string. Throws on negative / non-integer input. */
export function toId36(id: number): string {
	if (!Number.isInteger(id) || id < 0) throw new Error(`invalid id: ${id}`);
	return id.toString(36);
}

/** Base-36 string -> numeric id, or null when malformed. */
export function fromId36(s: string): number | null {
	if (!/^[0-9a-z]+$/.test(s)) return null;
	const n = parseInt(s, 36);
	return Number.isSafeInteger(n) ? n : null;
}

/** Short media URL for off-site scenarios: `{origin}/l/{id36}` (spec). */
export function proxyUrl(origin: string, id: number): string {
	return `${origin}/l/${toId36(id)}`;
}
