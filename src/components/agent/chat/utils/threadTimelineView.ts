import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";

const HIDDEN_CONVERSATION_WARNING_CODES = new Set([
  "artifact_document_repaired",
]);

export interface MessageTurnTimeline {
  messageId: string;
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
}

export function compareThreadTurns(
  left: AgentThreadTurn,
  right: AgentThreadTurn,
): number {
  if (left.started_at !== right.started_at) {
    return left.started_at.localeCompare(right.started_at);
  }
  return left.id.localeCompare(right.id);
}

export function compareThreadItems(
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

function normalizeThreadWarningCode(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function shouldHideConversationThreadItem(item: AgentThreadItem): boolean {
  if (item.type !== "warning") {
    return false;
  }

  const normalizedCode = normalizeThreadWarningCode(item.code);
  return (
    normalizedCode !== null &&
    HIDDEN_CONVERSATION_WARNING_CODES.has(normalizedCode)
  );
}

export function filterConversationThreadItems(
  items: AgentThreadItem[],
): AgentThreadItem[] {
  return items.filter((item) => !shouldHideConversationThreadItem(item));
}

export function sortThreadItems(items: AgentThreadItem[]): AgentThreadItem[] {
  return [...filterConversationThreadItems(items)].sort(compareThreadItems);
}

export function mergeThreadTurns(
  ...turnGroups: Array<AgentThreadTurn[] | undefined>
): AgentThreadTurn[] {
  const merged = new Map<string, AgentThreadTurn>();

  for (const turns of turnGroups) {
    if (!Array.isArray(turns)) {
      continue;
    }

    for (const turn of turns) {
      merged.set(turn.id, turn);
    }
  }

  return [...merged.values()].sort(compareThreadTurns);
}

export function mergeThreadItems(
  ...itemGroups: Array<AgentThreadItem[] | undefined>
): AgentThreadItem[] {
  const merged = new Map<string, AgentThreadItem>();

  for (const items of itemGroups) {
    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      if (shouldHideConversationThreadItem(item)) {
        continue;
      }
      merged.set(item.id, item);
    }
  }

  return sortThreadItems(Array.from(merged.values()));
}

function resolveTimestampMs(value?: string | Date | null): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isSubstantiveAssistantMessage(message: Message): boolean {
  if (message.content.trim().length > 0) {
    return true;
  }

  if (Array.isArray(message.images) && message.images.length > 0) {
    return true;
  }

  if (
    !Array.isArray(message.contentParts) ||
    message.contentParts.length === 0
  ) {
    return false;
  }

  return message.contentParts.some((part) => {
    if (part.type === "text" || part.type === "thinking") {
      return part.text.trim().length > 0;
    }

    return part.type === "tool_use";
  });
}

function pickClosestAssistantMessage(
  assistants: Array<{
    message: Message;
    index: number;
    timestampMs: number | null;
  }>,
  targetMs: number | null,
) {
  if (assistants.length === 0) {
    return null;
  }

  if (targetMs === null) {
    return assistants[assistants.length - 1] || null;
  }

  let best = assistants[0] || null;
  if (!best) {
    return null;
  }

  let bestDistance =
    best.timestampMs === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(best.timestampMs - targetMs);

  for (const assistant of assistants.slice(1)) {
    const distance =
      assistant.timestampMs === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(assistant.timestampMs - targetMs);

    if (distance < bestDistance) {
      best = assistant;
      bestDistance = distance;
      continue;
    }

    if (distance !== bestDistance) {
      continue;
    }

    const assistantSubstantive = isSubstantiveAssistantMessage(
      assistant.message,
    );
    const bestSubstantive = isSubstantiveAssistantMessage(best.message);

    if (assistantSubstantive !== bestSubstantive) {
      if (assistantSubstantive) {
        best = assistant;
        bestDistance = distance;
      }
      continue;
    }

    if (
      (assistant.timestampMs ?? Number.NEGATIVE_INFINITY) >
      (best.timestampMs ?? Number.NEGATIVE_INFINITY)
    ) {
      best = assistant;
      bestDistance = distance;
      continue;
    }

    if (
      (assistant.timestampMs ?? Number.NEGATIVE_INFINITY) ===
        (best.timestampMs ?? Number.NEGATIVE_INFINITY) &&
      assistant.index > best.index
    ) {
      best = assistant;
      bestDistance = distance;
    }
  }

  return best;
}

export function buildMessageTurnTimeline(
  messages: Message[],
  turns: AgentThreadTurn[],
  items: AgentThreadItem[],
): Map<string, MessageTurnTimeline> {
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  );
  if (assistantMessages.length === 0 || turns.length === 0) {
    return new Map();
  }

  const sortedTurns = [...turns].sort(compareThreadTurns);
  const assistantEntries = assistantMessages.map((message, index) => ({
    message,
    index,
    timestampMs: resolveTimestampMs(message.timestamp),
  }));

  const itemsByTurnId = new Map<string, AgentThreadItem[]>();
  for (const item of sortThreadItems(items)) {
    const existing = itemsByTurnId.get(item.turn_id);
    if (existing) {
      existing.push(item);
    } else {
      itemsByTurnId.set(item.turn_id, [item]);
    }
  }

  const timelineByMessageId = new Map<string, MessageTurnTimeline>();
  const assignedMessageIds = new Set<string>();

  sortedTurns.forEach((turn, index) => {
    const unassignedAssistants = assistantEntries.filter(
      (assistant) => !assignedMessageIds.has(assistant.message.id),
    );
    if (unassignedAssistants.length === 0) {
      return;
    }

    const turnStartMs = resolveTimestampMs(turn.started_at);
    const turnTargetMs = resolveTimestampMs(turn.completed_at) ?? turnStartMs;
    const nextTurnStartMs =
      index < sortedTurns.length - 1
        ? resolveTimestampMs(sortedTurns[index + 1]?.started_at)
        : null;

    const assistantsInTurnWindow = unassignedAssistants.filter((assistant) => {
      if (assistant.timestampMs === null) {
        return true;
      }
      if (turnStartMs !== null && assistant.timestampMs < turnStartMs) {
        return false;
      }
      if (
        nextTurnStartMs !== null &&
        assistant.timestampMs >= nextTurnStartMs
      ) {
        return false;
      }
      return true;
    });

    const assistantsAfterTurnStart = unassignedAssistants.filter(
      (assistant) => {
        if (assistant.timestampMs === null || turnStartMs === null) {
          return true;
        }
        return assistant.timestampMs >= turnStartMs;
      },
    );

    const assistantMessage =
      pickClosestAssistantMessage(assistantsInTurnWindow, turnTargetMs) ||
      pickClosestAssistantMessage(assistantsAfterTurnStart, turnTargetMs) ||
      unassignedAssistants[unassignedAssistants.length - 1] ||
      null;

    if (!assistantMessage) {
      return;
    }

    assignedMessageIds.add(assistantMessage.message.id);
    timelineByMessageId.set(assistantMessage.message.id, {
      messageId: assistantMessage.message.id,
      turn,
      items: itemsByTurnId.get(turn.id) || [],
    });
  });

  return timelineByMessageId;
}
