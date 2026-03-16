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
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
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

interface UseAgentSessionOptions {
  runtime: AgentRuntimeAdapter;
  workspaceId: string;
  disableSessionRestore: boolean;
  isInitialized: boolean;
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
    isInitialized,
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
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsReady, setTopicsReady] = useState(false);

  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);

  sessionIdRef.current = sessionId;

  const resetStreamingRefs = useCallback(() => {
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
  }, [currentAssistantMsgIdRef, currentStreamingSessionIdRef]);

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
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(scopedKeys.itemsKey, threadItems);
  }, [scopedKeys, threadItems, workspaceId]);

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

    if (!isInitialized) {
      return;
    }

    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    runtime
      .listSessions()
      .then((sessions) => {
        if (cancelled) {
          return;
        }
        const topicList =
          filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
        setTopics(topicList);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error("[AsterChat] 加载话题失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setTopicsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterSessionsByWorkspace, isInitialized, runtime, workspaceId]);

  const loadTopics = useCallback(async () => {
    if (!workspaceId?.trim()) {
      setTopics([]);
      setTopicsReady(true);
      return;
    }

    setTopicsReady(false);
    try {
      const sessions = await runtime.listSessions();
      const topicList =
        filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
      setTopics(topicList);
    } catch (error) {
      console.error("[AsterChat] 加载话题失败:", error);
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
        return newSessionId;
      } catch (error) {
        console.error("[AsterChat] 创建新任务失败:", error);
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
    [
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
      options?: { syncSessionId?: boolean },
    ) => {
      setMessages(hydrateSessionDetailMessages(detail, topicId));
      setThreadTurns(detail.turns || []);
      setThreadItems(detail.items || []);
      setQueuedTurns(normalizeQueuedTurnSnapshots(detail.queued_turns));
      setCurrentTurnId(
        detail.turns && detail.turns.length > 0
          ? detail.turns[detail.turns.length - 1]?.id || null
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
    [setExecutionStrategyState, topics],
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
        const detail = await runtime.getSession(topicId);
        const topicPreference = loadSessionModelPreference(topicId);

        applySessionDetail(topicId, detail, { syncSessionId: true });

        if (topicPreference) {
          applySessionModelPreference(topicId, topicPreference);
        }
      } catch (error) {
        console.error("[AsterChat] 切换话题失败:", error);
        console.error("[AsterChat] 错误详情:", JSON.stringify(error, null, 2));
        if (isAsterSessionNotFoundError(error)) {
          setMessages([]);
          setThreadTurns([]);
          setThreadItems([]);
          setCurrentTurnId(null);
          setQueuedTurns([]);
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

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (!isInitialized) return;
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
      return;
    }

    switchTopic(targetSessionId).catch((error) => {
      console.warn("[AsterChat] 自动恢复会话失败:", error);
      saveTransient(scopedKeys.currentSessionKey, null);
      savePersisted(scopedKeys.persistedSessionKey, null);
    });
  }, [
    isInitialized,
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
      setSessionId(null);
      setMessages([]);
      setThreadTurns([]);
      setThreadItems([]);
      setCurrentTurnId(null);
      setQueuedTurns([]);
      saveTransient(scopedKeys.currentSessionKey, null);
      savePersisted(scopedKeys.persistedSessionKey, null);
      hydratedSessionRef.current = null;
      return;
    }

    if (
      messages.length > 0 &&
      (threadTurns.length > 0 || threadItems.length > 0)
    ) {
      hydratedSessionRef.current = sessionId;
      return;
    }

    if (hydratedSessionRef.current === sessionId) {
      return;
    }

    hydratedSessionRef.current = sessionId;

    switchTopic(sessionId).catch((error) => {
      console.warn("[AsterChat] 会话水合失败:", error);
      hydratedSessionRef.current = null;
    });
  }, [
    messages.length,
    scopedKeys,
    sessionId,
    switchTopic,
    threadItems.length,
    threadTurns.length,
    topics,
    topicsReady,
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

          const nextTopic = {
            ...topic,
            ...snapshot,
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
    queuedTurns,
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
    clearMessages,
    deleteMessage,
    editMessage,
    updateTopicExecutionStrategy,
    updateTopicSnapshot,
  };
}
