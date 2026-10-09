import type { AgentThreadItem } from "../types";

type ReasoningItem = Extract<AgentThreadItem, { type: "reasoning" }>;

export function resolveVisibleReasoningSourceText(
  item: ReasoningItem,
  showRaw = false,
): string {
  if (showRaw) {
    const parts = [...(item.summary || []), ...(item.content || [])]
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return parts.join("\n\n");
  }
  const summaryText = (item.summary || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
  if (summaryText) {
    return summaryText;
  }

  const hasCanonicalRawContent = (item.content || []).some((part) =>
    Boolean(part.trim()),
  );
  return hasCanonicalRawContent ? "" : item.text.trim();
}
