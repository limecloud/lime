import type { AgentThreadItem, AgentThreadTurn } from "../types";

function compareItemOrder(
  left: AgentThreadItem,
  right: AgentThreadItem,
): number {
  if (left.started_at !== right.started_at) {
    return left.started_at.localeCompare(right.started_at);
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.id.localeCompare(right.id);
}

export function upsertThreadTurnState(
  turns: AgentThreadTurn[],
  nextTurn: AgentThreadTurn,
): AgentThreadTurn[] {
  const existingIndex = turns.findIndex((turn) => turn.id === nextTurn.id);
  if (existingIndex < 0) {
    return [...turns, nextTurn].sort((left, right) =>
      left.started_at.localeCompare(right.started_at),
    );
  }

  return turns.map((turn) => (turn.id === nextTurn.id ? nextTurn : turn));
}

export function upsertThreadItemState(
  items: AgentThreadItem[],
  nextItem: AgentThreadItem,
): AgentThreadItem[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex < 0) {
    return [...items, nextItem].sort(compareItemOrder);
  }

  const nextItems = items.map((item) =>
    item.id === nextItem.id ? nextItem : item,
  );
  nextItems.sort(compareItemOrder);
  return nextItems;
}

export function removeThreadTurnState(
  turns: AgentThreadTurn[],
  turnId: string,
): AgentThreadTurn[] {
  return turns.filter((turn) => turn.id !== turnId);
}

export function removeThreadItemState(
  items: AgentThreadItem[],
  itemId: string,
): AgentThreadItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function markThreadActionItemSubmitted(
  items: AgentThreadItem[],
  requestIds: Set<string>,
  response?: string,
  userData?: unknown,
): AgentThreadItem[] {
  const normalizedResponse = response?.trim();

  return items.map((item) => {
    if (
      (item.type !== "approval_request" &&
        item.type !== "request_user_input") ||
      !requestIds.has(item.request_id)
    ) {
      return item;
    }

    const nextResponse = userData ?? normalizedResponse ?? item.response;
    return {
      ...item,
      status: "completed",
      completed_at: item.completed_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      response: nextResponse,
    };
  });
}
