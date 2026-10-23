type ItemRoute = { threadId: string; turnId?: string };
type ItemState = { sequence: number; phase?: string };
type TurnState = { items: Map<string, ItemState>; nextSequence: number };

const turns = new Map<string, TurnState>();
const MAX_TURNS = 512;
const turnKey = (threadId: string, turnId: string) =>
  `${threadId}\u0000${turnId}`;

export function resetAppServerV2NotificationProjectionState(): void {
  turns.clear();
}

export function clearDirectItemSequenceTurn(
  threadId: string,
  turnId: string,
): void {
  turns.delete(turnKey(threadId, turnId));
}

export function directItemSequence(route: ItemRoute, itemId?: string): number {
  if (!route.turnId || !itemId) return 0;
  const key = turnKey(route.threadId, route.turnId);
  let state = turns.get(key);
  if (!state) {
    if (turns.size >= MAX_TURNS) {
      const oldest = turns.keys().next().value;
      if (oldest !== undefined) turns.delete(oldest);
    }
    state = { items: new Map(), nextSequence: 0 };
    turns.set(key, state);
  }
  const existing = state.items.get(itemId);
  if (existing) return existing.sequence;
  const sequence = state.nextSequence++;
  state.items.set(itemId, { sequence });
  return sequence;
}

export function noteDirectAgentMessagePhase(
  route: ItemRoute,
  itemId: string,
  phase: unknown,
): void {
  if (!route.turnId || typeof phase !== "string" || !phase.trim()) return;
  const item = turns
    .get(turnKey(route.threadId, route.turnId))
    ?.items.get(itemId);
  if (item) item.phase = phase;
}

export function directAgentMessagePhase(
  route: ItemRoute,
  itemId?: string,
): string | undefined {
  return route.turnId && itemId
    ? turns.get(turnKey(route.threadId, route.turnId))?.items.get(itemId)?.phase
    : undefined;
}
