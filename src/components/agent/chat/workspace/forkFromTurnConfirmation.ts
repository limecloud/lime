/** Codex asks before forking from a non-latest turn; latest-turn forks stay one click. */
export function requiresForkConfirmation({
  latestTurnId,
  turnId,
}: {
  latestTurnId: string | null | undefined;
  turnId: string;
}): boolean {
  const latest = latestTurnId?.trim() || "";
  const target = turnId.trim();
  return Boolean(latest && target && latest !== target);
}
