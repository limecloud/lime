import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
  AgentRuntimeThreadReadModel,
  AsterTodoItem,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { logAgentDebug } from "@/lib/agentDebug";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import { normalizeLegacyThreadItems } from "@/lib/api/agentTextNormalization";
import { isAsterSessionNotFoundError } from "@/lib/asterSessionRecovery";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  mapSessionToTopic,
  type ClearMessagesOptions,
  type SessionModelPreference,
  type Topic,
} from "./agentChatShared";
import {
  loadStoredSessionWorkspaceIdRaw,
  savePersistedSessionWorkspaceId,
} from "./agentProjectStorage";
import {
  hydrateSessionDetailMessages,
  normalizeHistoryMessages,
  shouldCompactCompletedSessionHistory,
} from "./agentChatHistory";
import {
  getAgentSessionScopedKeys,
  loadAgentSessionCachedSnapshot,
  saveAgentSessionCachedSnapshot,
} from "./agentSessionScopedStorage";
import {
  getExecutionStrategyStorageKey,
  loadPersisted,
  loadPersistedString,
  resolvePersistedAccessMode,
  resolvePersistedExecutionStrategy,
  loadTransient,
  savePersisted,
  saveTransient,
} from "./agentChatStorage";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { isAuxiliaryAgentSessionId } from "@/lib/api/agentRuntime/sessionIdentity";
import {
  filterConversationThreadItems,
} from "../utils/threadTimelineView";
import { shouldResumeTaskSession } from "../utils/taskCenterTabs";
import {
  createSessionAccessModeFromExecutionRuntime,
  createSessionModelPreferenceFromExecutionRuntime,
} from "../utils/sessionExecutionRuntime";
import {
  isLegacyDefaultProjectId,
  normalizeProjectId,
} from "../utils/topicProjectResolution";
import {
  buildHydratedAgentSessionSnapshot,
  createEmptyAgentSessionSnapshot,
  hasSessionHydrationActivity,
  resolveRestorableTopicSessionId,
  shouldDeferSessionDetailHydration,
  type AgentSessionSnapshot,
} from "./agentSessionState";
import {
  buildPendingSessionShellMetricContext,
  buildSessionSwitchDeferHydrationMetricContext,
  buildSessionSwitchLocalSnapshotOverride,
  buildSessionSwitchStartMetricContext,
  shouldApplyCachedTopicSnapshot,
  shouldApplyPendingSessionShell,
  shouldLoadCachedTopicSnapshot,
  shouldRefreshCachedSnapshotImmediately as resolveShouldRefreshCachedSnapshotImmediately,
} from "./sessionSwitchSnapshotController";
import {
  buildSessionMetadataSyncPlan,
  buildSessionSwitchSuccessMetricContext,
  resolveSessionExecutionStrategySource,
} from "./sessionMetadataSyncController";
import { scheduleSessionMetadataSync } from "./sessionMetadataSyncScheduler";
import {
  buildSessionWorkspaceRestorePlan,
  resolveSessionExecutionStrategyOverride,
  resolveShadowSessionExecutionStrategyFallback,
} from "./sessionFinalizeController";
import { buildSessionPostFinalizePersistencePlan } from "./sessionPostFinalizePersistenceController";
import {
  refreshAgentSessionDetailState,
  refreshAgentSessionReadModelState,
} from "./agentSessionRefresh";
import type { AgentAccessMode } from "./agentChatStorage";
import { hasRecoverableSilentTurnActivity } from "./agentSilentTurnRecovery";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import {
  buildSessionDetailHydrationOptions,
  buildSessionDetailPrefetchKey,
  buildSessionDetailPrefetchSignature,
  isCurrentSessionHydrationRequest,
} from "./sessionHydrationController";
import {
  buildSessionHistoryPageRequestPlan,
  buildSessionHistoryPageResultPlan,
  resolveSessionHistoryWindowFromDetail,
  type SessionHistoryWindowState,
} from "./sessionHistoryPaginationController";
import { buildSessionHistoryMergePlan } from "./sessionHistoryMergeController";
import {
  createSessionDetailPrefetchRegistry,
  loadSessionDetailWithPrefetch,
  type SessionDetailFetchEvent,
} from "./sessionDetailFetchController";
import { resolveDeferredSessionHydrationErrorAction } from "./sessionHydrationRetryController";
import { resolveSessionSwitchErrorAction } from "./sessionSwitchErrorController";

const INITIAL_TOPICS_IDLE_TIMEOUT_MS = 1_500;
const INITIAL_TOPICS_SESSION_REQUEST_LIMIT = 21;
const SESSION_HISTORY_LOAD_PAGE_SIZE = 50;
const ACTIVE_SESSION_TRANSIENT_MESSAGES_LIMIT = 48;
const ACTIVE_SESSION_TRANSIENT_TURNS_LIMIT = 48;
const ACTIVE_SESSION_TRANSIENT_ITEMS_LIMIT = 160;
const ACTIVE_SESSION_TRANSIENT_SAVE_DELAY_MS = 180;
const ACTIVE_SESSION_TRANSIENT_SAVE_IDLE_TIMEOUT_MS = 1_800;
const SESSION_METADATA_SYNC_DELAY_MS = 8_000;
const SESSION_METADATA_SYNC_IDLE_TIMEOUT_MS = 15_000;
const FRESH_SESSION_POST_CREATE_PERSISTENCE_IDLE_TIMEOUT_MS = 1_000;
const SESSION_DETAIL_PREFETCH_RECENT_LIMIT = 1;
const SESSION_DETAIL_PREFETCH_DELAY_MS = 5_000;
const SESSION_DETAIL_PREFETCH_IDLE_TIMEOUT_MS = 8_000;
const SESSION_DETAIL_DEFERRED_HYDRATION_DELAY_MS = 1_200;
const SESSION_DETAIL_DEFERRED_HYDRATION_RETRY_DELAY_MS = 15_000;
const SESSION_DETAIL_DEFERRED_HYDRATION_MAX_RETRY = 1;

type AgentSessionRuntimeDetail = Awaited<
  ReturnType<AgentRuntimeAdapter["getSession"]>
>;

const sessionDetailPrefetchRegistry =
  createSessionDetailPrefetchRegistry<AgentSessionRuntimeDetail>();

function mapSessionDetailToTopic(
  sessionId: string,
  detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
  fallbackWorkspaceId: string | null,
): Topic {
  return mapSessionToTopic({
    id: sessionId,
    name: detail.name,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    model: detail.model,
    messages_count: detail.messages_count ?? detail.messages.length,
    execution_strategy: detail.execution_strategy,
    workspace_id: detail.workspace_id ?? fallbackWorkspaceId ?? undefined,
    working_dir: detail.working_dir,
  });
}

function upsertTopicFromSessionDetail(
  topics: Topic[],
  detailTopic: Topic,
): Topic[] {
  const existingTopic = topics.find((topic) => topic.id === detailTopic.id);
  const mergedTopic = existingTopic
    ? {
        ...detailTopic,
        isPinned: existingTopic.isPinned,
        hasUnread: existingTopic.hasUnread,
        tag: existingTopic.tag,
      }
    : detailTopic;
  const nextTopics = existingTopic
    ? topics.map((topic) => (topic.id === detailTopic.id ? mergedTopic : topic))
    : [mergedTopic, ...topics];

  return nextTopics.sort((left, right) => {
    const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    const createdDiff = right.createdAt.getTime() - left.createdAt.getTime();
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

export type AgentSessionHistoryWindow = SessionHistoryWindowState;

function takeTail<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) {
    return items;
  }

  return items.slice(-limit);
}

function selectActiveSessionTransientTurns(
  turns: AgentThreadTurn[],
): AgentThreadTurn[] {
  return takeTail(turns, ACTIVE_SESSION_TRANSIENT_TURNS_LIMIT);
}

function selectActiveSessionTransientMessages(messages: Message[]): Message[] {
  return takeTail(messages, ACTIVE_SESSION_TRANSIENT_MESSAGES_LIMIT);
}

function selectActiveSessionTransientItems(
  items: AgentThreadItem[],
  turns: AgentThreadTurn[],
): AgentThreadItem[] {
  const retainedTurnIds = new Set(
    selectActiveSessionTransientTurns(turns)
      .map((turn) => (typeof turn.id === "string" ? turn.id.trim() : ""))
      .filter(Boolean),
  );
  if (retainedTurnIds.size === 0) {
    return filterConversationThreadItems(
      normalizeLegacyThreadItems(
        takeTail(items, ACTIVE_SESSION_TRANSIENT_ITEMS_LIMIT),
      ),
    );
  }

  const scopedItems: AgentThreadItem[] = [];
  for (
    let index = items.length - 1;
    index >= 0 && scopedItems.length < ACTIVE_SESSION_TRANSIENT_ITEMS_LIMIT;
    index -= 1
  ) {
    const item = items[index];
    if (!item) {
      continue;
    }

    const turnId = typeof item.turn_id === "string" ? item.turn_id.trim() : "";
    if (!turnId || retainedTurnIds.has(turnId)) {
      scopedItems.push(item);
    }
  }
  scopedItems.reverse();

  return filterConversationThreadItems(normalizeLegacyThreadItems(scopedItems));
}

function scheduleActiveSessionTransientSave(task: () => void): () => void {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  let cancelled = false;
  let idleId: number | null = null;
  const delayId = window.setTimeout(() => {
    if (cancelled) {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) {
            task();
          }
        },
        { timeout: ACTIVE_SESSION_TRANSIENT_SAVE_IDLE_TIMEOUT_MS },
      );
      return;
    }

    task();
  }, ACTIVE_SESSION_TRANSIENT_SAVE_DELAY_MS);

  return () => {
    cancelled = true;
    window.clearTimeout(delayId);
    if (idleId !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
  };
}

function scheduleFreshSessionPostCreatePersistence(task: () => void): void {
  scheduleMinimumDelayIdleTask(task, {
    idleTimeoutMs: FRESH_SESSION_POST_CREATE_PERSISTENCE_IDLE_TIMEOUT_MS,
  });
}

interface UseAgentSessionOptions {
  runtime: AgentRuntimeAdapter;
  workspaceId: string;
  disableSessionRestore: boolean;
  initialTopicsLoadMode: "immediate" | "deferred";
  initialTopicsDeferredDelayMs?: number;
  preserveRestoredMessages: boolean;
  executionStrategy: AsterExecutionStrategy;
  accessMode: AgentAccessMode;
  providerTypeRef: MutableRefObject<string>;
  modelRef: MutableRefObject<string>;
  sessionIdRef: MutableRefObject<string | null>;
  currentAssistantMsgIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  resetPendingActions: () => void;
  persistSessionModelPreference: (
    sessionId: string,
    providerType: string,
    model: string,
  ) => void;
  loadSessionModelPreference: (
    sessionId: string,
  ) => SessionModelPreference | null;
  applySessionModelPreference: (
    sessionId: string,
    preference: SessionModelPreference,
  ) => void;
  markSessionModelPreferenceSynced: (
    sessionId: string,
    providerType: string,
    model: string,
  ) => void;
  markSessionExecutionStrategySynced: (
    sessionId: string,
    executionStrategy: AsterExecutionStrategy,
  ) => void;
  persistSessionAccessMode: (
    sessionId: string,
    accessMode: AgentAccessMode,
  ) => void;
  loadSessionAccessMode: (sessionId: string) => AgentAccessMode | null;
  filterSessionsByWorkspace: <T extends { id: string }>(sessions: T[]) => T[];
  setExecutionStrategyState: (
    executionStrategy: AsterExecutionStrategy,
  ) => void;
  setAccessModeState: (accessMode: AgentAccessMode) => void;
}

export function useAgentSession(options: UseAgentSessionOptions) {
  const {
    runtime,
    workspaceId,
    disableSessionRestore,
    initialTopicsLoadMode,
    initialTopicsDeferredDelayMs,
    preserveRestoredMessages,
    executionStrategy,
    accessMode,
    providerTypeRef,
    modelRef,
    sessionIdRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    resetPendingActions,
    persistSessionModelPreference,
    loadSessionModelPreference,
    applySessionModelPreference,
    markSessionModelPreferenceSynced,
    markSessionExecutionStrategySynced,
    persistSessionAccessMode,
    loadSessionAccessMode,
    filterSessionsByWorkspace,
    setExecutionStrategyState,
    setAccessModeState,
  } = options;
  const scopedKeys = useMemo(
    () => getAgentSessionScopedKeys(workspaceId),
    [workspaceId],
  );
  const sanitizeRestoreCandidateSessionId = useCallback(
    (candidateSessionId: string | null | undefined): string | null => {
      const normalizedCandidate = candidateSessionId?.trim();
      if (!normalizedCandidate) {
        return null;
      }

      if (isAuxiliaryAgentSessionId(normalizedCandidate)) {
        logAgentDebug("useAgentSession", "restoreCandidate.skipAuxiliary", {
          candidateSessionId: normalizedCandidate,
          workspaceId: normalizeProjectId(workspaceId),
        });
        return null;
      }

      const resolvedWorkspaceId = normalizeProjectId(workspaceId);
      const mappedWorkspaceId =
        loadStoredSessionWorkspaceIdRaw(normalizedCandidate);
      if (!mappedWorkspaceId) {
        return normalizedCandidate;
      }

      if (isLegacyDefaultProjectId(mappedWorkspaceId)) {
        logAgentDebug("useAgentSession", "restoreCandidate.rejected", {
          candidateSessionId: normalizedCandidate,
          mappedWorkspaceId,
          workspaceId: resolvedWorkspaceId,
        });
        return null;
      }

      const normalizedMappedWorkspaceId = normalizeProjectId(mappedWorkspaceId);
      if (!normalizedMappedWorkspaceId) {
        return normalizedCandidate;
      }

      if (
        resolvedWorkspaceId &&
        normalizedMappedWorkspaceId !== resolvedWorkspaceId
      ) {
        logAgentDebug("useAgentSession", "restoreCandidate.rejected", {
          candidateSessionId: normalizedCandidate,
          mappedWorkspaceId,
          workspaceId: resolvedWorkspaceId,
        });
        return null;
      }

      return normalizedCandidate;
    },
    [workspaceId],
  );

  const loadScopedSessionRestoreCandidate = useCallback(() => {
    if (disableSessionRestore || !workspaceId?.trim()) {
      return null;
    }

    return sanitizeRestoreCandidateSessionId(
      loadTransient<string | null>(scopedKeys.currentSessionKey, null) ??
        loadPersisted<string | null>(scopedKeys.persistedSessionKey, null),
    );
  }, [
    disableSessionRestore,
    sanitizeRestoreCandidateSessionId,
    scopedKeys,
    workspaceId,
  ]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : loadTransient<Message[]>(scopedKeys.messagesKey, []),
  );
  const [threadTurns, setThreadTurns] = useState<AgentThreadTurn[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : loadTransient<AgentThreadTurn[]>(scopedKeys.turnsKey, []),
  );
  const [threadItems, setThreadItems] = useState<AgentThreadItem[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : filterConversationThreadItems(
          normalizeLegacyThreadItems(
            loadTransient<AgentThreadItem[]>(scopedKeys.itemsKey, []),
          ),
        ),
  );
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? null
      : loadTransient<string | null>(scopedKeys.currentTurnKey, null),
  );
  const [queuedTurns, setQueuedTurns] = useState<QueuedTurnSnapshot[]>([]);
  const [threadRead, setThreadRead] =
    useState<AgentRuntimeThreadReadModel | null>(null);
  const [executionRuntime, setExecutionRuntime] =
    useState<AsterSessionExecutionRuntime | null>(null);
  const [todoItems, setTodoItems] = useState<AsterTodoItem[]>([]);
  const [childSubagentSessions, setChildSubagentSessions] = useState<
    AsterSubagentSessionInfo[]
  >([]);
  const [subagentParentContext, setSubagentParentContext] =
    useState<AsterSubagentParentContext | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsReady, setTopicsReady] = useState(false);
  const [sessionHistoryWindow, setSessionHistoryWindow] =
    useState<AgentSessionHistoryWindow | null>(null);
  const [isAutoRestoringSession, setIsAutoRestoringSession] = useState(
    () => !disableSessionRestore && Boolean(workspaceId?.trim()),
  );
  const [isSessionHydrating, setIsSessionHydrating] = useState(false);

  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);
  const sessionSwitchRequestVersionRef = useRef(0);
  const activeSessionSwitchRef = useRef<{
    topicId: string;
    promise: Promise<void>;
  } | null>(null);
  const deferredSessionHydrationCancelRef = useRef<(() => void) | null>(null);
  const pendingSessionMetadataSyncCancelRef = useRef<(() => void) | null>(null);
  const createFreshSessionPromiseRef = useRef<Promise<string | null> | null>(
    null,
  );
  const missingSessionVerificationRef = useRef<string | null>(null);
  const detachedSessionIdRef = useRef<string | null>(null);
  const topicsListMayBeTruncatedRef = useRef(false);
  const sessionStateWorkspaceRef = useRef<string | null>(
    workspaceId?.trim() || null,
  );
  const messagesRef = useRef<Message[]>(messages);
  const threadTurnsRef = useRef<AgentThreadTurn[]>(threadTurns);
  const threadItemsRef = useRef<AgentThreadItem[]>(threadItems);
  const sessionHistoryWindowRef = useRef<AgentSessionHistoryWindow | null>(
    sessionHistoryWindow,
  );
  const executionRuntimeRef = useRef<AsterSessionExecutionRuntime | null>(
    executionRuntime,
  );
  const restoreCandidateSessionIdRef = useRef<string | null>(
    loadScopedSessionRestoreCandidate(),
  );

  sessionIdRef.current = sessionId;

  useEffect(() => {
    return () => {
      pendingSessionMetadataSyncCancelRef.current?.();
      pendingSessionMetadataSyncCancelRef.current = null;
    };
  }, []);

  const resetStreamingRefs = useCallback(() => {
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
  }, [currentAssistantMsgIdRef, currentStreamingSessionIdRef]);
  const setMessagesState = useCallback<Dispatch<SetStateAction<Message[]>>>(
    (value) => {
      const nextMessages =
        typeof value === "function"
          ? (value as (previous: Message[]) => Message[])(messagesRef.current)
          : value;
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    },
    [],
  );

  const persistSessionRestoreCandidate = useCallback(
    (nextSessionId: string | null) => {
      const sanitizedSessionId =
        nextSessionId && isAuxiliaryAgentSessionId(nextSessionId)
          ? null
          : nextSessionId;
      restoreCandidateSessionIdRef.current = sanitizedSessionId;
      saveTransient(scopedKeys.currentSessionKey, sanitizedSessionId);
      savePersisted(scopedKeys.persistedSessionKey, sanitizedSessionId);
    },
    [scopedKeys],
  );

  const invalidatePendingSessionSwitches = useCallback(() => {
    deferredSessionHydrationCancelRef.current?.();
    deferredSessionHydrationCancelRef.current = null;
    pendingSessionMetadataSyncCancelRef.current?.();
    pendingSessionMetadataSyncCancelRef.current = null;
    sessionSwitchRequestVersionRef.current += 1;
    return sessionSwitchRequestVersionRef.current;
  }, []);

  const listWorkspaceTopics = useCallback(async () => {
    const sessions = await runtime.listSessions({
      workspaceId,
      limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
    });
    const workspaceSessions = filterSessionsByWorkspace(sessions);
    const visibleSessions = workspaceSessions.filter(
      (session) => !isAuxiliaryAgentSessionId(session.id),
    );

    return {
      sessions,
      workspaceSessions,
      visibleSessions,
      topicList: visibleSessions.map(mapSessionToTopic),
    };
  }, [filterSessionsByWorkspace, runtime, workspaceId]);

  const applySessionSnapshot = useCallback(
    (snapshot: AgentSessionSnapshot) => {
      sessionIdRef.current = snapshot.sessionId;
      messagesRef.current = snapshot.messages;
      threadTurnsRef.current = snapshot.threadTurns;
      threadItemsRef.current = snapshot.threadItems;
      executionRuntimeRef.current = snapshot.executionRuntime;
      setSessionId(snapshot.sessionId);
      setMessages(snapshot.messages);
      setThreadTurns(snapshot.threadTurns);
      setThreadItems(snapshot.threadItems);
      setCurrentTurnId(snapshot.currentTurnId);
      setQueuedTurns(snapshot.queuedTurns);
      setThreadRead(snapshot.threadRead);
      setExecutionRuntime(snapshot.executionRuntime);
      setTodoItems(snapshot.todoItems);
      setChildSubagentSessions(snapshot.childSubagentSessions);
      setSubagentParentContext(snapshot.subagentParentContext);
    },
    [sessionIdRef],
  );

  const applyReadModelSnapshot = useCallback(
    (snapshot: {
      queuedTurns: QueuedTurnSnapshot[];
      threadRead: AgentRuntimeThreadReadModel | null;
    }) => {
      setQueuedTurns(snapshot.queuedTurns);
      setThreadRead(snapshot.threadRead);
    },
    [],
  );

  const resolveSessionHistoryWindow = useCallback(
    (
      detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
    ): AgentSessionHistoryWindow | null => {
      return resolveSessionHistoryWindowFromDetail(detail);
    },
    [],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionHistoryWindowRef.current = sessionHistoryWindow;
  }, [sessionHistoryWindow]);

  useEffect(() => {
    setMessages((prev) => {
      const normalized = normalizeHistoryMessages(prev);
      return normalized.length === prev.length ? prev : normalized;
    });
  }, [sessionId, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }

    persistSessionRestoreCandidate(
      sessionId ?? restoreCandidateSessionIdRef.current,
    );

    if (sessionId) {
      const sessionWorkspaceKey = `agent_session_workspace_${sessionId}`;
      const existingWorkspaceId = loadPersistedString(sessionWorkspaceKey);
      if (
        existingWorkspaceId &&
        existingWorkspaceId !== "__invalid__" &&
        !isLegacyDefaultProjectId(existingWorkspaceId) &&
        existingWorkspaceId !== resolvedWorkspaceId
      ) {
        console.warn("[AsterChat] 检测到会话与工作区映射冲突，跳过覆盖", {
          sessionId,
          existingWorkspaceId,
          currentWorkspaceId: resolvedWorkspaceId,
        });
      } else {
        savePersistedSessionWorkspaceId(sessionId, resolvedWorkspaceId);
      }
    }
  }, [persistSessionRestoreCandidate, sessionId, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }
    const transientMessages = selectActiveSessionTransientMessages(messages);
    return scheduleActiveSessionTransientSave(() => {
      saveTransient(scopedKeys.messagesKey, transientMessages);
    });
  }, [messages, scopedKeys, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }
    const transientTurns = selectActiveSessionTransientTurns(threadTurns);
    return scheduleActiveSessionTransientSave(() => {
      saveTransient(scopedKeys.turnsKey, transientTurns);
    });
  }, [scopedKeys, threadTurns, workspaceId]);

  useEffect(() => {
    threadTurnsRef.current = threadTurns;
  }, [threadTurns]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }
    const transientItems = selectActiveSessionTransientItems(
      threadItems,
      threadTurnsRef.current,
    );
    return scheduleActiveSessionTransientSave(() => {
      saveTransient(scopedKeys.itemsKey, transientItems);
    });
  }, [scopedKeys, threadItems, threadTurns, workspaceId]);

  useEffect(() => {
    threadItemsRef.current = threadItems;
  }, [threadItems]);

  useEffect(() => {
    executionRuntimeRef.current = executionRuntime;
  }, [executionRuntime]);

  useEffect(
    () => () => {
      deferredSessionHydrationCancelRef.current?.();
      deferredSessionHydrationCancelRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }
    saveTransient(scopedKeys.currentTurnKey, currentTurnId);
  }, [currentTurnId, scopedKeys, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    const resolvedSessionId = sessionId?.trim();
    if (
      !resolvedWorkspaceId ||
      !resolvedSessionId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }

    const activeTopic = topics.find((topic) => topic.id === resolvedSessionId);
    const totalMessages =
      sessionHistoryWindow?.totalMessages ??
      activeTopic?.messagesCount ??
      messages.length;
    const transientMessages = selectActiveSessionTransientMessages(messages);
    const transientThreadTurns = selectActiveSessionTransientTurns(threadTurns);
    const transientTurnIds = new Set(
      transientThreadTurns
        .map((turn) => (typeof turn.id === "string" ? turn.id.trim() : ""))
        .filter(Boolean),
    );
    const transientCurrentTurnId =
      currentTurnId && transientTurnIds.has(currentTurnId)
        ? currentTurnId
        : null;
    const transientThreadItems = selectActiveSessionTransientItems(
      threadItems,
      transientThreadTurns,
    );
    return scheduleActiveSessionTransientSave(() => {
      saveAgentSessionCachedSnapshot(
        resolvedWorkspaceId,
        resolvedSessionId,
        {
          messages: transientMessages,
          threadTurns: transientThreadTurns,
          threadItems: transientThreadItems,
          currentTurnId: transientCurrentTurnId,
        },
        {
          sessionUpdatedAt: activeTopic?.updatedAt ?? Date.now(),
          messagesCount: totalMessages,
          historyTruncated:
            (sessionHistoryWindow?.totalMessages ?? totalMessages) >
            (sessionHistoryWindow?.loadedMessages ?? messages.length),
        },
      );
    });
  }, [
    currentTurnId,
    messages,
    sessionId,
    sessionHistoryWindow,
    threadItems,
    threadTurns,
    topics,
    workspaceId,
  ]);

  useEffect(() => {
    if (disableSessionRestore || !workspaceId?.trim()) {
      sessionStateWorkspaceRef.current = null;
      applySessionSnapshot(createEmptyAgentSessionSnapshot());
      setSessionHistoryWindow(null);
      setIsAutoRestoringSession(false);
      setIsSessionHydrating(false);
      resetPendingActions();
      resetStreamingRefs();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      restoreCandidateSessionIdRef.current = null;
      skipAutoRestoreRef.current = disableSessionRestore;
      return;
    }

    sessionStateWorkspaceRef.current = workspaceId.trim();
    setIsAutoRestoringSession(true);
    setIsSessionHydrating(false);
    const scopedSessionCandidate = loadScopedSessionRestoreCandidate();
    const scopedMessages = loadTransient<Message[]>(scopedKeys.messagesKey, []);
    const scopedTurns = loadTransient<AgentThreadTurn[]>(
      scopedKeys.turnsKey,
      [],
    );
    const scopedItems = loadTransient<AgentThreadItem[]>(
      scopedKeys.itemsKey,
      [],
    );
    const scopedCurrentTurnId = loadTransient<string | null>(
      scopedKeys.currentTurnKey,
      null,
    );

    restoreCandidateSessionIdRef.current = scopedSessionCandidate;
    applySessionSnapshot({
      ...createEmptyAgentSessionSnapshot(),
      sessionId: scopedSessionCandidate,
      messages: scopedMessages,
      threadTurns: scopedTurns,
      threadItems: filterConversationThreadItems(
        normalizeLegacyThreadItems(scopedItems),
      ),
      currentTurnId: scopedCurrentTurnId,
    });
    resetPendingActions();
    resetStreamingRefs();
    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = false;
  }, [
    disableSessionRestore,
    loadScopedSessionRestoreCandidate,
    resetPendingActions,
    resetStreamingRefs,
    scopedKeys,
    workspaceId,
    applySessionSnapshot,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId?.trim()) {
      topicsListMayBeTruncatedRef.current = false;
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    const runListSessions = () => {
      setTopicsReady(false);
      const startedAt = Date.now();
      logAgentDebug("useAgentSession", "listSessions.start", {
        limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
        workspaceId,
      });
      listWorkspaceTopics()
        .then(({ sessions, workspaceSessions, visibleSessions, topicList }) => {
          if (cancelled) {
            return;
          }
          logAgentDebug("useAgentSession", "listSessions.success", {
            durationMs: Date.now() - startedAt,
            hiddenAuxiliarySessionsCount:
              workspaceSessions.length - visibleSessions.length,
            limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
            sessionsCount: sessions.length,
            topicsCount: topicList.length,
            workspaceId,
          });
          topicsListMayBeTruncatedRef.current =
            sessions.length >= INITIAL_TOPICS_SESSION_REQUEST_LIMIT;
          setTopics(topicList);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          topicsListMayBeTruncatedRef.current = false;
          console.error("[AsterChat] 加载话题失败:", error);
          logAgentDebug(
            "useAgentSession",
            "listSessions.error",
            {
              durationMs: Date.now() - startedAt,
              error,
              limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
              workspaceId,
            },
            { level: "error" },
          );
        })
        .finally(() => {
          if (!cancelled) {
            setTopicsReady(true);
          }
        });
    };

    if (initialTopicsLoadMode === "deferred") {
      setTopicsReady(true);
      const cancelDeferredLoad = scheduleMinimumDelayIdleTask(runListSessions, {
        minimumDelayMs: initialTopicsDeferredDelayMs,
        idleTimeoutMs: INITIAL_TOPICS_IDLE_TIMEOUT_MS,
      });
      return () => {
        cancelled = true;
        cancelDeferredLoad();
      };
    }

    runListSessions();

    return () => {
      cancelled = true;
    };
  }, [
    initialTopicsDeferredDelayMs,
    initialTopicsLoadMode,
    listWorkspaceTopics,
    workspaceId,
  ]);

  const loadTopics = useCallback(async () => {
    if (!workspaceId?.trim()) {
      topicsListMayBeTruncatedRef.current = false;
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    const startedAt = Date.now();
    logAgentDebug("useAgentSession", "loadTopics.start", {
      limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
      workspaceId,
    });
    try {
      const { sessions, workspaceSessions, visibleSessions, topicList } =
        await listWorkspaceTopics();
      logAgentDebug("useAgentSession", "loadTopics.success", {
        durationMs: Date.now() - startedAt,
        hiddenAuxiliarySessionsCount:
          workspaceSessions.length - visibleSessions.length,
        limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
        sessionsCount: sessions.length,
        topicsCount: topicList.length,
        workspaceId,
      });
      topicsListMayBeTruncatedRef.current =
        sessions.length >= INITIAL_TOPICS_SESSION_REQUEST_LIMIT;
      setTopics(topicList);
    } catch (error) {
      topicsListMayBeTruncatedRef.current = false;
      console.error("[AsterChat] 加载话题失败:", error);
      logAgentDebug(
        "useAgentSession",
        "loadTopics.error",
        {
          durationMs: Date.now() - startedAt,
          error,
          limit: INITIAL_TOPICS_SESSION_REQUEST_LIMIT,
          workspaceId,
        },
        { level: "error" },
      );
    } finally {
      setTopicsReady(true);
    }
  }, [listWorkspaceTopics, workspaceId]);

  const createFreshSession = useCallback(
    async (
      sessionName?: string,
      createOptions?: {
        preserveCurrentSnapshot?: boolean;
        skipSessionStartHooks?: boolean;
      },
    ): Promise<string | null> => {
      if (createFreshSessionPromiseRef.current) {
        return createFreshSessionPromiseRef.current;
      }

      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        toast.error("缺少项目工作区，请先选择项目");
        return null;
      }

      const creationPromise = (async () => {
        const startedAt = Date.now();
        try {
          invalidatePendingSessionSwitches();
          skipAutoRestoreRef.current = true;
          logAgentDebug("useAgentSession", "createFreshSession.start", {
            executionStrategy,
            sessionName: sessionName?.trim() || null,
            workspaceId: resolvedWorkspaceId,
          });
          const newSessionId = await runtime.createSession(
            resolvedWorkspaceId,
            sessionName,
            executionStrategy,
            {
              runStartHooks: createOptions?.skipSessionStartHooks !== true,
            },
          );

          const now = new Date();
          applySessionSnapshot({
            ...createEmptyAgentSessionSnapshot(),
            sessionId: newSessionId,
            messages:
              createOptions?.preserveCurrentSnapshot === true
                ? messagesRef.current
                : [],
            threadTurns:
              createOptions?.preserveCurrentSnapshot === true
                ? threadTurnsRef.current
                : [],
            threadItems:
              createOptions?.preserveCurrentSnapshot === true
                ? threadItemsRef.current
                : [],
          });
          setSessionHistoryWindow(null);
          setIsAutoRestoringSession(false);
          setIsSessionHydrating(false);
          setTopics((prev) => [
            {
              id: newSessionId,
              title: sessionName?.trim() || "新任务",
              createdAt: now,
              updatedAt: now,
              workspaceId: resolvedWorkspaceId,
              messagesCount: 0,
              executionStrategy,
              status: "draft",
              lastPreview: "等待你补充任务需求后开始执行。",
              isPinned: false,
              hasUnread: false,
              tag: null,
              sourceSessionId: newSessionId,
            },
            ...prev.filter((topic) => topic.id !== newSessionId),
          ]);
          resetPendingActions();
          resetStreamingRefs();
          hydratedSessionRef.current = newSessionId;
          restoredWorkspaceRef.current = resolvedWorkspaceId;

          markSessionExecutionStrategySynced(newSessionId, executionStrategy);
          const nextProviderType = providerTypeRef.current;
          const nextModel = modelRef.current;
          const nextScopedKeys = scopedKeys;
          scheduleFreshSessionPostCreatePersistence(() => {
            persistSessionModelPreference(
              newSessionId,
              nextProviderType,
              nextModel,
            );
            persistSessionAccessMode(newSessionId, accessMode);
            persistSessionRestoreCandidate(newSessionId);
            saveTransient(nextScopedKeys.messagesKey, []);
            saveTransient(nextScopedKeys.turnsKey, []);
            saveTransient(nextScopedKeys.itemsKey, []);
            saveTransient(nextScopedKeys.currentTurnKey, null);
          });

          logAgentDebug("useAgentSession", "createFreshSession.success", {
            durationMs: Date.now() - startedAt,
            newSessionId,
            sessionName: sessionName?.trim() || null,
            workspaceId: resolvedWorkspaceId,
          });
          return newSessionId;
        } catch (error) {
          skipAutoRestoreRef.current = false;
          console.error("[AsterChat] 创建新任务失败:", error);
          logAgentDebug(
            "useAgentSession",
            "createFreshSession.error",
            {
              durationMs: Date.now() - startedAt,
              error,
              sessionName: sessionName?.trim() || null,
              workspaceId: resolvedWorkspaceId,
            },
            { level: "error" },
          );
          toast.error(`创建新任务失败: ${error}`);
          return null;
        }
      })();

      const trackedCreationPromise = creationPromise.finally(() => {
        if (createFreshSessionPromiseRef.current === trackedCreationPromise) {
          createFreshSessionPromiseRef.current = null;
        }
      });

      createFreshSessionPromiseRef.current = trackedCreationPromise;
      return trackedCreationPromise;
    },
    [
      accessMode,
      applySessionSnapshot,
      executionStrategy,
      invalidatePendingSessionSwitches,
      modelRef,
      markSessionExecutionStrategySynced,
      persistSessionModelPreference,
      persistSessionAccessMode,
      persistSessionRestoreCandidate,
      providerTypeRef,
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      scopedKeys,
      workspaceId,
    ],
  );

  const clearMessages = useCallback(
    (options: ClearMessagesOptions = {}) => {
      const { showToast = true, toastMessage = "新任务已创建" } = options;

      const scopedMessagesKey = scopedKeys.messagesKey;

      applySessionSnapshot(
        createEmptyAgentSessionSnapshot({
          executionRuntime: executionRuntimeRef.current,
        }),
      );
      setSessionHistoryWindow(null);
      invalidatePendingSessionSwitches();
      setIsAutoRestoringSession(false);
      setIsSessionHydrating(false);
      resetPendingActions();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = true;
      resetStreamingRefs();

      persistSessionRestoreCandidate(null);
      saveTransient(scopedMessagesKey, []);
      saveTransient(scopedKeys.turnsKey, []);
      saveTransient(scopedKeys.itemsKey, []);
      saveTransient(scopedKeys.currentTurnKey, null);

      if (showToast) {
        toast.success(toastMessage);
      }
    },
    [
      applySessionSnapshot,
      invalidatePendingSessionSwitches,
      persistSessionRestoreCandidate,
      resetPendingActions,
      resetStreamingRefs,
      scopedKeys,
    ],
  );

  const deleteMessage = useCallback(
    (id: string) => {
      setMessagesState((prev) => prev.filter((msg) => msg.id !== id));
    },
    [setMessagesState],
  );

  const editMessage = useCallback(
    (id: string, newContent: string) => {
      setMessagesState((prev) =>
        prev.map((msg) =>
          msg.id === id ? { ...msg, content: newContent } : msg,
        ),
      );
    },
    [setMessagesState],
  );

  const applySessionDetail = useCallback(
    (
      topicId: string,
      detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
      options?: {
        syncSessionId?: boolean;
        executionStrategyOverride?: AsterExecutionStrategy;
        preserveExecutionStrategyOnMissingDetail?: boolean;
        localSnapshotOverride?: {
          sessionId: string;
          messages: Message[];
          threadTurns: AgentThreadTurn[];
          threadItems: AgentThreadItem[];
        } | null;
      },
    ) => {
      const { executionStrategy: nextExecutionStrategy, snapshot } =
        buildHydratedAgentSessionSnapshot({
          topicId,
          detail,
          currentSessionId: sessionIdRef.current,
          currentMessages: messagesRef.current,
          currentThreadTurns: threadTurnsRef.current,
          currentThreadItems: threadItemsRef.current,
          currentExecutionRuntime: executionRuntimeRef.current,
          currentExecutionStrategy: executionStrategy,
          topics,
          localSnapshotOverride: options?.localSnapshotOverride,
          syncSessionId: options?.syncSessionId,
          executionStrategyOverride: options?.executionStrategyOverride,
          preserveExecutionStrategyOnMissingDetail:
            options?.preserveExecutionStrategyOnMissingDetail,
        });
      applySessionSnapshot(snapshot);
      setExecutionStrategyState(nextExecutionStrategy);
    },
    [
      applySessionSnapshot,
      executionStrategy,
      sessionIdRef,
      setExecutionStrategyState,
      topics,
    ],
  );

  const applyCachedTopicSnapshot = useCallback(
    (
      topicId: string,
      cachedSnapshot: ReturnType<typeof loadAgentSessionCachedSnapshot>,
    ) => {
      if (!cachedSnapshot) {
        return false;
      }

      const selectedTopic = topics.find((topic) => topic.id === topicId);
      const metadata = cachedSnapshot.cacheMetadata;
      const totalMessages =
        metadata?.messagesCount ??
        selectedTopic?.messagesCount ??
        cachedSnapshot.messages.length;
      hydratedSessionRef.current = topicId;
      applySessionSnapshot({
        ...createEmptyAgentSessionSnapshot(),
        sessionId: topicId,
        messages: cachedSnapshot.messages,
        threadTurns: cachedSnapshot.threadTurns,
        threadItems: cachedSnapshot.threadItems,
        currentTurnId: cachedSnapshot.currentTurnId,
      });
      setExecutionStrategyState(
        normalizeExecutionStrategy(
          selectedTopic?.executionStrategy || executionStrategy,
        ),
      );
      setSessionHistoryWindow(
        metadata?.historyTruncated === true ||
          totalMessages > cachedSnapshot.messages.length
          ? {
              loadedMessages: cachedSnapshot.messages.length,
              totalMessages: Math.max(
                totalMessages,
                cachedSnapshot.messages.length,
              ),
              isLoadingFull: false,
              error: null,
            }
          : null,
      );
      const cachedSnapshotMetricContext = {
        cacheFreshness: metadata?.freshness ?? null,
        cacheStorageKind: metadata?.storageKind ?? null,
        cachedMessagesCount: cachedSnapshot.messages.length,
        cachedThreadItemsCount: cachedSnapshot.threadItems.length,
        cachedTurnsCount: cachedSnapshot.threadTurns.length,
        topicId,
        workspaceId,
      };
      recordAgentUiPerformanceMetric(
        "session.switch.cachedSnapshotApplied",
        cachedSnapshotMetricContext,
      );
      logAgentDebug(
        "useAgentSession",
        "switchTopic.cachedSnapshotApplied",
        cachedSnapshotMetricContext,
      );
      return true;
    },
    [
      applySessionSnapshot,
      executionStrategy,
      setExecutionStrategyState,
      topics,
      workspaceId,
    ],
  );

  const applyCachedTopicChromeState = useCallback(
    (topicId: string) => {
      const topicPreference = loadSessionModelPreference(topicId);
      if (topicPreference) {
        applySessionModelPreference(topicId, topicPreference);
      }

      const shadowAccessMode = loadSessionAccessMode(topicId);
      if (shadowAccessMode) {
        setAccessModeState(shadowAccessMode);
      } else {
        setAccessModeState(resolvePersistedAccessMode(workspaceId));
      }
    },
    [
      applySessionModelPreference,
      loadSessionAccessMode,
      loadSessionModelPreference,
      setAccessModeState,
      workspaceId,
    ],
  );

  const prefetchTopic = useCallback(
    async (topicId: string): Promise<boolean> => {
      const resolvedTopicId = topicId.trim();
      const resolvedWorkspaceId = normalizeProjectId(workspaceId);
      if (
        !resolvedTopicId ||
        !resolvedWorkspaceId ||
        isAuxiliaryAgentSessionId(resolvedTopicId) ||
        sessionIdRef.current === resolvedTopicId
      ) {
        return false;
      }

      const selectedTopic = topics.find(
        (topic) => topic.id === resolvedTopicId,
      );
      const signature = buildSessionDetailPrefetchSignature(
        resolvedTopicId,
        selectedTopic,
      );
      const prefetchKey = buildSessionDetailPrefetchKey(
        resolvedWorkspaceId,
        resolvedTopicId,
      );
      const existingPrefetch = sessionDetailPrefetchRegistry.get(prefetchKey);
      if (existingPrefetch?.signature === signature) {
        return existingPrefetch.promise.then(
          () => true,
          () => false,
        );
      }

      const cachedSnapshot = loadAgentSessionCachedSnapshot(
        resolvedWorkspaceId,
        resolvedTopicId,
        {
          topicUpdatedAt: selectedTopic?.updatedAt ?? null,
          messagesCount: selectedTopic?.messagesCount ?? null,
        },
      );
      if (cachedSnapshot?.cacheMetadata?.freshness === "fresh") {
        return false;
      }

      const prefetchStartedAt = Date.now();
      const prefetchMetricContext = {
        cacheFreshness: cachedSnapshot?.cacheMetadata?.freshness ?? null,
        sessionId: resolvedTopicId,
        workspaceId: resolvedWorkspaceId,
      };
      recordAgentUiPerformanceMetric(
        "session.prefetch.start",
        prefetchMetricContext,
      );
      logAgentDebug(
        "useAgentSession",
        "sessionPrefetch.start",
        prefetchMetricContext,
      );

      const promise = runtime
        .getSession(resolvedTopicId, buildSessionDetailHydrationOptions())
        .then((detail) => {
          const detailWorkspaceId = normalizeProjectId(detail.workspace_id);
          if (
            detailWorkspaceId &&
            resolvedWorkspaceId &&
            detailWorkspaceId !== resolvedWorkspaceId
          ) {
            logAgentDebug("useAgentSession", "sessionPrefetch.skipped", {
              detailWorkspaceId,
              reason: "workspace_mismatch",
              sessionId: resolvedTopicId,
              workspaceId: resolvedWorkspaceId,
            });
            return detail;
          }

          const messages = hydrateSessionDetailMessages(
            detail,
            resolvedTopicId,
            {
              compactCompletedHistory:
                shouldCompactCompletedSessionHistory(detail),
            },
          );
          const threadTurns = detail.turns || [];
          const threadItems = filterConversationThreadItems(
            normalizeLegacyThreadItems(detail.items || []),
          );
          saveAgentSessionCachedSnapshot(
            resolvedWorkspaceId,
            resolvedTopicId,
            {
              messages,
              threadTurns,
              threadItems,
              currentTurnId: null,
            },
            {
              sessionUpdatedAt: detail.updated_at * 1000,
              messagesCount: detail.messages_count ?? messages.length,
              historyTruncated:
                detail.history_truncated === true ||
                (typeof detail.messages_count === "number" &&
                  detail.messages_count > messages.length),
            },
          );
          if (detailWorkspaceId) {
            savePersistedSessionWorkspaceId(resolvedTopicId, detailWorkspaceId);
          }
          const prefetchSuccessMetricContext = {
            durationMs: Date.now() - prefetchStartedAt,
            itemsCount: threadItems.length,
            messagesCount: messages.length,
            sessionId: resolvedTopicId,
            turnsCount: threadTurns.length,
            workspaceId: resolvedWorkspaceId,
          };
          recordAgentUiPerformanceMetric(
            "session.prefetch.success",
            prefetchSuccessMetricContext,
          );
          logAgentDebug(
            "useAgentSession",
            "sessionPrefetch.success",
            prefetchSuccessMetricContext,
          );
          return detail;
        })
        .catch((error) => {
          recordAgentUiPerformanceMetric("session.prefetch.error", {
            durationMs: Date.now() - prefetchStartedAt,
            sessionId: resolvedTopicId,
            workspaceId: resolvedWorkspaceId,
          });
          logAgentDebug(
            "useAgentSession",
            "sessionPrefetch.error",
            {
              error,
              sessionId: resolvedTopicId,
              workspaceId: resolvedWorkspaceId,
            },
            { level: "warn", throttleMs: 1000 },
          );
          throw error;
        })
        .finally(() => {
          sessionDetailPrefetchRegistry.deleteIfCurrent(prefetchKey, promise);
        });

      sessionDetailPrefetchRegistry.set(prefetchKey, {
        signature,
        promise,
      });

      return promise.then(
        () => true,
        () => false,
      );
    },
    [runtime, sessionIdRef, topics, workspaceId],
  );

  useEffect(() => {
    if (
      import.meta.env?.MODE === "test" ||
      import.meta.env?.VITEST ||
      !topicsReady ||
      disableSessionRestore ||
      !workspaceId?.trim()
    ) {
      return;
    }

    const candidates = topics
      .filter(
        (topic) =>
          topic.id !== sessionIdRef.current &&
          !isAuxiliaryAgentSessionId(topic.id),
      )
      .slice(0, SESSION_DETAIL_PREFETCH_RECENT_LIMIT);
    if (candidates.length === 0) {
      return;
    }

    return scheduleMinimumDelayIdleTask(
      () => {
        void (async () => {
          for (const topic of candidates) {
            if (sessionIdRef.current === topic.id) {
              continue;
            }
            await prefetchTopic(topic.id);
          }
        })();
      },
      {
        minimumDelayMs: SESSION_DETAIL_PREFETCH_DELAY_MS,
        idleTimeoutMs: SESSION_DETAIL_PREFETCH_IDLE_TIMEOUT_MS,
      },
    );
  }, [
    disableSessionRestore,
    prefetchTopic,
    sessionIdRef,
    topics,
    topicsReady,
    workspaceId,
  ]);

  const emitSessionDetailFetchEvent = useCallback(
    (event: SessionDetailFetchEvent) => {
      if (event.metricName) {
        recordAgentUiPerformanceMetric(
          event.metricName,
          event.metricContext ?? event.logContext,
        );
      }

      const logOptions =
        event.logLevel || event.throttleMs
          ? {
              ...(event.logLevel ? { level: event.logLevel } : {}),
              ...(event.throttleMs ? { throttleMs: event.throttleMs } : {}),
            }
          : undefined;
      logAgentDebug(
        "useAgentSession",
        event.logEvent,
        event.logContext,
        logOptions,
      );
    },
    [],
  );

  const loadRuntimeSessionDetail = useCallback(
    (params: {
      topicId: string;
      startedAt: number;
      mode: "direct" | "deferred";
      resumeSessionStartHooks?: boolean;
    }) =>
      loadSessionDetailWithPrefetch({
        getSession: (topicId, options) => runtime.getSession(topicId, options),
        mode: params.mode,
        onEvent: emitSessionDetailFetchEvent,
        prefetchRegistry: sessionDetailPrefetchRegistry,
        prefetchWorkspaceId: normalizeProjectId(workspaceId) || "",
        resumeSessionStartHooks: params.resumeSessionStartHooks,
        startedAt: params.startedAt,
        topicId: params.topicId,
        workspaceId,
      }),
    [emitSessionDetailFetchEvent, runtime, workspaceId],
  );

  const finalizeResolvedTopicDetail = useCallback(
    (params: {
      topicId: string;
      detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>;
      startedAt: number;
      localSnapshotOverride?: {
        sessionId: string;
        messages: Message[];
        threadTurns: AgentThreadTurn[];
        threadItems: AgentThreadItem[];
      } | null;
      switchRequestVersion: number;
      useTransition?: boolean;
    }) => {
      const {
        topicId,
        detail,
        startedAt,
        localSnapshotOverride = null,
        switchRequestVersion,
        useTransition = false,
      } = params;

      if (
        !isCurrentSessionHydrationRequest({
          currentRequestVersion: sessionSwitchRequestVersionRef.current,
          requestVersion: switchRequestVersion,
        })
      ) {
        logAgentDebug(
          "useAgentSession",
          "switchTopic.staleResultIgnored",
          {
            currentSessionId: sessionIdRef.current,
            switchRequestVersion,
            topicId,
            workspaceId,
          },
          { throttleMs: 1000 },
        );
        return false;
      }

      const runtimePreference =
        createSessionModelPreferenceFromExecutionRuntime(
          detail.execution_runtime,
        );
      const runtimeAccessMode = createSessionAccessModeFromExecutionRuntime(
        detail.execution_runtime,
      );
      const runtimeWorkspaceId = normalizeProjectId(detail.workspace_id);
      const selectedTopic = topics.find((topic) => topic.id === topicId);
      const topicWorkspaceId = normalizeProjectId(selectedTopic?.workspaceId);
      const shadowWorkspaceId = normalizeProjectId(
        loadStoredSessionWorkspaceIdRaw(topicId),
      );
      const resolvedWorkspaceId = normalizeProjectId(workspaceId);
      const workspaceRestorePlan = buildSessionWorkspaceRestorePlan({
        resolvedWorkspaceId,
        runtimeWorkspaceId,
        shadowWorkspaceId,
        topicId,
        topicWorkspaceId,
      });

      if (workspaceRestorePlan.shouldReject) {
        console.warn(
          "[AsterChat] 检测到跨工作区会话恢复，已忽略",
          workspaceRestorePlan.crossWorkspaceContext ?? {
            currentWorkspaceId: resolvedWorkspaceId,
            knownWorkspaceId: workspaceRestorePlan.knownWorkspaceId,
            topicId,
          },
        );
        applySessionSnapshot(createEmptyAgentSessionSnapshot());
        setSessionHistoryWindow(null);
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
        restoredWorkspaceRef.current = null;
        skipAutoRestoreRef.current = false;
        setIsSessionHydrating(false);
        return false;
      }

      const runtimeExecutionStrategy = detail.execution_strategy
        ? normalizeExecutionStrategy(detail.execution_strategy)
        : null;
      const topicExecutionStrategy = selectedTopic?.executionStrategy
        ? normalizeExecutionStrategy(selectedTopic.executionStrategy)
        : null;
      const executionStrategyStorageKey =
        getExecutionStrategyStorageKey(workspaceId);
      const persistedExecutionStrategy =
        executionStrategyStorageKey &&
        loadPersistedString(executionStrategyStorageKey);
      const shadowExecutionStrategyFallback =
        resolveShadowSessionExecutionStrategyFallback({
          runtimeExecutionStrategy,
          topicExecutionStrategy,
          persistedExecutionStrategy: persistedExecutionStrategy
            ? resolvePersistedExecutionStrategy(workspaceId)
            : null,
        });
      const topicPreference =
        runtimePreference || loadSessionModelPreference(topicId);
      const shadowAccessMode = loadSessionAccessMode(topicId);

      persistSessionRestoreCandidate(topicId);
      hydratedSessionRef.current = topicId;
      const applyResolvedDetail = () => {
        applySessionDetail(topicId, detail, {
          localSnapshotOverride,
          syncSessionId: true,
          executionStrategyOverride: resolveSessionExecutionStrategyOverride({
            runtimeExecutionStrategy,
            topicExecutionStrategy,
            shadowExecutionStrategyFallback,
          }),
        });
      };

      if (useTransition) {
        startTransition(applyResolvedDetail);
      } else {
        applyResolvedDetail();
      }
      setSessionHistoryWindow(resolveSessionHistoryWindow(detail));
      const workspaceDefaultAccessMode = resolvePersistedAccessMode(workspaceId);
      const metadataSyncPlan = buildSessionMetadataSyncPlan({
        runtimeAccessMode,
        runtimePreference,
        shadowAccessMode,
        shadowExecutionStrategyFallback,
        topicPreference,
        workspaceDefaultAccessMode,
      });
      const postFinalizePersistencePlan =
        buildSessionPostFinalizePersistencePlan({
          knownWorkspaceId: workspaceRestorePlan.knownWorkspaceId,
          providerPreferenceToApply: metadataSyncPlan.providerPreferenceToApply,
          resolvedWorkspaceId,
          runtimeWorkspaceId,
        });
      setTopics((prev) =>
        upsertTopicFromSessionDetail(
          prev,
          mapSessionDetailToTopic(
            topicId,
            detail,
            postFinalizePersistencePlan.topicWorkspaceId,
          ),
        ),
      );

      if (runtimeExecutionStrategy) {
        markSessionExecutionStrategySynced(topicId, runtimeExecutionStrategy);
      }

      setAccessModeState(metadataSyncPlan.accessMode);
      if (metadataSyncPlan.shouldPersistAccessMode) {
        persistSessionAccessMode(topicId, metadataSyncPlan.accessMode);
      }

      const switchSuccessMetricContext = buildSessionSwitchSuccessMetricContext({
        accessModeSource: metadataSyncPlan.accessModeSource,
        durationMs: Date.now() - startedAt,
        executionStrategySource: resolveSessionExecutionStrategySource({
          runtimeExecutionStrategy,
          topicExecutionStrategy,
          shadowExecutionStrategyFallback,
        }),
        itemsCount: detail.items?.length ?? 0,
        messagesCount: detail.messages.length,
        modelPreferenceSource: metadataSyncPlan.modelPreferenceSource,
        queuedTurnsCount: detail.queued_turns?.length ?? 0,
        topicId,
        turnsCount: detail.turns?.length ?? 0,
        workspaceId,
      });
      recordAgentUiPerformanceMetric(
        "session.switch.success",
        switchSuccessMetricContext,
      );
      logAgentDebug(
        "useAgentSession",
        "switchTopic.success",
        switchSuccessMetricContext,
      );

      if (postFinalizePersistencePlan.persistedWorkspaceId) {
        savePersistedSessionWorkspaceId(
          topicId,
          postFinalizePersistencePlan.persistedWorkspaceId,
        );
      }

      if (postFinalizePersistencePlan.runtimeTopicWorkspaceIdToApply) {
        setTopics((prev) =>
          prev.map((topic) =>
            topic.id === topicId
              ? {
                  ...topic,
                  workspaceId:
                    postFinalizePersistencePlan.runtimeTopicWorkspaceIdToApply,
                }
              : topic,
          ),
        );
      }

      if (postFinalizePersistencePlan.providerPreferenceToApply) {
        applySessionModelPreference(
          topicId,
          postFinalizePersistencePlan.providerPreferenceToApply,
        );
      }

      if (metadataSyncPlan.hasPatch) {
        scheduleSessionMetadataSync({
          getCurrentRequestVersion: () =>
            sessionSwitchRequestVersionRef.current,
          getCurrentSessionId: () => sessionIdRef.current,
          hasRuntimeInvokeCapability: hasTauriInvokeCapability(),
          idleTimeoutMs: SESSION_METADATA_SYNC_IDLE_TIMEOUT_MS,
          minimumDelayMs: SESSION_METADATA_SYNC_DELAY_MS,
          onError: (error) => {
            console.warn("[AsterChat] 迁移会话 metadata fallback 失败:", error);
          },
          onSkipped: (event) => {
            logAgentDebug(
              "useAgentSession",
              event.logEvent,
              event.logContext,
              event.logOptions,
            );
          },
          onSynced: (syncedPlan) => {
            if (syncedPlan.fallbackProviderPreference) {
              markSessionModelPreferenceSynced(
                topicId,
                syncedPlan.fallbackProviderPreference.providerType,
                syncedPlan.fallbackProviderPreference.model,
              );
            }
            if (syncedPlan.fallbackExecutionStrategy) {
              const fallbackExecutionStrategy =
                syncedPlan.fallbackExecutionStrategy;
              markSessionExecutionStrategySynced(
                topicId,
                fallbackExecutionStrategy,
              );
              setTopics((prev) =>
                prev.map((topic) =>
                  topic.id === topicId
                    ? {
                        ...topic,
                        executionStrategy: fallbackExecutionStrategy,
                      }
                    : topic,
                ),
              );
            }
          },
          pendingCancel: pendingSessionMetadataSyncCancelRef.current,
          plan: metadataSyncPlan,
          runtime,
          scheduler: { schedule: scheduleMinimumDelayIdleTask },
          sessionId: topicId,
          setPendingCancel: (cancel) => {
            pendingSessionMetadataSyncCancelRef.current = cancel;
          },
          switchRequestVersion,
          workspaceId,
        });
      }

      setIsAutoRestoringSession(false);
      setIsSessionHydrating(false);
      return true;
    },
    [
      applySessionDetail,
      applySessionSnapshot,
      applySessionModelPreference,
      loadSessionAccessMode,
      loadSessionModelPreference,
      markSessionExecutionStrategySynced,
      markSessionModelPreferenceSynced,
      persistSessionAccessMode,
      persistSessionRestoreCandidate,
      resolveSessionHistoryWindow,
      runtime,
      sessionIdRef,
      setAccessModeState,
      topics,
      workspaceId,
    ],
  );

  const handleSwitchTopicError = useCallback(
    (
      error: unknown,
      topicId: string,
      options?: { preserveCurrentSnapshot?: boolean },
    ) => {
      const errorAction = resolveSessionSwitchErrorAction({
        error,
        preserveCurrentSnapshot: options?.preserveCurrentSnapshot,
        topicId,
        workspaceId,
      });

      console.error("[AsterChat] 切换话题失败:", error);
      console.error("[AsterChat] 错误详情:", JSON.stringify(error, null, 2));
      logAgentDebug(
        "useAgentSession",
        "switchTopic.error",
        errorAction.logContext,
        { level: "error" },
      );

      if (errorAction.clearCurrentSnapshot) {
        applySessionSnapshot(createEmptyAgentSessionSnapshot());
        setSessionHistoryWindow(null);
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
      }

      if (errorAction.reloadTopics) {
        void loadTopics();
      }

      setIsAutoRestoringSession(false);
      setIsSessionHydrating(false);
      if (errorAction.showToast && errorAction.toastMessage) {
        toast.error(errorAction.toastMessage);
      }
    },
    [
      applySessionSnapshot,
      loadTopics,
      persistSessionRestoreCandidate,
      workspaceId,
    ],
  );

  const switchTopic = useCallback(
    async (
      topicId: string,
      options?: {
        forceRefresh?: boolean;
        resumeSessionStartHooks?: boolean;
        allowDetachedSession?: boolean;
        restoreSource?: "auto";
      },
    ) => {
      if (
        !options?.forceRefresh &&
        topicId === sessionIdRef.current &&
        messages.length > 0
      ) {
        return;
      }

      const canReuseActiveSwitch =
        !options?.forceRefresh &&
        !options?.resumeSessionStartHooks &&
        !options?.allowDetachedSession &&
        options?.restoreSource !== "auto";
      const activeSwitch = activeSessionSwitchRef.current;
      if (canReuseActiveSwitch && activeSwitch?.topicId === topicId) {
        logAgentDebug("useAgentSession", "switchTopic.reuseInFlight", {
          topicId,
          workspaceId,
        });
        return activeSwitch.promise;
      }

      let resolveActiveSwitch: () => void = () => {};
      const activeSwitchPromise = new Promise<void>((resolve) => {
        resolveActiveSwitch = resolve;
      });
      if (canReuseActiveSwitch) {
        activeSessionSwitchRef.current = {
          topicId,
          promise: activeSwitchPromise,
        };
      }

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
      }

      skipAutoRestoreRef.current = false;
      if (options?.allowDetachedSession === true) {
        detachedSessionIdRef.current = topicId;
      } else {
        detachedSessionIdRef.current = null;
      }
      const switchRequestVersion = invalidatePendingSessionSwitches();
      setIsSessionHydrating(false);
      if (options?.restoreSource !== "auto") {
        setIsAutoRestoringSession(false);
      }
      try {
        const startedAt = Date.now();
        const selectedTopic = topics.find((topic) => topic.id === topicId);
        const cachedTargetSnapshot = shouldLoadCachedTopicSnapshot({
          currentSessionId,
          topicId,
        })
          ? loadAgentSessionCachedSnapshot(workspaceId, topicId, {
              topicUpdatedAt: selectedTopic?.updatedAt ?? null,
              messagesCount: selectedTopic?.messagesCount ?? null,
            })
          : null;
        const cachedSnapshotMetadata = cachedTargetSnapshot?.cacheMetadata;
        const shouldRefreshCachedSnapshotImmediately =
          resolveShouldRefreshCachedSnapshotImmediately({
            cacheFreshness: cachedSnapshotMetadata?.freshness,
            topicStatus: selectedTopic?.status,
          });
        const switchStartMetricContext = buildSessionSwitchStartMetricContext({
          cachedSnapshot: cachedTargetSnapshot,
          currentSessionId,
          messagesCount: messages.length,
          refreshCachedSnapshotImmediately:
            shouldRefreshCachedSnapshotImmediately,
          topicId,
          workspaceId,
        });
        recordAgentUiPerformanceMetric(
          "session.switch.start",
          switchStartMetricContext,
        );
        logAgentDebug(
          "useAgentSession",
          "switchTopic.start",
          switchStartMetricContext,
        );
        if (shouldApplyCachedTopicSnapshot({ currentSessionId, topicId })) {
          applyCachedTopicSnapshot(topicId, cachedTargetSnapshot);
        }
        const shouldDeferDetailHydration = shouldDeferSessionDetailHydration({
          currentSessionId,
          topicId,
          forceRefresh: options?.forceRefresh,
          resumeSessionStartHooks: options?.resumeSessionStartHooks,
          cachedSnapshot: cachedTargetSnapshot,
        });

        if (shouldDeferDetailHydration) {
          applyCachedTopicChromeState(topicId);
          persistSessionRestoreCandidate(topicId);
          setIsAutoRestoringSession(false);
          setIsSessionHydrating(false);
          const deferHydrationMetricContext =
            buildSessionSwitchDeferHydrationMetricContext({
              cachedSnapshot: cachedTargetSnapshot,
              currentSessionId,
              refreshImmediately: shouldRefreshCachedSnapshotImmediately,
              topicId,
              workspaceId,
            });
          recordAgentUiPerformanceMetric(
            "session.switch.deferHydration",
            deferHydrationMetricContext,
          );
          logAgentDebug(
            "useAgentSession",
            "switchTopic.deferHydration",
            deferHydrationMetricContext,
          );
          let deferredHydrationRetryCount = 0;
          const hydrateCachedTopic = () => {
            deferredSessionHydrationCancelRef.current = null;
            void (async () => {
              try {
                const detail = await loadRuntimeSessionDetail({
                  topicId,
                  startedAt,
                  mode: shouldRefreshCachedSnapshotImmediately
                    ? "direct"
                    : "deferred",
                });
                finalizeResolvedTopicDetail({
                  topicId,
                  detail,
                  startedAt,
                  localSnapshotOverride:
                    buildSessionSwitchLocalSnapshotOverride({
                      cachedSnapshot: cachedTargetSnapshot,
                      currentSessionId: sessionIdRef.current,
                      messages: messagesRef.current,
                      threadTurns: threadTurnsRef.current,
                      threadItems: threadItemsRef.current,
                      topicId,
                    }),
                  switchRequestVersion,
                  useTransition: true,
                });
              } catch (error) {
                if (
                  !isCurrentSessionHydrationRequest({
                    currentRequestVersion:
                      sessionSwitchRequestVersionRef.current,
                    requestVersion: switchRequestVersion,
                  })
                ) {
                  return;
                }
                const retryAction =
                  resolveDeferredSessionHydrationErrorAction({
                    error,
                    retryCount: deferredHydrationRetryCount,
                    maxRetry: SESSION_DETAIL_DEFERRED_HYDRATION_MAX_RETRY,
                    retryDelayMs:
                      SESSION_DETAIL_DEFERRED_HYDRATION_RETRY_DELAY_MS,
                    topicId,
                    workspaceId,
                  });
                if (retryAction.kind === "retry") {
                  deferredHydrationRetryCount = retryAction.nextRetryCount;
                  recordAgentUiPerformanceMetric(
                    retryAction.metricName,
                    retryAction.logContext,
                  );
                  logAgentDebug(
                    "useAgentSession",
                    retryAction.logEvent,
                    retryAction.logContext,
                    { level: "warn", throttleMs: 1000 },
                  );
                  deferredSessionHydrationCancelRef.current =
                    scheduleMinimumDelayIdleTask(hydrateCachedTopic, {
                      minimumDelayMs: retryAction.retryDelayMs,
                      idleTimeoutMs: retryAction.retryDelayMs,
                    });
                  return;
                }
                if (retryAction.kind === "skip") {
                  recordAgentUiPerformanceMetric(
                    retryAction.metricName,
                    retryAction.logContext,
                  );
                  logAgentDebug(
                    "useAgentSession",
                    retryAction.logEvent,
                    retryAction.logContext,
                    { level: "warn", throttleMs: 1000 },
                  );
                  return;
                }
                handleSwitchTopicError(retryAction.error, topicId, {
                  preserveCurrentSnapshot: true,
                });
              }
            })();
          };

          if (shouldRefreshCachedSnapshotImmediately) {
            hydrateCachedTopic();
          } else {
            deferredSessionHydrationCancelRef.current =
              scheduleMinimumDelayIdleTask(hydrateCachedTopic, {
                minimumDelayMs:
                  cachedSnapshotMetadata?.freshness === "fresh"
                    ? SESSION_DETAIL_DEFERRED_HYDRATION_DELAY_MS
                    : 0,
                idleTimeoutMs: 1_500,
              });
          }
          return;
        }

        if (
          shouldApplyPendingSessionShell({
            currentSessionId,
            topicId,
            cachedSnapshot: cachedTargetSnapshot,
          })
        ) {
          hydratedSessionRef.current = topicId;
          applySessionSnapshot({
            ...createEmptyAgentSessionSnapshot(),
            sessionId: topicId,
          });
          setExecutionStrategyState(
            normalizeExecutionStrategy(
              selectedTopic?.executionStrategy || executionStrategy,
            ),
          );
          setSessionHistoryWindow(null);
          applyCachedTopicChromeState(topicId);
          persistSessionRestoreCandidate(topicId);
          setIsSessionHydrating(true);
          const pendingShellMetricContext =
            buildPendingSessionShellMetricContext({
              currentSessionId,
              topicId,
              workspaceId,
            });
          recordAgentUiPerformanceMetric(
            "session.switch.pendingShellApplied",
            pendingShellMetricContext,
          );
          logAgentDebug(
            "useAgentSession",
            "switchTopic.pendingShellApplied",
            pendingShellMetricContext,
          );
        }

        const detail = await loadRuntimeSessionDetail({
          topicId,
          startedAt,
          mode: "direct",
          resumeSessionStartHooks: options?.resumeSessionStartHooks === true,
        });
        finalizeResolvedTopicDetail({
          topicId,
          detail,
          startedAt,
          localSnapshotOverride: buildSessionSwitchLocalSnapshotOverride({
            cachedSnapshot: cachedTargetSnapshot,
            currentSessionId: sessionIdRef.current,
            messages: messagesRef.current,
            threadTurns: threadTurnsRef.current,
            threadItems: threadItemsRef.current,
            topicId,
          }),
          switchRequestVersion,
          useTransition: currentSessionId !== topicId,
        });
      } catch (error) {
        if (
          !isCurrentSessionHydrationRequest({
            currentRequestVersion: sessionSwitchRequestVersionRef.current,
            requestVersion: switchRequestVersion,
          })
        ) {
          return;
        }
        handleSwitchTopicError(error, topicId);
      } finally {
        if (activeSessionSwitchRef.current?.promise === activeSwitchPromise) {
          activeSessionSwitchRef.current = null;
        }
        resolveActiveSwitch();
      }
    },
    [
      applyCachedTopicChromeState,
      finalizeResolvedTopicDetail,
      handleSwitchTopicError,
      loadRuntimeSessionDetail,
      messages.length,
      modelRef,
      applyCachedTopicSnapshot,
      applySessionSnapshot,
      executionStrategy,
      invalidatePendingSessionSwitches,
      persistSessionModelPreference,
      persistSessionRestoreCandidate,
      providerTypeRef,
      sessionIdRef,
      setExecutionStrategyState,
      topics,
      workspaceId,
    ],
  );

  const loadFullSessionHistory = useCallback(async () => {
    const targetSessionId = sessionIdRef.current?.trim();
    if (!targetSessionId) {
      return false;
    }

    const currentHistoryWindow = sessionHistoryWindowRef.current;
    const requestPlan = buildSessionHistoryPageRequestPlan({
      currentHistoryWindow,
      currentMessagesCount: messagesRef.current.length,
      pageSize: SESSION_HISTORY_LOAD_PAGE_SIZE,
    });
    if (!requestPlan) {
      return false;
    }

    const switchRequestVersion = sessionSwitchRequestVersionRef.current;
    const startedAt = Date.now();
    setSessionHistoryWindow(requestPlan.loadingWindow);
    logAgentDebug("useAgentSession", "loadFullHistory.start", {
      historyBeforeMessageId: requestPlan.historyBeforeMessageId,
      loadedMessagesCount: requestPlan.loadedMessagesCount,
      nextHistoryLimit: requestPlan.nextHistoryLimit,
      nextHistoryOffset: requestPlan.nextHistoryOffset,
      sessionId: targetSessionId,
      totalMessagesCount: requestPlan.totalMessagesCount,
      workspaceId,
    });

    try {
      const detail = await runtime.getSession(
        targetSessionId,
        requestPlan.requestOptions,
      );
      if (
        !isCurrentSessionHydrationRequest({
          currentRequestVersion: sessionSwitchRequestVersionRef.current,
          requestVersion: switchRequestVersion,
          currentSessionId: sessionIdRef.current,
          targetSessionId,
        })
      ) {
        return false;
      }

      const mergePlan = buildSessionHistoryMergePlan({
        currentMessages: messagesRef.current,
        currentThreadItems: threadItemsRef.current,
        currentThreadTurns: threadTurnsRef.current,
        currentTurnId,
        detail,
        sessionId: targetSessionId,
      });
      const resultPlan = buildSessionHistoryPageResultPlan({
        detail,
        historyBeforeMessageId: requestPlan.historyBeforeMessageId,
        nextHistoryLimit: requestPlan.nextHistoryLimit,
        nextHistoryOffset: requestPlan.nextHistoryOffset,
        totalMessagesCount: requestPlan.totalMessagesCount,
      });

      startTransition(() => {
        applySessionSnapshot({
          sessionId: targetSessionId,
          messages: mergePlan.mergedMessages,
          threadTurns: mergePlan.mergedThreadTurns,
          threadItems: mergePlan.mergedThreadItems,
          currentTurnId: mergePlan.currentTurnId,
          queuedTurns,
          threadRead,
          executionRuntime: executionRuntimeRef.current,
          todoItems,
          childSubagentSessions,
          subagentParentContext,
        });
      });
      setSessionHistoryWindow(resultPlan.nextHistoryWindow);
      setTopics((prev) =>
        upsertTopicFromSessionDetail(
          prev,
          mapSessionDetailToTopic(
            targetSessionId,
            detail,
            normalizeProjectId(detail.workspace_id) ||
              normalizeProjectId(workspaceId),
          ),
        ),
      );
      logAgentDebug("useAgentSession", "loadFullHistory.success", {
        durationMs: Date.now() - startedAt,
        historyBeforeMessageId: requestPlan.historyBeforeMessageId,
        historyTruncated: detail.history_truncated === true,
        historyOffset: detail.history_offset ?? requestPlan.nextHistoryOffset,
        incomingMessagesCount: mergePlan.incomingMessages.length,
        loadedMessagesCount: resultPlan.nextLoadedMessages,
        messagesCount: mergePlan.mergedMessages.length,
        nextHistoryLimit: requestPlan.nextHistoryLimit,
        nextHistoryOffset: requestPlan.nextHistoryOffset,
        sessionId: targetSessionId,
        totalMessagesCount: resultPlan.resolvedTotalMessages,
        workspaceId,
      });
      return true;
    } catch (error) {
      if (
        !isCurrentSessionHydrationRequest({
          currentSessionId: sessionIdRef.current,
          targetSessionId,
        })
      ) {
        return false;
      }

      const message = error instanceof Error ? error.message : String(error);
      setSessionHistoryWindow((current) =>
        current ? { ...current, isLoadingFull: false, error: message } : null,
      );
      logAgentDebug(
        "useAgentSession",
        "loadFullHistory.error",
        {
          durationMs: Date.now() - startedAt,
          error,
          historyBeforeMessageId: requestPlan.historyBeforeMessageId,
          nextHistoryLimit: requestPlan.nextHistoryLimit,
          nextHistoryOffset: requestPlan.nextHistoryOffset,
          sessionId: targetSessionId,
          workspaceId,
        },
        { level: "error" },
      );
      toast.error(`加载历史失败: ${message}`);
      return false;
    }
  }, [
    applySessionSnapshot,
    childSubagentSessions,
    currentTurnId,
    queuedTurns,
    runtime,
    sessionIdRef,
    subagentParentContext,
    threadRead,
    todoItems,
    workspaceId,
  ]);

  const ensureSession = useCallback(
    async (options?: {
      skipSessionRestore?: boolean;
      skipSessionStartHooks?: boolean;
    }): Promise<string | null> => {
      if (sessionIdRef.current) {
        return sessionIdRef.current;
      }

      const restoreCandidate = restoreCandidateSessionIdRef.current?.trim();
      if (
        !options?.skipSessionRestore &&
        !disableSessionRestore &&
        restoreCandidate
      ) {
        const targetSessionId = resolveRestorableTopicSessionId(
          restoreCandidate,
          topics,
          {
            allowDetachedCandidate: topicsListMayBeTruncatedRef.current,
          },
        );

        if (targetSessionId) {
          const targetTopic = topics.find(
            (topic) => topic.id === targetSessionId,
          );
          await switchTopic(targetSessionId, {
            resumeSessionStartHooks: shouldResumeTaskSession(targetTopic),
          });
          if (sessionIdRef.current) {
            return sessionIdRef.current;
          }
        }
      }

      return createFreshSession(undefined, {
        preserveCurrentSnapshot: true,
        skipSessionStartHooks: options?.skipSessionStartHooks === true,
      });
    },
    [
      createFreshSession,
      disableSessionRestore,
      sessionIdRef,
      switchTopic,
      topics,
    ],
  );

  const refreshSessionDetail = useCallback(
    async (targetSessionId?: string) => {
      return refreshAgentSessionDetailState({
        runtime,
        sessionIdRef,
        targetSessionId,
        applySessionDetail,
        markSessionExecutionStrategySynced,
        persistSessionAccessMode,
        setAccessModeState,
        onWarn: (error) => {
          console.warn("[AsterChat] 刷新会话详情失败:", error);
        },
      });
    },
    [
      applySessionDetail,
      markSessionExecutionStrategySynced,
      persistSessionAccessMode,
      runtime,
      sessionIdRef,
      setAccessModeState,
    ],
  );

  const refreshSessionReadModel = useCallback(
    async (targetSessionId?: string) => {
      return refreshAgentSessionReadModelState({
        runtime,
        sessionIdRef,
        targetSessionId,
        applyReadModelSnapshot,
        onWarn: (error) => {
          console.warn("[AsterChat] 刷新运行态摘要失败:", error);
        },
      });
    },
    [applyReadModelSnapshot, runtime, sessionIdRef],
  );

  const attemptSilentTurnRecovery = useCallback(
    async (
      targetSessionId: string,
      requestStartedAt: number,
      promptText: string,
    ) => {
      const resolvedSessionId = targetSessionId.trim();
      if (!resolvedSessionId) {
        return false;
      }

      try {
        const detail = await runtime.getSession(
          resolvedSessionId,
          buildSessionDetailHydrationOptions(),
        );
        if (
          !isCurrentSessionHydrationRequest({
            currentSessionId: sessionIdRef.current,
            targetSessionId: resolvedSessionId,
          })
        ) {
          return false;
        }
        if (
          !hasRecoverableSilentTurnActivity(
            detail,
            requestStartedAt,
            promptText,
          )
        ) {
          return false;
        }

        applySessionDetail(resolvedSessionId, detail, {
          preserveExecutionStrategyOnMissingDetail: true,
        });
        if (detail.execution_strategy) {
          markSessionExecutionStrategySynced(
            resolvedSessionId,
            normalizeExecutionStrategy(detail.execution_strategy),
          );
        }
        return true;
      } catch (error) {
        console.warn("[AsterChat] 静默 turn 恢复失败:", error);
        return false;
      }
    },
    [
      applySessionDetail,
      markSessionExecutionStrategySynced,
      runtime,
      sessionIdRef,
    ],
  );

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (disableSessionRestore) return;
    if (!topicsReady) return;
    if (skipAutoRestoreRef.current) return;
    if (sessionId) return;
    if (restoredWorkspaceRef.current === resolvedWorkspaceId) return;

    restoredWorkspaceRef.current = resolvedWorkspaceId;

    const scopedCandidate = restoreCandidateSessionIdRef.current;
    const targetSessionId = resolveRestorableTopicSessionId(
      scopedCandidate,
      topics,
      {
        allowDetachedCandidate: topicsListMayBeTruncatedRef.current,
      },
    );
    if (!targetSessionId) {
      setIsAutoRestoringSession(false);
      setIsSessionHydrating(false);
      logAgentDebug(
        "useAgentSession",
        "autoRestore.skipWithoutTarget",
        {
          candidateSessionId: scopedCandidate,
          topicsCount: topics.length,
          workspaceId: resolvedWorkspaceId,
        },
        { throttleMs: 1000 },
      );
      return;
    }

    let cancelled = false;
    setIsAutoRestoringSession(true);
    setIsSessionHydrating(false);
    logAgentDebug("useAgentSession", "autoRestore.start", {
      candidateSessionId: scopedCandidate,
      targetSessionId,
      restoreSource: topics.length > 0 ? "topics_snapshot" : "shadow_cache",
      topicsCount: topics.length,
      workspaceId: resolvedWorkspaceId,
    });
    const targetTopic = topics.find((topic) => topic.id === targetSessionId);
    switchTopic(targetSessionId, {
      resumeSessionStartHooks: shouldResumeTaskSession(targetTopic),
      restoreSource: "auto",
    })
      .catch((error) => {
        console.warn("[AsterChat] 自动恢复会话失败:", error);
        logAgentDebug(
          "useAgentSession",
          "autoRestore.error",
          {
            error,
            targetSessionId,
            workspaceId: resolvedWorkspaceId,
          },
          { level: "warn" },
        );
        persistSessionRestoreCandidate(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsAutoRestoringSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    disableSessionRestore,
    persistSessionRestoreCandidate,
    sessionId,
    switchTopic,
    topics,
    topicsReady,
    workspaceId,
  ]);

  useEffect(() => {
    if (sessionId) {
      skipAutoRestoreRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (!topicsReady) return;

    const sessionMissingFromTopics =
      topics.length > 0 && !topics.some((topic) => topic.id === sessionId);

    if (
      sessionMissingFromTopics &&
      detachedSessionIdRef.current === sessionId
    ) {
      missingSessionVerificationRef.current = null;
      return;
    }

    if (sessionMissingFromTopics) {
      if (isAuxiliaryAgentSessionId(sessionId)) {
        persistSessionRestoreCandidate(null);
        missingSessionVerificationRef.current = null;
        return;
      }

      const shouldVerifyMissingSession = hasSessionHydrationActivity({
        currentTurnId,
        threadTurnsCount: threadTurns.length,
        threadItemsCount: threadItems.length,
        queuedTurnsCount: queuedTurns.length,
      });

      if (!shouldVerifyMissingSession) {
        applySessionSnapshot(
          createEmptyAgentSessionSnapshot({
            executionRuntime: executionRuntimeRef.current,
          }),
        );
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
        missingSessionVerificationRef.current = null;
        return;
      }

      if (missingSessionVerificationRef.current === sessionId) {
        return;
      }

      missingSessionVerificationRef.current = sessionId;
      logAgentDebug(
        "useAgentSession",
        "hydrateSession.sessionMissingFromTopics",
        {
          sessionId,
          topicsCount: topics.length,
          workspaceId,
        },
        { level: "warn" },
      );

      runtime
        .getSession(sessionId, buildSessionDetailHydrationOptions())
        .then((detail) => {
          if (
            !isCurrentSessionHydrationRequest({
              currentSessionId: sessionIdRef.current,
              targetSessionId: sessionId,
            })
          ) {
            return;
          }

          setTopics((prev) => {
            if (prev.some((topic) => topic.id === sessionId)) {
              return prev;
            }

            return [
              mapSessionToTopic({
                id: sessionId,
                name: detail.name,
                created_at: detail.created_at,
                updated_at: detail.updated_at,
                model: detail.model,
                messages_count: detail.messages.length,
                execution_strategy: detail.execution_strategy,
                workspace_id: detail.workspace_id,
                working_dir: detail.working_dir,
              }),
              ...prev,
            ];
          });
        })
        .catch((error) => {
          if (!isAsterSessionNotFoundError(error)) {
            console.warn("[AsterChat] 校验当前会话存在性失败:", error);
            return;
          }

          if (
            !isCurrentSessionHydrationRequest({
              currentSessionId: sessionIdRef.current,
              targetSessionId: sessionId,
            })
          ) {
            return;
          }

          applySessionSnapshot(createEmptyAgentSessionSnapshot());
          persistSessionRestoreCandidate(null);
          hydratedSessionRef.current = null;
          restoredWorkspaceRef.current = null;
          skipAutoRestoreRef.current = false;
        })
        .finally(() => {
          if (missingSessionVerificationRef.current === sessionId) {
            missingSessionVerificationRef.current = null;
          }
        });
      return;
    }

    missingSessionVerificationRef.current = null;

    if (hydratedSessionRef.current === sessionId) {
      return;
    }

    hydratedSessionRef.current = sessionId;
    const hasLocalTimelineCache =
      messages.length > 0 && (threadTurns.length > 0 || threadItems.length > 0);
    const hasPreservedMessageCache =
      preserveRestoredMessages && messages.length > 0;
    const selectedTopic = topics.find((topic) => topic.id === sessionId);
    const shouldResumeHydrationSession = shouldResumeTaskSession(selectedTopic);
    logAgentDebug("useAgentSession", "hydrateSession.start", {
      cacheMode: hasLocalTimelineCache
        ? "timeline_cache"
        : hasPreservedMessageCache
          ? "message_cache"
          : "empty",
      messagesCount: messages.length,
      resumeSessionStartHooks: shouldResumeHydrationSession,
      sessionId,
      threadItemsCount: threadItems.length,
      threadTurnsCount: threadTurns.length,
      workspaceId,
    });

    switchTopic(sessionId, {
      forceRefresh: true,
      ...(shouldResumeHydrationSession
        ? { resumeSessionStartHooks: true }
        : {}),
      ...(detachedSessionIdRef.current === sessionId
        ? { allowDetachedSession: true }
        : {}),
    }).catch((error) => {
      console.warn("[AsterChat] 会话水合失败:", error);
      logAgentDebug(
        "useAgentSession",
        "hydrateSession.error",
        {
          error,
          sessionId,
          workspaceId,
        },
        { level: "warn" },
      );
      hydratedSessionRef.current = null;
    });
  }, [
    messages.length,
    currentTurnId,
    preserveRestoredMessages,
    persistSessionRestoreCandidate,
    queuedTurns.length,
    runtime,
    sessionId,
    sessionIdRef,
    switchTopic,
    threadItems.length,
    threadTurns.length,
    topics,
    topicsReady,
    workspaceId,
    applySessionSnapshot,
  ]);

  useEffect(() => {
    logAgentDebug(
      "useAgentSession",
      "stateSnapshot",
      {
        currentTurnId: currentTurnId ?? null,
        messagesCount: messages.length,
        queuedTurnsCount: queuedTurns.length,
        sessionId: sessionId ?? null,
        threadItemsCount: threadItems.length,
        threadTurnsCount: threadTurns.length,
        topicsCount: topics.length,
        topicsReady,
        workspaceId,
      },
      {
        dedupeKey: JSON.stringify({
          currentTurnId: currentTurnId ?? null,
          messagesCount: messages.length,
          queuedTurnsCount: queuedTurns.length,
          sessionId: sessionId ?? null,
          threadItemsCount: threadItems.length,
          threadTurnsCount: threadTurns.length,
          topicsCount: topics.length,
          topicsReady,
          workspaceId,
        }),
        throttleMs: 800,
      },
    );
  }, [
    currentTurnId,
    messages.length,
    queuedTurns.length,
    sessionId,
    threadItems.length,
    threadTurns.length,
    topics.length,
    topicsReady,
    workspaceId,
  ]);

  const deleteTopic = useCallback(
    async (topicId: string) => {
      try {
        await runtime.deleteSession(topicId);
        await loadTopics();

        if (topicId === sessionIdRef.current) {
          applySessionSnapshot(createEmptyAgentSessionSnapshot());
          resetPendingActions();
          resetStreamingRefs();
          hydratedSessionRef.current = null;
          restoredWorkspaceRef.current = null;
          persistSessionRestoreCandidate(null);
          saveTransient(scopedKeys.turnsKey, []);
          saveTransient(scopedKeys.itemsKey, []);
          saveTransient(scopedKeys.currentTurnKey, null);
        }

        toast.success("任务已删除");
      } catch (error) {
        console.error("[AsterChat] 删除任务失败:", error);
        toast.error("删除任务失败");
      }
    },
    [
      loadTopics,
      persistSessionRestoreCandidate,
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      scopedKeys,
      sessionIdRef,
      applySessionSnapshot,
    ],
  );

  const renameTopic = useCallback(
    async (topicId: string, newTitle: string) => {
      const normalizedTitle = newTitle.trim();
      if (!normalizedTitle) {
        return;
      }

      try {
        await runtime.renameSession(topicId, normalizedTitle);
        await loadTopics();
        toast.success("任务已重命名");
      } catch (error) {
        console.error("[AsterChat] 重命名任务失败:", error);
        toast.error("重命名失败");
      }
    },
    [loadTopics, runtime],
  );

  const updateTopicExecutionStrategy = useCallback(
    (
      targetSessionId: string,
      nextExecutionStrategy: AsterExecutionStrategy,
    ) => {
      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === targetSessionId
            ? { ...topic, executionStrategy: nextExecutionStrategy }
            : topic,
        ),
      );
    },
    [],
  );

  const updateTopicSnapshot = useCallback(
    (
      targetSessionId: string,
      snapshot: Partial<
        Pick<
          Topic,
          | "updatedAt"
          | "messagesCount"
          | "status"
          | "statusReason"
          | "lastPreview"
          | "hasUnread"
        >
      >,
    ) => {
      setTopics((prev) => {
        let changed = false;
        const nextTopics = prev.map((topic) => {
          if (topic.id !== targetSessionId) {
            return topic;
          }

          const { updatedAt, ...restSnapshot } = snapshot;
          const nextTopic = {
            ...topic,
            ...restSnapshot,
            ...(updatedAt ? { updatedAt } : {}),
          };

          const unchanged =
            nextTopic.messagesCount === topic.messagesCount &&
            nextTopic.status === topic.status &&
            nextTopic.statusReason === topic.statusReason &&
            nextTopic.lastPreview === topic.lastPreview &&
            nextTopic.hasUnread === topic.hasUnread &&
            nextTopic.updatedAt?.getTime() === topic.updatedAt?.getTime();

          if (unchanged) {
            return topic;
          }

          changed = true;
          return nextTopic;
        });

        return changed ? nextTopics : prev;
      });
    },
    [],
  );

  return {
    sessionId,
    setSessionId,
    messages,
    setMessages: setMessagesState,
    threadTurns,
    setThreadTurns,
    threadItems,
    setThreadItems,
    currentTurnId,
    setCurrentTurnId,
    todoItems,
    childSubagentSessions,
    subagentParentContext,
    queuedTurns,
    threadRead,
    executionRuntime,
    setExecutionRuntime,
    setQueuedTurns,
    topics,
    setTopics,
    topicsReady,
    sessionHistoryWindow,
    isAutoRestoringSession,
    isSessionHydrating,
    isDetachedActiveSession: detachedSessionIdRef.current === sessionId,
    loadTopics,
    createFreshSession,
    ensureSession,
    switchTopic,
    prefetchTopic,
    loadFullSessionHistory,
    deleteTopic,
    renameTopic,
    refreshSessionDetail,
    refreshSessionReadModel,
    attemptSilentTurnRecovery,
    clearMessages,
    deleteMessage,
    editMessage,
    updateTopicExecutionStrategy,
    updateTopicSnapshot,
  };
}
