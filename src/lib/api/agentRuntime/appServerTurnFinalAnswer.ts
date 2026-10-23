/** A terminal snapshot can recover a reply only after its last process item. */
export function completedTurnFinalAnswerText(
  turn: Record<string, unknown> | undefined,
): string | undefined {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  let unphasedText: string | undefined;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value: unknown = items[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (item.type === "userMessage") continue;
    if (item.type !== "agentMessage") break;
    const text =
      typeof item.text === "string" && item.text.trim() ? item.text : undefined;
    if (!text) continue;
    const phase =
      typeof item.phase === "string"
        ? item.phase.trim().toLowerCase()
        : item.phase;
    if (phase === "final_answer" || phase === "final") return text;
    if (
      (phase === undefined || phase === null || phase === "") &&
      unphasedText === undefined
    ) {
      unphasedText = text;
    }
  }
  return unphasedText;
}
