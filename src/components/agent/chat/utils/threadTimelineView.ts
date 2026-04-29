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

function isSortedBy<T>(items: T[], compare: (left: T, right: T) => number) {
  for (let index = 1; index < items.length; index += 1) {
    if (compare(items[index - 1]!, items[index]!) > 0) {
      return false;
    }
  }

  return true;
}

export function sortThreadItems(items: AgentThreadItem[]): AgentThreadItem[] {
  return [...filterConversationThreadItems(items)].sort(compareThreadItems);
}

function resolveSortedThreadTurns(turns: AgentThreadTurn[]): AgentThreadTurn[] {
  return isSortedBy(turns, compareThreadTurns)
    ? turns
    : [...turns].sort(compareThreadTurns);
}

function resolveTimelineThreadItems(
  items: AgentThreadItem[],
): AgentThreadItem[] {
  const hasHiddenItems = items.some(shouldHideConversationThreadItem);
  const visibleItems = hasHiddenItems
    ? filterConversationThreadItems(items)
    : items;

  return isSortedBy(visibleItems, compareThreadItems)
    ? visibleItems
    : [...visibleItems].sort(compareThreadItems);
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

interface AssistantTimelineEntry {
  message: Message;
  index: number;
  timestampMs: number | null;
}

interface TurnTimelineEntry {
  turn: AgentThreadTurn;
  startMs: number | null;
  targetMs: number | null;
}

function resolveAssistantDistance(
  assistant: AssistantTimelineEntry,
  targetMs: number | null,
): number {
  if (assistant.timestampMs === null || targetMs === null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(assistant.timestampMs - targetMs);
}

function pickPreferredAssistantMessage(
  current: AssistantTimelineEntry,
  candidate: AssistantTimelineEntry,
  targetMs: number | null,
): AssistantTimelineEntry {
  const currentDistance = resolveAssistantDistance(current, targetMs);
  const candidateDistance = resolveAssistantDistance(candidate, targetMs);

  if (candidateDistance < currentDistance) {
    return candidate;
  }

  if (candidateDistance !== currentDistance) {
    return current;
  }

  const candidateSubstantive = isSubstantiveAssistantMessage(
    candidate.message,
  );
  const currentSubstantive = isSubstantiveAssistantMessage(current.message);

  if (candidateSubstantive !== currentSubstantive) {
    return candidateSubstantive ? candidate : current;
  }

  const candidateTimestamp = candidate.timestampMs ?? Number.NEGATIVE_INFINITY;
  const currentTimestamp = current.timestampMs ?? Number.NEGATIVE_INFINITY;

  if (candidateTimestamp > currentTimestamp) {
    return candidate;
  }

  if (
    candidateTimestamp === currentTimestamp &&
    candidate.index > current.index
  ) {
    return candidate;
  }

  return current;
}

function pickClosestUnassignedAssistantMessage(
  assistants: AssistantTimelineEntry[],
  assignedMessageIds: Set<string>,
  targetMs: number | null,
  predicate: (assistant: AssistantTimelineEntry) => boolean,
): AssistantTimelineEntry | null {
  let best: AssistantTimelineEntry | null = null;

  for (const assistant of assistants) {
    if (
      assignedMessageIds.has(assistant.message.id) ||
      !predicate(assistant)
    ) {
      continue;
    }

    best = best
      ? pickPreferredAssistantMessage(best, assistant, targetMs)
      : assistant;
  }

  return best;
}

function pickLastUnassignedAssistantMessage(
  assistants: AssistantTimelineEntry[],
  assignedMessageIds: Set<string>,
): AssistantTimelineEntry | null {
  for (let index = assistants.length - 1; index >= 0; index -= 1) {
    const assistant = assistants[index];
    if (assistant && !assignedMessageIds.has(assistant.message.id)) {
      return assistant;
    }
  }

  return null;
}

export function buildMessageTurnTimeline(
  messages: Message[],
  turns: AgentThreadTurn[],
  items: AgentThreadItem[],
): Map<string, MessageTurnTimeline> {
  if (turns.length === 0) {
    return new Map();
  }

  const assistantEntries: AssistantTimelineEntry[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    assistantEntries.push({
      message,
      index: assistantEntries.length,
      timestampMs: resolveTimestampMs(message.timestamp),
    });
  }

  if (assistantEntries.length === 0) {
    return new Map();
  }

  const turnEntries: TurnTimelineEntry[] = resolveSortedThreadTurns(turns).map(
    (turn) => {
      const startMs = resolveTimestampMs(turn.started_at);
      return {
        turn,
        startMs,
        targetMs: resolveTimestampMs(turn.completed_at) ?? startMs,
      };
    },
  );

  const itemsByTurnId = new Map<string, AgentThreadItem[]>();
  for (const item of resolveTimelineThreadItems(items)) {
    const existing = itemsByTurnId.get(item.turn_id);
    if (existing) {
      existing.push(item);
    } else {
      itemsByTurnId.set(item.turn_id, [item]);
    }
  }

  const timelineByMessageId = new Map<string, MessageTurnTimeline>();
  const assignedMessageIds = new Set<string>();

  turnEntries.forEach((turnEntry, index) => {
    if (assignedMessageIds.size >= assistantEntries.length) {
      return;
    }

    const nextTurnStartMs =
      index < turnEntries.length - 1 ? turnEntries[index + 1]?.startMs : null;

    const assistantMessage =
      pickClosestUnassignedAssistantMessage(
        assistantEntries,
        assignedMessageIds,
        turnEntry.targetMs,
        (assistant) => {
          if (assistant.timestampMs === null) {
            return true;
          }
          if (
            turnEntry.startMs !== null &&
            assistant.timestampMs < turnEntry.startMs
          ) {
            return false;
          }
          if (
            nextTurnStartMs !== null &&
            assistant.timestampMs >= nextTurnStartMs
          ) {
            return false;
          }
          return true;
        },
      ) ||
      pickClosestUnassignedAssistantMessage(
        assistantEntries,
        assignedMessageIds,
        turnEntry.targetMs,
        (assistant) => {
          if (assistant.timestampMs === null || turnEntry.startMs === null) {
            return true;
          }
          return assistant.timestampMs >= turnEntry.startMs;
        },
      ) ||
      pickLastUnassignedAssistantMessage(assistantEntries, assignedMessageIds);

    if (!assistantMessage) {
      return;
    }

    assignedMessageIds.add(assistantMessage.message.id);
    timelineByMessageId.set(assistantMessage.message.id, {
      messageId: assistantMessage.message.id,
      turn: turnEntry.turn,
      items: itemsByTurnId.get(turnEntry.turn.id) || [],
    });
  });

  return timelineByMessageId;
}
