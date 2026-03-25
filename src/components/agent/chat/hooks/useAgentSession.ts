import {
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
import { normalizeQueuedTurnSnapshots } from "@/lib/api/queuedTurn";
import {
  isAsterSessionNotFoundError,
  resolveRestorableSessionId,
} from "@/lib/asterSessionRecovery";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  mapSessionToTopic,
  type ClearMessagesOptions,
  type SessionModelPreference,
  type Topic,
} from "./agentChatShared";
import {
  hydrateSessionDetailMessages,
  mergeHydratedMessagesWithLocalState,
  normalizeHistoryMessages,
} from "./agentChatHistory";
import { getAgentSessionScopedKeys } from "./agentSessionScopedStorage";
import {
  loadPersisted,
  loadPersistedString,
  loadTransient,
  savePersisted,
  saveTransient,
} from "./agentChatStorage";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  mergeThreadItems,
  mergeThreadTurns,
} from "../utils/threadTimelineView";
import {
  createExecutionRuntimeFromSessionDetail,
  createSessionModelPreferenceFromExecutionRuntime,
} from "../utils/sessionExecutionRuntime";

interface UseAgentSessionOptions {
  runtime: AgentRuntimeAdapter;
  workspaceId: string;
  disableSessionRestore: boolean;
  preserveRestoredMessages: boolean;
  executionStrategy: AsterExecutionStrategy;
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
  filterSessionsByWorkspace: <T extends { id: string }>(sessions: T[]) => T[];
  setExecutionStrategyState: (
    executionStrategy: AsterExecutionStrategy,
  ) => void;
}

export function useAgentSession(options: UseAgentSessionOptions) {
  const {
    runtime,
    workspaceId,
    disableSessionRestore,
    preserveRestoredMessages,
    executionStrategy,
    providerTypeRef,
    modelRef,
    sessionIdRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    resetPendingActions,
    persistSessionModelPreference,
    loadSessionModelPreference,
    applySessionModelPreference,
    filterSessionsByWorkspace,
    setExecutionStrategyState,
  } = options;
  const scopedKeys = useMemo(
    () => getAgentSessionScopedKeys(workspaceId),
    [workspaceId],
  );

  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (disableSessionRestore || !workspaceId?.trim()) {
      return null;
    }

    const scopedSessionId = loadTransient<string | null>(
      `aster_curr_sessionId_${workspaceId.trim()}`,
      null,
    );
    if (scopedSessionId) {
      return scopedSessionId;
    }

    return loadPersisted<string | null>(
      `aster_last_sessionId_${workspaceId.trim()}`,
      null,
    );
  });
  const [messages, setMessages] = useState<Message[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : loadTransient<Message[]>(`aster_messages_${workspaceId.trim()}`, []),
  );
  const [threadTurns, setThreadTurns] = useState<AgentThreadTurn[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : loadTransient<AgentThreadTurn[]>(
          `aster_thread_turns_${workspaceId.trim()}`,
          [],
        ),
  );
  const [threadItems, setThreadItems] = useState<AgentThreadItem[]>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? []
      : loadTransient<AgentThreadItem[]>(
          `aster_thread_items_${workspaceId.trim()}`,
          [],
        ),
  );
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(() =>
    disableSessionRestore || !workspaceId?.trim()
      ? null
      : loadTransient<string | null>(
          `aster_curr_turnId_${workspaceId.trim()}`,
          null,
        ),
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

  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);
  const missingSessionVerificationRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const threadTurnsRef = useRef<AgentThreadTurn[]>(threadTurns);
  const threadItemsRef = useRef<AgentThreadItem[]>(threadItems);

  sessionIdRef.current = sessionId;

  const resetStreamingRefs = useCallback(() => {
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
  }, [currentAssistantMsgIdRef, currentStreamingSessionIdRef]);

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
    if (!resolvedWorkspaceId) {
      return;
    }

    const scopedSessionKey = scopedKeys.currentSessionKey;
    const scopedPersistedSessionKey = scopedKeys.persistedSessionKey;

    saveTransient(scopedSessionKey, sessionId);
    savePersisted(scopedPersistedSessionKey, sessionId);

    if (sessionId) {
      const sessionWorkspaceKey = `agent_session_workspace_${sessionId}`;
      const existingWorkspaceId = loadPersistedString(sessionWorkspaceKey);

      if (
        existingWorkspaceId &&
        existingWorkspaceId !== "__invalid__" &&
        existingWorkspaceId !== resolvedWorkspaceId
      ) {
        console.warn("[AsterChat] 检测到会话与工作区映射冲突，跳过覆盖", {
          sessionId,
          existingWorkspaceId,
          currentWorkspaceId: resolvedWorkspaceId,
        });
      } else {
        savePersisted(sessionWorkspaceKey, resolvedWorkspaceId);
      }
    }
  }, [scopedKeys, sessionId, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(scopedKeys.messagesKey, messages);
  }, [messages, scopedKeys, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(scopedKeys.turnsKey, threadTurns);
  }, [scopedKeys, threadTurns, workspaceId]);

  useEffect(() => {
    threadTurnsRef.current = threadTurns;
  }, [threadTurns]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(scopedKeys.itemsKey, threadItems);
  }, [scopedKeys, threadItems, workspaceId]);

  useEffect(() => {
    threadItemsRef.current = threadItems;
  }, [threadItems]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(scopedKeys.currentTurnKey, currentTurnId);
  }, [currentTurnId, scopedKeys, workspaceId]);

  useEffect(() => {
    if (disableSessionRestore || !workspaceId?.trim()) {
      setSessionId(null);
      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      setQueuedTurns([]);
      setThreadRead(null);
      setExecutionRuntime(null);
      setTodoItems([]);
      setChildSubagentSessions([]);
      setSubagentParentContext(null);
      resetPendingActions();
      resetStreamingRefs();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = disableSessionRestore;
      return;
    }

    const scopedSessionId =
      loadTransient<string | null>(scopedKeys.currentSessionKey, null) ??
      loadPersisted<string | null>(scopedKeys.persistedSessionKey, null);

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

    setSessionId(scopedSessionId);
    setMessages(scopedMessages);
    setThreadTurns(scopedTurns);
    setThreadItems(scopedItems);
    setCurrentTurnId(scopedCurrentTurnId);
    setQueuedTurns([]);
    setThreadRead(null);
    setExecutionRuntime(null);
    setTodoItems([]);
    setChildSubagentSessions([]);
    setSubagentParentContext(null);
    resetPendingActions();
    resetStreamingRefs();
    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = false;
  }, [
    disableSessionRestore,
    resetPendingActions,
    resetStreamingRefs,
    scopedKeys,
    workspaceId,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    const startedAt = Date.now();
    logAgentDebug("useAgentSession", "listSessions.start", {
      workspaceId,
    });
    runtime
      .listSessions()
      .then((sessions) => {
        if (cancelled) {
          return;
        }
        const topicList =
          filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
        logAgentDebug("useAgentSession", "listSessions.success", {
          durationMs: Date.now() - startedAt,
          sessionsCount: sessions.length,
          topicsCount: topicList.length,
          workspaceId,
        });
        setTopics(topicList);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error("[AsterChat] 加载话题失败:", error);
        logAgentDebug(
          "useAgentSession",
          "listSessions.error",
          {
            durationMs: Date.now() - startedAt,
            error,
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

    return () => {
      cancelled = true;
    };
  }, [filterSessionsByWorkspace, runtime, workspaceId]);

  const loadTopics = useCallback(async () => {
    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    const startedAt = Date.now();
    logAgentDebug("useAgentSession", "loadTopics.start", {
      workspaceId,
    });
    try {
      const sessions = await runtime.listSessions();
      const topicList =
        filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
      logAgentDebug("useAgentSession", "loadTopics.success", {
        durationMs: Date.now() - startedAt,
        sessionsCount: sessions.length,
        topicsCount: topicList.length,
        workspaceId,
      });
      setTopics(topicList);
    } catch (error) {
      console.error("[AsterChat] 加载话题失败:", error);
      logAgentDebug(
        "useAgentSession",
        "loadTopics.error",
        {
          durationMs: Date.now() - startedAt,
          error,
          workspaceId,
        },
        { level: "error" },
      );
    } finally {
      setTopicsReady(true);
    }
  }, [filterSessionsByWorkspace, runtime, workspaceId]);

  const createFreshSession = useCallback(
    async (sessionName?: string): Promise<string | null> => {
      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        toast.error("缺少项目工作区，请先选择项目");
        return null;
      }

      try {
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

        const now = new Date();
        setSessionId(newSessionId);
        setThreadTurns([]);
        setThreadItems([]);
        setCurrentTurnId(null);
        setQueuedTurns([]);
        setThreadRead(null);
        setTodoItems([]);
        setChildSubagentSessions([]);
        setSubagentParentContext(null);
        setTopics((prev) => [
          {
            id: newSessionId,
            title: sessionName?.trim() || "新任务",
            createdAt: now,
            updatedAt: now,
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
        skipAutoRestoreRef.current = false;
        restoredWorkspaceRef.current = resolvedWorkspaceId;

        persistSessionModelPreference(
          newSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
        saveTransient(scopedKeys.currentSessionKey, newSessionId);
        savePersisted(scopedKeys.persistedSessionKey, newSessionId);
        saveTransient(scopedKeys.messagesKey, []);
        saveTransient(scopedKeys.turnsKey, []);
        saveTransient(scopedKeys.itemsKey, []);
        saveTransient(scopedKeys.currentTurnKey, null);

        void loadTopics();
        logAgentDebug("useAgentSession", "createFreshSession.success", {
          newSessionId,
          sessionName: sessionName?.trim() || null,
          workspaceId: resolvedWorkspaceId,
        });
        return newSessionId;
      } catch (error) {
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
    },
    [
      executionStrategy,
      loadTopics,
      modelRef,
      persistSessionModelPreference,
      providerTypeRef,
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      scopedKeys,
      workspaceId,
    ],
  );

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    return createFreshSession();
  }, [createFreshSession, sessionIdRef]);

  const clearMessages = useCallback(
    (options: ClearMessagesOptions = {}) => {
      const { showToast = true, toastMessage = "新任务已创建" } = options;

      const scopedSessionKey = scopedKeys.currentSessionKey;
      const scopedPersistedSessionKey = scopedKeys.persistedSessionKey;
      const scopedMessagesKey = scopedKeys.messagesKey;

      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      setQueuedTurns([]);
      setThreadRead(null);
      setTodoItems([]);
      setChildSubagentSessions([]);
      setSubagentParentContext(null);
      setSessionId(null);
      resetPendingActions();
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = true;
      resetStreamingRefs();

      saveTransient(scopedSessionKey, null);
      savePersisted(scopedPersistedSessionKey, null);
      saveTransient(scopedMessagesKey, []);
      saveTransient(scopedKeys.turnsKey, []);
      saveTransient(scopedKeys.itemsKey, []);
      saveTransient(scopedKeys.currentTurnKey, null);

      if (showToast) {
        toast.success(toastMessage);
      }
    },
    [resetPendingActions, resetStreamingRefs, scopedKeys],
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

  const applyRuntimeReadModel = useCallback(
    (
      detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
      options?: { preserveExecutionRuntimeOnMissingDetail?: boolean },
    ) => {
      const nextExecutionRuntime = createExecutionRuntimeFromSessionDetail(detail);
      setQueuedTurns(normalizeQueuedTurnSnapshots(detail.queued_turns));
      setThreadRead(detail.thread_read ?? null);
      setExecutionRuntime((current) => {
        if (
          options?.preserveExecutionRuntimeOnMissingDetail &&
          !nextExecutionRuntime
        ) {
          return current;
        }
        return nextExecutionRuntime;
      });
      setTodoItems(detail.todo_items ?? []);
      setChildSubagentSessions(detail.child_subagent_sessions ?? []);
      setSubagentParentContext(detail.subagent_parent_context ?? null);
    },
    [],
  );

  const applySessionDetail = useCallback(
    (
      topicId: string,
      detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
      options?: { syncSessionId?: boolean },
    ) => {
      const hydratedMessages = hydrateSessionDetailMessages(detail, topicId);
      const incomingTurns = detail.turns || [];
      const incomingItems = detail.items || [];
      const shouldPreserveExistingTimeline = sessionIdRef.current === topicId;
      const nextMessages = shouldPreserveExistingTimeline
        ? mergeHydratedMessagesWithLocalState(
            messagesRef.current,
            hydratedMessages,
          )
        : hydratedMessages;
      const nextTurns = shouldPreserveExistingTimeline
        ? mergeThreadTurns(threadTurnsRef.current, incomingTurns)
        : incomingTurns;
      const nextItems = shouldPreserveExistingTimeline
        ? mergeThreadItems(threadItemsRef.current, incomingItems)
        : incomingItems;
      const shouldPreserveExecutionRuntimeOnMissingDetail =
        shouldPreserveExistingTimeline && !options?.syncSessionId;

      setMessages(nextMessages);
      setThreadTurns(nextTurns);
      setThreadItems(nextItems);
      applyRuntimeReadModel(detail, {
        preserveExecutionRuntimeOnMissingDetail:
          shouldPreserveExecutionRuntimeOnMissingDetail,
      });
      setCurrentTurnId(
        nextTurns.length > 0
          ? nextTurns[nextTurns.length - 1]?.id || null
          : null,
      );

      const selectedTopic = topics.find((topic) => topic.id === topicId);
      setExecutionStrategyState(
        normalizeExecutionStrategy(
          detail.execution_strategy || selectedTopic?.executionStrategy,
        ),
      );

      if (options?.syncSessionId) {
        setSessionId(topicId);
      }
    },
    [applyRuntimeReadModel, sessionIdRef, setExecutionStrategyState, topics],
  );

  const switchTopic = useCallback(
    async (topicId: string) => {
      if (topicId === sessionIdRef.current && messages.length > 0) return;

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
      }

      skipAutoRestoreRef.current = false;
      try {
        const startedAt = Date.now();
        logAgentDebug("useAgentSession", "switchTopic.start", {
          currentSessionId,
          messagesCount: messages.length,
          topicId,
          workspaceId,
        });
        const detail = await runtime.getSession(topicId);
        const runtimePreference =
          createSessionModelPreferenceFromExecutionRuntime(
            detail.execution_runtime,
          );
        const topicPreference =
          runtimePreference || loadSessionModelPreference(topicId);

        applySessionDetail(topicId, detail, { syncSessionId: true });
        logAgentDebug("useAgentSession", "switchTopic.success", {
          durationMs: Date.now() - startedAt,
          itemsCount: detail.items?.length ?? 0,
          messagesCount: detail.messages.length,
          modelPreferenceSource: runtimePreference
            ? "execution_runtime"
            : topicPreference
              ? "session_storage"
              : null,
          queuedTurnsCount: detail.queued_turns?.length ?? 0,
          topicId,
          turnsCount: detail.turns?.length ?? 0,
          workspaceId,
        });

        if (topicPreference) {
          applySessionModelPreference(topicId, topicPreference);
        }
      } catch (error) {
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
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setQueuedTurns([]);
          setThreadRead(null);
          setExecutionRuntime(null);
          setTodoItems([]);
          setChildSubagentSessions([]);
          setSubagentParentContext(null);
          setSessionId(null);
          saveTransient(scopedKeys.currentSessionKey, null);
          savePersisted(scopedKeys.persistedSessionKey, null);
          void loadTopics();
          return;
        }
        setMessages([]);
        setThreadTurns([]);
        setThreadItems([]);
        setCurrentTurnId(null);
        setQueuedTurns([]);
        setThreadRead(null);
        setExecutionRuntime(null);
        setTodoItems([]);
        setChildSubagentSessions([]);
        setSubagentParentContext(null);
        setSessionId(null);
        saveTransient(scopedKeys.currentSessionKey, null);
        savePersisted(scopedKeys.persistedSessionKey, null);
        toast.error(
          `加载对话历史失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [
      applySessionDetail,
      applySessionModelPreference,
      loadSessionModelPreference,
      loadTopics,
      messages.length,
      modelRef,
      persistSessionModelPreference,
      providerTypeRef,
      runtime,
      scopedKeys,
      sessionIdRef,
      workspaceId,
    ],
  );

  const refreshSessionDetail = useCallback(
    async (targetSessionId?: string) => {
      const resolvedSessionId = targetSessionId || sessionIdRef.current;
      if (!resolvedSessionId?.trim()) {
        return false;
      }

      try {
        const detail = await runtime.getSession(resolvedSessionId);
        if (sessionIdRef.current !== resolvedSessionId) {
          return false;
        }
        applySessionDetail(resolvedSessionId, detail);
        return true;
      } catch (error) {
        console.warn("[AsterChat] 刷新会话详情失败:", error);
        return false;
      }
    },
    [applySessionDetail, runtime, sessionIdRef],
  );

  const refreshSessionReadModel = useCallback(
    async (targetSessionId?: string) => {
      const resolvedSessionId = targetSessionId || sessionIdRef.current;
      if (!resolvedSessionId?.trim()) {
        return false;
      }

      try {
        const threadRead = await runtime.getSessionReadModel(resolvedSessionId);
        if (sessionIdRef.current !== resolvedSessionId) {
          return false;
        }
        setQueuedTurns(normalizeQueuedTurnSnapshots(threadRead?.queued_turns));
        setThreadRead(threadRead ?? null);
        return true;
      } catch (error) {
        console.warn("[AsterChat] 刷新运行态摘要失败:", error);
        return false;
      }
    },
    [runtime, sessionIdRef],
  );

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (disableSessionRestore) return;
    if (!topicsReady) return;
    if (skipAutoRestoreRef.current) return;
    if (sessionId) return;
    if (topics.length === 0) return;
    if (restoredWorkspaceRef.current === resolvedWorkspaceId) return;

    restoredWorkspaceRef.current = resolvedWorkspaceId;

    const scopedCandidate =
      loadTransient<string | null>(scopedKeys.currentSessionKey, null) ||
      loadPersisted<string | null>(scopedKeys.persistedSessionKey, null);
    const targetSessionId = resolveRestorableSessionId({
      candidateSessionId: scopedCandidate,
      sessions: topics.map((topic) => ({
        id: topic.id,
        createdAt: Math.floor(topic.createdAt.getTime() / 1000),
        updatedAt: Math.floor(topic.updatedAt.getTime() / 1000),
      })),
    });
    if (!targetSessionId) {
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

    logAgentDebug("useAgentSession", "autoRestore.start", {
      candidateSessionId: scopedCandidate,
      targetSessionId,
      topicsCount: topics.length,
      workspaceId: resolvedWorkspaceId,
    });
    switchTopic(targetSessionId).catch((error) => {
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
      saveTransient(scopedKeys.currentSessionKey, null);
      savePersisted(scopedKeys.persistedSessionKey, null);
    });
  }, [
    disableSessionRestore,
    sessionId,
    scopedKeys,
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

    if (topics.length > 0 && !topics.some((topic) => topic.id === sessionId)) {
      const shouldVerifyMissingSession =
        currentTurnId !== null ||
        threadTurns.length > 0 ||
        threadItems.length > 0 ||
        queuedTurns.length > 0;

      if (!shouldVerifyMissingSession) {
        setSessionId(null);
        setMessages([]);
        setThreadTurns([]);
        setThreadItems([]);
        setCurrentTurnId(null);
        setQueuedTurns([]);
        setThreadRead(null);
        setTodoItems([]);
        setChildSubagentSessions([]);
        setSubagentParentContext(null);
        saveTransient(scopedKeys.currentSessionKey, null);
        savePersisted(scopedKeys.persistedSessionKey, null);
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
                id: detail.id,
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

          setSessionId(null);
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setQueuedTurns([]);
          setThreadRead(null);
          setExecutionRuntime(null);
          setTodoItems([]);
          setChildSubagentSessions([]);
          setSubagentParentContext(null);
          saveTransient(scopedKeys.currentSessionKey, null);
          savePersisted(scopedKeys.persistedSessionKey, null);
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

    if (
      messages.length > 0 &&
      (threadTurns.length > 0 || threadItems.length > 0)
    ) {
      hydratedSessionRef.current = sessionId;
      return;
    }

    if (preserveRestoredMessages && messages.length > 0) {
      hydratedSessionRef.current = sessionId;
      return;
    }

    if (hydratedSessionRef.current === sessionId) {
      return;
    }

    hydratedSessionRef.current = sessionId;
    logAgentDebug("useAgentSession", "hydrateSession.start", {
      messagesCount: messages.length,
      sessionId,
      threadItemsCount: threadItems.length,
      threadTurnsCount: threadTurns.length,
      workspaceId,
    });

    switchTopic(sessionId).catch((error) => {
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
    queuedTurns.length,
    runtime,
    scopedKeys,
    sessionId,
    sessionIdRef,
    switchTopic,
    threadItems.length,
    threadTurns.length,
    topics,
    topicsReady,
    workspaceId,
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
          setSessionId(null);
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setQueuedTurns([]);
          setThreadRead(null);
          setExecutionRuntime(null);
          setTodoItems([]);
          setChildSubagentSessions([]);
          setSubagentParentContext(null);
          resetPendingActions();
          resetStreamingRefs();
          hydratedSessionRef.current = null;
          restoredWorkspaceRef.current = null;
          saveTransient(scopedKeys.currentSessionKey, null);
          savePersisted(scopedKeys.persistedSessionKey, null);
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
      resetPendingActions,
      resetStreamingRefs,
      runtime,
      scopedKeys,
      sessionIdRef,
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
    loadTopics,
    createFreshSession,
    ensureSession,
    switchTopic,
    deleteTopic,
    renameTopic,
    refreshSessionDetail,
    refreshSessionReadModel,
    clearMessages,
    deleteMessage,
    editMessage,
    updateTopicExecutionStrategy,
    updateTopicSnapshot,
  };
}
