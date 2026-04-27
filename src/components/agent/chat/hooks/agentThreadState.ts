import type { AgentThreadItem, AgentThreadTurn } from "../types";

function areJsonLikeValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) =>
      areJsonLikeValuesEqual(item, right[index]),
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(rightRecord, key)
      ? areJsonLikeValuesEqual(leftRecord[key], rightRecord[key])
      : false,
  );
}

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

  const existingTurn = turns[existingIndex];
  if (areJsonLikeValuesEqual(existingTurn, nextTurn)) {
    return turns;
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

  const existingItem = items[existingIndex];
  if (areJsonLikeValuesEqual(existingItem, nextItem)) {
    return items;
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
  if (!turns.some((turn) => turn.id === turnId)) {
    return turns;
  }
  return turns.filter((turn) => turn.id !== turnId);
}

export function removeThreadItemState(
  items: AgentThreadItem[],
  itemId: string,
): AgentThreadItem[] {
  if (!items.some((item) => item.id === itemId)) {
    return items;
  }
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
