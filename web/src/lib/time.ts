/** Compact relative time ("刚刚" / "N 分钟前" … "N 年前") against an optional
 *  reference so tests (and stale renders) stay deterministic. */
export function formatRelativeTime(
	timestamp: number,
	reference: number = Date.now(),
): string {
	const elapsed = Math.max(0, reference - timestamp);
	if (elapsed < 60_000) return '刚刚';
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
	const days = Math.floor(elapsed / 86_400_000);
	if (days < 30) return `${days} 天前`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months} 个月前`;
	return `${Math.floor(months / 12)} 年前`;
}

export interface AbsoluteTimeOptions {
	locale?: string;
	timeZone?: string;
}

export function formatAbsoluteTime(
	timestamp: number,
	{ locale = 'zh-CN', timeZone }: AbsoluteTimeOptions = {},
): string {
	return new Date(timestamp).toLocaleString(locale, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone,
	});
}
