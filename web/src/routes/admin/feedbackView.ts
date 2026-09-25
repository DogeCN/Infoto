import type { Feedback } from '$shared/types';

export function filterFeedback(feedback: readonly Feedback[], query: string): Feedback[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...feedback];
  return feedback.filter((item) =>
    [item.contentMd, String(item.userId), String(item.id)].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}
