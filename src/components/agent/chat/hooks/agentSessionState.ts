import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
  AgentRuntimeThreadReadModel,
  AsterTodoItem,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { normalizeQueuedTurnSnapshots } from "@/lib/api/queuedTurn";
import { resolveRestorableSessionId } from "@/lib/asterSessionRecovery";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import type { Topic } from "./agentChatShared";
import { normalizeLegacyThreadItems } from "@/lib/api/agentTextNormalization";
import {
  hydrateSessionDetailMessages,
  mergeHydratedMessagesWithLocalState,
  normalizeHistoricalTopicSnapshotMessages,
} from "./agentChatHistory";
import {
  filterConversationThreadItems,
  mergeThreadItems,
  mergeThreadTurns,
} from "../utils/threadTimelineView";
import { createExecutionRuntimeFromSessionDetail } from "../utils/sessionExecutionRuntime";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";

export interface AgentSessionSnapshot {
  sessionId: string | null;
  messages: Message[];
  threadTurns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
  currentTurnId: string | null;
  queuedTurns: QueuedTurnSnapshot[];
  threadRead: AgentRuntimeThreadReadModel | null;
  executionRuntime: AsterSessionExecutionRuntime | null;
  todoItems: AsterTodoItem[];
  childSubagentSessions: AsterSubagentSessionInfo[];
  subagentParentContext: AsterSubagentParentContext | null;
}

export function createEmptyAgentSessionSnapshot(options?: {
  executionRuntime?: AsterSessionExecutionRuntime | null;
}): AgentSessionSnapshot {
  return {
    sessionId: null,
    messages: [],
    threadTurns: [],
    threadItems: [],
    currentTurnId: null,
    queuedTurns: [],
    threadRead: null,
    executionRuntime: options?.executionRuntime ?? null,
    todoItems: [],
    childSubagentSessions: [],
    subagentParentContext: null,
  };
}

export function hasSessionHydrationActivity(options: {
  currentTurnId: string | null;
  threadTurnsCount: number;
  threadItemsCount: number;
  queuedTurnsCount: number;
}) {
  return (
    options.currentTurnId !== null ||
    options.threadTurnsCount > 0 ||
    options.threadItemsCount > 0 ||
    options.queuedTurnsCount > 0
  );
}

export function resolveRestorableTopicSessionId(
  candidateSessionId: string | null | undefined,
  topics: Topic[],
): string | null {
  const normalizedCandidate = candidateSessionId?.trim();
  if (topics.length === 0) {
    return normalizedCandidate ?? null;
  }

  return resolveRestorableSessionId({
    candidateSessionId: normalizedCandidate,
    sessions: topics.map((topic) => ({
      id: topic.id,
      createdAt: Math.floor(topic.createdAt.getTime() / 1000),
      updatedAt: Math.floor(topic.updatedAt.getTime() / 1000),
    })),
  });
}

interface BuildHydratedAgentSessionSnapshotOptions {
  topicId: string;
  detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>;
  currentSessionId: string | null;
  currentMessages: Message[];
  currentThreadTurns: AgentThreadTurn[];
  currentThreadItems: AgentThreadItem[];
  currentExecutionRuntime: AsterSessionExecutionRuntime | null;
  currentExecutionStrategy: AsterExecutionStrategy;
  topics: Topic[];
  localSnapshotOverride?: {
    sessionId: string;
    messages: Message[];
    threadTurns: AgentThreadTurn[];
    threadItems: AgentThreadItem[];
  } | null;
  syncSessionId?: boolean;
  executionStrategyOverride?: AsterExecutionStrategy;
  preserveExecutionStrategyOnMissingDetail?: boolean;
}

export function buildHydratedAgentSessionSnapshot(
  options: BuildHydratedAgentSessionSnapshotOptions,
): {
  executionStrategy: AsterExecutionStrategy;
  snapshot: AgentSessionSnapshot;
} {
  const {
    topicId,
    detail,
    currentSessionId,
    currentMessages,
    currentThreadTurns,
    currentThreadItems,
    currentExecutionRuntime,
    currentExecutionStrategy,
    topics,
    localSnapshotOverride,
    syncSessionId = false,
    executionStrategyOverride,
    preserveExecutionStrategyOnMissingDetail = false,
  } = options;
  const effectiveCurrentSessionId =
    localSnapshotOverride?.sessionId ?? currentSessionId;
  const effectiveCurrentMessages =
    localSnapshotOverride
      ? normalizeHistoricalTopicSnapshotMessages(localSnapshotOverride.messages)
      : currentMessages;
  const effectiveCurrentThreadTurns =
    localSnapshotOverride?.threadTurns ?? currentThreadTurns;
  const effectiveCurrentThreadItems =
    localSnapshotOverride?.threadItems ?? currentThreadItems;
  const hydratedMessages = hydrateSessionDetailMessages(detail, topicId);
  const incomingTurns = detail.turns || [];
  const incomingItems = normalizeLegacyThreadItems(detail.items || []);
  const hasRecoverableLocalSessionCache =
    effectiveCurrentSessionId === null &&
    syncSessionId &&
    (effectiveCurrentMessages.length > 0 ||
      effectiveCurrentThreadTurns.length > 0 ||
      effectiveCurrentThreadItems.length > 0);
  const shouldPreserveExistingTimeline =
    effectiveCurrentSessionId === topicId || hasRecoverableLocalSessionCache;
  const shouldPreserveExecutionRuntimeOnMissingDetail =
    shouldPreserveExistingTimeline;
  const nextExecutionRuntime = createExecutionRuntimeFromSessionDetail(detail);
  const selectedTopic = topics.find((topic) => topic.id === topicId);
  const nextExecutionStrategy =
    executionStrategyOverride ||
    detail.execution_strategy ||
    selectedTopic?.executionStrategy ||
    (preserveExecutionStrategyOnMissingDetail
      ? currentExecutionStrategy
      : null);
  const nextThreadTurns = shouldPreserveExistingTimeline
    ? mergeThreadTurns(effectiveCurrentThreadTurns, incomingTurns)
    : incomingTurns;
  const nextThreadItems = shouldPreserveExistingTimeline
    ? filterConversationThreadItems(
        mergeThreadItems(effectiveCurrentThreadItems, incomingItems),
      )
    : filterConversationThreadItems(incomingItems);

  return {
    executionStrategy: normalizeExecutionStrategy(nextExecutionStrategy),
    snapshot: {
      sessionId: syncSessionId ? topicId : currentSessionId,
      messages: shouldPreserveExistingTimeline
        ? mergeHydratedMessagesWithLocalState(
            effectiveCurrentMessages,
            hydratedMessages,
          )
        : hydratedMessages,
      threadTurns: nextThreadTurns,
      threadItems: nextThreadItems,
      currentTurnId:
        nextThreadTurns.length > 0
          ? nextThreadTurns[nextThreadTurns.length - 1]?.id || null
          : null,
      queuedTurns: normalizeQueuedTurnSnapshots(detail.queued_turns),
      threadRead: detail.thread_read ?? null,
      executionRuntime:
        shouldPreserveExecutionRuntimeOnMissingDetail && !nextExecutionRuntime
          ? currentExecutionRuntime
          : nextExecutionRuntime,
      todoItems: detail.todo_items ?? [],
      childSubagentSessions: detail.child_subagent_sessions ?? [],
      subagentParentContext: detail.subagent_parent_context ?? null,
    },
  };
}
