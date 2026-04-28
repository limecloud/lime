import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
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
import { normalizeHistoryMessages } from "./agentChatHistory";
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
import { filterConversationThreadItems } from "../utils/threadTimelineView";
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
  refreshAgentSessionDetailState,
  refreshAgentSessionReadModelState,
} from "./agentSessionRefresh";
import type { AgentAccessMode } from "./agentChatStorage";
import { hasRecoverableSilentTurnActivity } from "./agentSilentTurnRecovery";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";

const INITIAL_TOPICS_IDLE_TIMEOUT_MS = 1_500;
const INITIAL_TOPICS_SESSION_REQUEST_LIMIT = 60;

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

export interface AgentSessionHistoryWindow {
  loadedMessages: number;
  totalMessages: number;
  isLoadingFull: boolean;
  error: string | null;
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

  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);
  const sessionSwitchRequestVersionRef = useRef(0);
  const deferredSessionHydrationCancelRef = useRef<(() => void) | null>(null);
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
  const executionRuntimeRef = useRef<AsterSessionExecutionRuntime | null>(
    executionRuntime,
  );
  const restoreCandidateSessionIdRef = useRef<string | null>(
    loadScopedSessionRestoreCandidate(),
  );

  sessionIdRef.current = sessionId;

  const resetStreamingRefs = useCallback(() => {
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
  }, [currentAssistantMsgIdRef, currentStreamingSessionIdRef]);

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
      if (detail.history_truncated !== true) {
        return null;
      }

      const loadedMessages = detail.messages.length;
      const totalMessages = Math.max(
        loadedMessages,
        typeof detail.messages_count === "number" &&
          Number.isFinite(detail.messages_count)
          ? Math.trunc(detail.messages_count)
          : loadedMessages,
      );

      if (totalMessages <= loadedMessages) {
        return null;
      }

      return {
        loadedMessages,
        totalMessages,
        isLoadingFull: false,
        error: null,
      };
    },
    [],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    saveTransient(scopedKeys.messagesKey, messages);
  }, [messages, scopedKeys, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (
      !resolvedWorkspaceId ||
      sessionStateWorkspaceRef.current !== resolvedWorkspaceId
    ) {
      return;
    }
    saveTransient(scopedKeys.turnsKey, threadTurns);
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
    saveTransient(scopedKeys.itemsKey, threadItems);
  }, [scopedKeys, threadItems, workspaceId]);

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
    saveAgentSessionCachedSnapshot(resolvedWorkspaceId, resolvedSessionId, {
      messages,
      threadTurns,
      threadItems,
      currentTurnId,
    }, {
      sessionUpdatedAt: activeTopic?.updatedAt ?? Date.now(),
      messagesCount: totalMessages,
      historyTruncated:
        (sessionHistoryWindow?.totalMessages ?? totalMessages) >
        (sessionHistoryWindow?.loadedMessages ?? messages.length),
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
    async (sessionName?: string): Promise<string | null> => {
      if (createFreshSessionPromiseRef.current) {
        return createFreshSessionPromiseRef.current;
      }

      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        toast.error("缺少项目工作区，请先选择项目");
        return null;
      }

      const creationPromise = (async () => {
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
          );

          sessionIdRef.current = newSessionId;

          const now = new Date();
          setSessionId(newSessionId);
          setSessionHistoryWindow(null);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setQueuedTurns([]);
          setThreadRead(null);
          setTodoItems([]);
          setChildSubagentSessions([]);
          setSubagentParentContext(null);
          setIsAutoRestoringSession(false);
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

          persistSessionModelPreference(
            newSessionId,
            providerTypeRef.current,
            modelRef.current,
          );
          persistSessionAccessMode(newSessionId, accessMode);
          markSessionExecutionStrategySynced(newSessionId, executionStrategy);
          persistSessionRestoreCandidate(newSessionId);
          saveTransient(scopedKeys.messagesKey, []);
          saveTransient(scopedKeys.turnsKey, []);
          saveTransient(scopedKeys.itemsKey, []);
          saveTransient(scopedKeys.currentTurnKey, null);

          logAgentDebug("useAgentSession", "createFreshSession.success", {
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

      const trackCreationPromise = (promise: Promise<string | null>) =>
        promise.finally(() => {
          if (createFreshSessionPromiseRef.current === promise) {
            createFreshSessionPromiseRef.current = null;
          }
        });

      const trackedCreationPromise = trackCreationPromise(creationPromise);

      createFreshSessionPromiseRef.current = trackedCreationPromise;
      return trackedCreationPromise;
    },
    [
      accessMode,
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
      sessionIdRef,
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

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  const editMessage = useCallback((id: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, content: newContent } : msg,
      ),
    );
  }, []);

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
      logAgentDebug("useAgentSession", "switchTopic.cachedSnapshotApplied", {
        cacheFreshness: metadata?.freshness ?? null,
        cacheStorageKind: metadata?.storageKind ?? null,
        cachedMessagesCount: cachedSnapshot.messages.length,
        cachedThreadItemsCount: cachedSnapshot.threadItems.length,
        cachedTurnsCount: cachedSnapshot.threadTurns.length,
        topicId,
        workspaceId,
      });
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

  const loadRuntimeSessionDetail = useCallback(
    async (params: {
      topicId: string;
      startedAt: number;
      mode: "direct" | "deferred";
      resumeSessionStartHooks?: boolean;
    }) => {
      const {
        topicId,
        startedAt,
        mode,
        resumeSessionStartHooks = false,
      } = params;
      const requestStartedAt = Date.now();
      logAgentDebug("useAgentSession", "switchTopic.fetchDetail.start", {
        elapsedBeforeRequestMs: requestStartedAt - startedAt,
        mode,
        resumeSessionStartHooks,
        topicId,
        workspaceId,
      });

      try {
        const detail = resumeSessionStartHooks
          ? await runtime.getSession(topicId, {
              resumeSessionStartHooks: true,
            })
          : await runtime.getSession(topicId);
        logAgentDebug("useAgentSession", "switchTopic.fetchDetail.success", {
          itemsCount: detail.items?.length ?? 0,
          messagesCount: detail.messages.length,
          mode,
          queuedTurnsCount: detail.queued_turns?.length ?? 0,
          requestDurationMs: Date.now() - requestStartedAt,
          resumeSessionStartHooks,
          topicId,
          totalElapsedMs: Date.now() - startedAt,
          turnsCount: detail.turns?.length ?? 0,
          workspaceId,
        });
        return detail;
      } catch (error) {
        logAgentDebug(
          "useAgentSession",
          "switchTopic.fetchDetail.error",
          {
            error,
            mode,
            requestDurationMs: Date.now() - requestStartedAt,
            resumeSessionStartHooks,
            topicId,
            totalElapsedMs: Date.now() - startedAt,
            workspaceId,
          },
          { level: "error" },
        );
        throw error;
      }
    },
    [runtime, workspaceId],
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

      if (sessionSwitchRequestVersionRef.current !== switchRequestVersion) {
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
      const knownWorkspaceId =
        runtimeWorkspaceId || topicWorkspaceId || shadowWorkspaceId;

      if (
        resolvedWorkspaceId &&
        knownWorkspaceId &&
        knownWorkspaceId !== resolvedWorkspaceId
      ) {
        console.warn("[AsterChat] 检测到跨工作区会话恢复，已忽略", {
          topicId,
          currentWorkspaceId: resolvedWorkspaceId,
          knownWorkspaceId,
        });
        applySessionSnapshot(createEmptyAgentSessionSnapshot());
        setSessionHistoryWindow(null);
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
        restoredWorkspaceRef.current = null;
        skipAutoRestoreRef.current = false;
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
        runtimeExecutionStrategy || topicExecutionStrategy
          ? null
          : persistedExecutionStrategy
            ? resolvePersistedExecutionStrategy(workspaceId)
            : null;
      const topicPreference =
        runtimePreference || loadSessionModelPreference(topicId);
      const shadowAccessMode = loadSessionAccessMode(topicId);

      persistSessionRestoreCandidate(topicId);
      hydratedSessionRef.current = topicId;
      const applyResolvedDetail = () => {
        applySessionDetail(topicId, detail, {
          localSnapshotOverride,
          syncSessionId: true,
          executionStrategyOverride:
            runtimeExecutionStrategy ||
            topicExecutionStrategy ||
            shadowExecutionStrategyFallback ||
            "react",
        });
      };

      if (useTransition) {
        startTransition(applyResolvedDetail);
      } else {
        applyResolvedDetail();
      }
      setSessionHistoryWindow(resolveSessionHistoryWindow(detail));
      setTopics((prev) =>
        upsertTopicFromSessionDetail(
          prev,
          mapSessionDetailToTopic(
            topicId,
            detail,
            runtimeWorkspaceId || knownWorkspaceId || resolvedWorkspaceId,
          ),
        ),
      );

      if (runtimeExecutionStrategy) {
        markSessionExecutionStrategySynced(topicId, runtimeExecutionStrategy);
      }

      if (runtimeAccessMode) {
        setAccessModeState(runtimeAccessMode);
        persistSessionAccessMode(topicId, runtimeAccessMode);
      } else if (shadowAccessMode) {
        setAccessModeState(shadowAccessMode);
        void runtime
          .setSessionAccessMode?.(topicId, shadowAccessMode)
          .catch((error) => {
            console.warn(
              "[AsterChat] 迁移会话 accessMode fallback 失败:",
              error,
            );
          });
      } else {
        const workspaceDefaultAccessMode =
          resolvePersistedAccessMode(workspaceId);
        setAccessModeState(workspaceDefaultAccessMode);
        persistSessionAccessMode(topicId, workspaceDefaultAccessMode);
        void runtime
          .setSessionAccessMode?.(topicId, workspaceDefaultAccessMode)
          .catch((error) => {
            console.warn("[AsterChat] 回填会话默认 accessMode 失败:", error);
          });
      }

      logAgentDebug("useAgentSession", "switchTopic.success", {
        durationMs: Date.now() - startedAt,
        executionStrategySource: runtimeExecutionStrategy
          ? "session_detail"
          : topicExecutionStrategy
            ? "topics_snapshot"
            : shadowExecutionStrategyFallback
              ? "shadow_cache"
              : "default",
        itemsCount: detail.items?.length ?? 0,
        messagesCount: detail.messages.length,
        modelPreferenceSource: runtimePreference
          ? "execution_runtime"
          : topicPreference
            ? "session_storage"
            : null,
        accessModeSource: runtimeAccessMode
          ? "execution_runtime"
          : shadowAccessMode
            ? "session_storage"
            : "workspace_default",
        queuedTurnsCount: detail.queued_turns?.length ?? 0,
        topicId,
        turnsCount: detail.turns?.length ?? 0,
        workspaceId,
      });

      const persistedWorkspaceId = runtimeWorkspaceId || resolvedWorkspaceId;
      if (persistedWorkspaceId) {
        savePersistedSessionWorkspaceId(topicId, persistedWorkspaceId);
      }

      if (runtimeWorkspaceId) {
        setTopics((prev) =>
          prev.map((topic) =>
            topic.id === topicId
              ? { ...topic, workspaceId: runtimeWorkspaceId }
              : topic,
          ),
        );
      }

      if (topicPreference) {
        applySessionModelPreference(topicId, topicPreference);
        if (!runtimePreference) {
          void runtime
            .setSessionProviderSelection(
              topicId,
              topicPreference.providerType,
              topicPreference.model,
            )
            .then(() => {
              markSessionModelPreferenceSynced(
                topicId,
                topicPreference.providerType,
                topicPreference.model,
              );
            })
            .catch((error) => {
              console.warn(
                "[AsterChat] 迁移会话 provider/model fallback 失败:",
                error,
              );
            });
        }
      }

      if (shadowExecutionStrategyFallback) {
        void runtime
          .setSessionExecutionStrategy(topicId, shadowExecutionStrategyFallback)
          .then(() => {
            markSessionExecutionStrategySynced(
              topicId,
              shadowExecutionStrategyFallback,
            );
            setTopics((prev) =>
              prev.map((topic) =>
                topic.id === topicId
                  ? {
                      ...topic,
                      executionStrategy: shadowExecutionStrategyFallback,
                    }
                  : topic,
              ),
            );
          })
          .catch((error) => {
            console.warn(
              "[AsterChat] 迁移会话 executionStrategy fallback 失败:",
              error,
            );
          });
      }

      setIsAutoRestoringSession(false);
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
      console.error("[AsterChat] 切换话题失败:", error);
      console.error("[AsterChat] 错误详情:", JSON.stringify(error, null, 2));
      logAgentDebug(
        "useAgentSession",
        "switchTopic.error",
        {
          error,
          topicId,
          workspaceId,
        },
        { level: "error" },
      );

      if (isAsterSessionNotFoundError(error)) {
        applySessionSnapshot(createEmptyAgentSessionSnapshot());
        setSessionHistoryWindow(null);
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
        void loadTopics();
        setIsAutoRestoringSession(false);
        return;
      }

      if (!options?.preserveCurrentSnapshot) {
        applySessionSnapshot(createEmptyAgentSessionSnapshot());
        setSessionHistoryWindow(null);
        persistSessionRestoreCandidate(null);
        hydratedSessionRef.current = null;
      }

      setIsAutoRestoringSession(false);
      toast.error(
        `加载对话历史失败: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      if (options?.restoreSource !== "auto") {
        setIsAutoRestoringSession(false);
      }
      try {
        const startedAt = Date.now();
        const selectedTopic = topics.find((topic) => topic.id === topicId);
        const cachedTargetSnapshot =
          currentSessionId && currentSessionId === topicId
            ? null
            : loadAgentSessionCachedSnapshot(workspaceId, topicId, {
                topicUpdatedAt: selectedTopic?.updatedAt ?? null,
                messagesCount: selectedTopic?.messagesCount ?? null,
              });
        const cachedSnapshotMetadata = cachedTargetSnapshot?.cacheMetadata;
        const shouldRefreshCachedSnapshotImmediately =
          cachedSnapshotMetadata?.freshness === "stale" ||
          selectedTopic?.status === "running" ||
          selectedTopic?.status === "waiting";
        logAgentDebug("useAgentSession", "switchTopic.start", {
          cacheFreshness: cachedSnapshotMetadata?.freshness ?? null,
          cacheStorageKind: cachedSnapshotMetadata?.storageKind ?? null,
          cachedLocalMessagesCount: cachedTargetSnapshot?.messages.length ?? 0,
          currentSessionId,
          messagesCount: messages.length,
          refreshCachedSnapshotImmediately:
            shouldRefreshCachedSnapshotImmediately,
          topicId,
          workspaceId,
        });
        if (currentSessionId !== topicId) {
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
          logAgentDebug("useAgentSession", "switchTopic.deferHydration", {
            cacheFreshness: cachedSnapshotMetadata?.freshness ?? null,
            cacheStorageKind: cachedSnapshotMetadata?.storageKind ?? null,
            cachedLocalMessagesCount:
              cachedTargetSnapshot?.messages.length ?? 0,
            currentSessionId,
            refreshImmediately: shouldRefreshCachedSnapshotImmediately,
            topicId,
            workspaceId,
          });
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
                    cachedTargetSnapshot &&
                    sessionIdRef.current === topicId &&
                    messagesRef.current === cachedTargetSnapshot.messages &&
                    threadTurnsRef.current ===
                      cachedTargetSnapshot.threadTurns &&
                    threadItemsRef.current === cachedTargetSnapshot.threadItems
                      ? {
                          sessionId: topicId,
                          messages: cachedTargetSnapshot.messages,
                          threadTurns: cachedTargetSnapshot.threadTurns,
                          threadItems: cachedTargetSnapshot.threadItems,
                        }
                      : null,
                  switchRequestVersion,
                  useTransition: true,
                });
              } catch (error) {
                if (
                  sessionSwitchRequestVersionRef.current !==
                  switchRequestVersion
                ) {
                  return;
                }
                handleSwitchTopicError(error, topicId, {
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
                minimumDelayMs: 0,
                idleTimeoutMs: 1_500,
              });
          }
          return;
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
          localSnapshotOverride:
            cachedTargetSnapshot &&
            sessionIdRef.current === topicId &&
            messagesRef.current === cachedTargetSnapshot.messages &&
            threadTurnsRef.current === cachedTargetSnapshot.threadTurns &&
            threadItemsRef.current === cachedTargetSnapshot.threadItems
              ? {
                  sessionId: topicId,
                  messages: cachedTargetSnapshot.messages,
                  threadTurns: cachedTargetSnapshot.threadTurns,
                  threadItems: cachedTargetSnapshot.threadItems,
                }
              : null,
          switchRequestVersion,
        });
      } catch (error) {
        handleSwitchTopicError(error, topicId);
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
      invalidatePendingSessionSwitches,
      persistSessionModelPreference,
      persistSessionRestoreCandidate,
      providerTypeRef,
      sessionIdRef,
      topics,
      workspaceId,
    ],
  );

  const loadFullSessionHistory = useCallback(async () => {
    const targetSessionId = sessionIdRef.current?.trim();
    if (!targetSessionId) {
      return false;
    }

    const switchRequestVersion = sessionSwitchRequestVersionRef.current;
    const startedAt = Date.now();
    setSessionHistoryWindow((current) =>
      current
        ? { ...current, isLoadingFull: true, error: null }
        : {
            loadedMessages: messagesRef.current.length,
            totalMessages: messagesRef.current.length,
            isLoadingFull: true,
            error: null,
          },
    );
    logAgentDebug("useAgentSession", "loadFullHistory.start", {
      loadedMessagesCount: messagesRef.current.length,
      sessionId: targetSessionId,
      workspaceId,
    });

    try {
      const detail = await runtime.getSession(targetSessionId, {
        historyLimit: 0,
      });
      if (
        sessionIdRef.current !== targetSessionId ||
        sessionSwitchRequestVersionRef.current !== switchRequestVersion
      ) {
        return false;
      }

      const applied = finalizeResolvedTopicDetail({
        topicId: targetSessionId,
        detail,
        startedAt,
        switchRequestVersion,
        useTransition: true,
      });
      setSessionHistoryWindow(null);
      logAgentDebug("useAgentSession", "loadFullHistory.success", {
        durationMs: Date.now() - startedAt,
        messagesCount: detail.messages.length,
        sessionId: targetSessionId,
        workspaceId,
      });
      return applied;
    } catch (error) {
      if (sessionIdRef.current !== targetSessionId) {
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
          sessionId: targetSessionId,
          workspaceId,
        },
        { level: "error" },
      );
      toast.error(`加载完整历史失败: ${message}`);
      return false;
    }
  }, [finalizeResolvedTopicDetail, runtime, sessionIdRef, workspaceId]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }

    const restoreCandidate = restoreCandidateSessionIdRef.current?.trim();
    if (!disableSessionRestore && restoreCandidate) {
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

    return createFreshSession();
  }, [
    createFreshSession,
    disableSessionRestore,
    sessionIdRef,
    switchTopic,
    topics,
  ]);

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
        const detail = await runtime.getSession(resolvedSessionId);
        if (sessionIdRef.current !== resolvedSessionId) {
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
        .getSession(sessionId)
        .then((detail) => {
          if (sessionIdRef.current !== sessionId) {
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

          if (sessionIdRef.current !== sessionId) {
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
    setMessages,
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
    isDetachedActiveSession: detachedSessionIdRef.current === sessionId,
    loadTopics,
    createFreshSession,
    ensureSession,
    switchTopic,
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
