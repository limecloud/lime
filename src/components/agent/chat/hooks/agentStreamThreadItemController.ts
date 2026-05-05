import type {
  AgentThreadItem,
  AgentThreadTurn,
} from "@/lib/api/agentProtocol";

export function shouldDeferAgentStreamThreadItemUpdate(
  item: AgentThreadItem,
): boolean {
  return (
    item.status === "in_progress" &&
    (item.type === "reasoning" || item.type === "agent_message")
  );
}

export function buildAgentStreamTurnStartedPendingItemUpdate(params: {
  pendingItem?: AgentThreadItem | null;
  turn: AgentThreadTurn;
}): AgentThreadItem | null {
  if (!params.pendingItem) {
    return null;
  }

  return {
    ...params.pendingItem,
    thread_id: params.turn.thread_id,
    turn_id: params.turn.id,
    updated_at:
      params.turn.updated_at ||
      params.turn.started_at ||
      params.pendingItem.updated_at,
  };
}
