/**
 * Aster Agent Chat Hook
 *
 * 当前事实源：
 * useAsterAgentChat -> useAgentContext / useAgentSession / useAgentTools / useAgentStream
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { getDefaultProvider } from "@/lib/api/appConfig";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import {
  defaultAgentRuntimeAdapter,
  type AgentRuntimeAdapter,
} from "./agentRuntimeAdapter";
import { createAgentChatSendMessage } from "./agentChatSendMessage";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_PROVIDER,
} from "./agentChatStorage";
import { useAgentChatStateSnapshotDebug } from "./useAgentChatStateSnapshotDebug";
import { useAgentContext } from "./useAgentContext";
import { useAgentRuntimeSyncEffects } from "./useAgentRuntimeSyncEffects";
import { useAgentSession } from "./useAgentSession";
import { useAgentTools } from "./useAgentTools";
import { useAgentStream } from "./useAgentStream";
import {
  type SendMessageFn,
  type UseAsterAgentChatOptions,
} from "./agentChatShared";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";
import { useAgentTopicSnapshot } from "./useAgentTopicSnapshot";
import { resolveClawWorkspaceProviderSelection } from "../utils/clawWorkspaceProviderSelection";

export type { Topic } from "./agentChatShared";

type UseAsterAgentChatRuntimeOptions = UseAsterAgentChatOptions & {
  runtimeAdapter?: AgentRuntimeAdapter;
  preserveRestoredMessages?: boolean;
};

export function useAsterAgentChat(options: UseAsterAgentChatRuntimeOptions) {
  const {
    systemPrompt,
    onWriteFile,
    workspaceId,
    disableSessionRestore = false,
    initialTopicsLoadMode = "immediate",
    initialTopicsDeferredDelayMs,
    getSyncedSessionRecentPreferences,
    runtimeAdapter,
    preserveRestoredMessages = false,
  } = options;
  const runtime = runtimeAdapter ?? defaultAgentRuntimeAdapter;

  const [isInitialized, setIsInitialized] = useState(false);
  const runtimeWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const currentStreamingEventNameRef = useRef<string | null>(null);
  const autoTitleInFlightSessionIdRef = useRef<string | null>(null);
  const autoTitleCompletedSessionIdsRef = useRef<Set<string>>(new Set());
  const sendMessageRef = useRef<SendMessageFn | null>(null);
  const resetPendingActionsRef = useRef<(() => void) | null>(null);
  const topicsUpdaterRef = useRef<
    | ((sessionId: string, executionStrategy: AsterExecutionStrategy) => void)
    | null
  >(null);

  const resetPendingActions = useCallback(() => {
    resetPendingActionsRef.current?.();
  }, []);

  const context = useAgentContext({
    workspaceId,
    sessionIdRef,
    topicsUpdaterRef,
    sendMessageRef,
    runtime,
  });

  const session = useAgentSession({
    runtime,
    workspaceId,
    disableSessionRestore,
    initialTopicsLoadMode,
    initialTopicsDeferredDelayMs,
    preserveRestoredMessages,
    executionStrategy: context.executionStrategy,
    accessMode: context.accessMode,
    providerTypeRef: context.providerTypeRef,
    modelRef: context.modelRef,
    sessionIdRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    resetPendingActions,
    persistSessionModelPreference: context.persistSessionModelPreference,
    loadSessionModelPreference: context.loadSessionModelPreference,
    applySessionModelPreference: context.applySessionModelPreference,
    markSessionModelPreferenceSynced: context.markSessionModelPreferenceSynced,
    markSessionExecutionStrategySynced:
      context.markSessionExecutionStrategySynced,
    persistSessionAccessMode: context.persistSessionAccessMode,
    loadSessionAccessMode: context.loadSessionAccessMode,
    filterSessionsByWorkspace: context.filterSessionsByWorkspace,
    setExecutionStrategyState: context.setExecutionStrategyState,
    setAccessModeState: context.setAccessModeState,
  });
  const applyWorkspaceModelPreference = context.applyWorkspaceModelPreference;

  const tools = useAgentTools({
    runtime,
    sessionIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
    messages: session.messages,
    setMessages: session.setMessages,
    setThreadItems: session.setThreadItems,
    refreshSessionReadModel: session.refreshSessionReadModel,
  });

  resetPendingActionsRef.current = () => tools.setPendingActions([]);

  const stream = useAgentStream({
    runtime,
    systemPrompt,
    onWriteFile,
    ensureSession: session.ensureSession,
    attemptSilentTurnRecovery: session.attemptSilentTurnRecovery,
    sessionIdRef,
    executionStrategy: context.executionStrategy,
    accessMode: context.accessMode,
    providerTypeRef: context.providerTypeRef,
    modelRef: context.modelRef,
    getSyncedSessionModelPreference: context.getSyncedSessionModelPreference,
    getSyncedSessionExecutionStrategy:
      context.getSyncedSessionExecutionStrategy,
    getSyncedSessionRecentPreferences,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
    warnedKeysRef: tools.warnedKeysRef,
    getRequiredWorkspaceId: context.getRequiredWorkspaceId,
    setWorkspacePathMissing: context.setWorkspacePathMissing,
    setMessages: session.setMessages,
    setThreadItems: session.setThreadItems,
    setThreadTurns: session.setThreadTurns,
    setCurrentTurnId: session.setCurrentTurnId,
    setExecutionRuntime: session.setExecutionRuntime,
    threadBusy:
      session.threadRead?.status === "running" ||
      session.threadRead?.status === "queued" ||
      session.threadTurns.some((turn) => turn.status === "running"),
    queuedTurns: session.queuedTurns,
    setQueuedTurns: session.setQueuedTurns,
    setPendingActions: tools.setPendingActions,
    refreshSessionReadModel: session.refreshSessionReadModel,
    executionRuntime: session.executionRuntime,
  });
  const setChatMessages = session.setMessages;
  const clearChatMessages = session.clearMessages;
  const createFreshSession = session.createFreshSession;
  const currentTurnId = session.currentTurnId;
  const activeSessionId = session.sessionId;
  const queuedTurnsCount = session.queuedTurns.length;
  const rawSendMessage = stream.sendMessage;
  const compactCurrentSession = stream.compactSession;
  const isStreamSending = stream.isSending;

  const appendLocalAssistantMessage = useCallback(
    (content: string) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          timestamp: new Date(),
        },
      ]);
    },
    [setChatMessages],
  );

  const sendMessage = useMemo<SendMessageFn>(
    () =>
      createAgentChatSendMessage({
        baseStatusSnapshot: {
          sessionId: activeSessionId,
          currentTurnId,
          providerType: context.providerTypeRef.current,
          model: context.modelRef.current,
          executionStrategy: context.executionStrategy,
          queuedTurnsCount,
          isSending: isStreamSending,
        },
        rawSendMessage,
        compactSession: compactCurrentSession,
        clearMessages: clearChatMessages,
        createFreshSession,
        appendAssistantMessage: appendLocalAssistantMessage,
        notifyInfo: (message) => toast.info(message),
        notifySuccess: (message) => toast.success(message),
      }),
    [
      appendLocalAssistantMessage,
      activeSessionId,
      clearChatMessages,
      compactCurrentSession,
      context.executionStrategy,
      context.modelRef,
      context.providerTypeRef,
      createFreshSession,
      currentTurnId,
      isStreamSending,
      queuedTurnsCount,
      rawSendMessage,
    ],
  );

  sendMessageRef.current = sendMessage;
  topicsUpdaterRef.current = session.updateTopicExecutionStrategy;

  const hasActiveTopic = Boolean(
    session.sessionId &&
    session.topics.some((topic) => topic.id === session.sessionId),
  );
  const activeExecutionRuntime =
    useMemo<AsterSessionExecutionRuntime | null>(() => {
      const threadStatus = session.threadRead?.status;
      const shouldPreferRuntime =
        stream.isSending ||
        threadStatus === "running" ||
        threadStatus === "queued";
      return shouldPreferRuntime ? session.executionRuntime : null;
    }, [
      session.executionRuntime,
      session.threadRead?.status,
      stream.isSending,
    ]);

  useAgentRuntimeSyncEffects({
    runtime,
    sessionIdRef,
    sessionId: session.sessionId,
    parentSessionId: session.subagentParentContext?.parent_session_id,
    isSending: stream.isSending,
    threadReadStatus: session.threadRead?.status,
    queuedTurnCount: session.queuedTurns.length,
    threadTurns: session.threadTurns,
    refreshSessionDetail: session.refreshSessionDetail,
  });

  useAgentTopicSnapshot({
    sessionId: session.sessionId,
    hasActiveTopic,
    suppressInactiveTopicWarning: session.isDetachedActiveSession === true,
    messages: session.messages,
    isSending: stream.isSending,
    pendingActionCount: tools.pendingActions.length,
    queuedTurnCount: session.queuedTurns.length,
    threadStatus:
      session.threadRead?.status ?? (session.currentTurnId ? "running" : null),
    workspaceId,
    workspacePathMissing: Boolean(context.workspacePathMissing),
    topicsCount: session.topics.length,
    updateTopicSnapshot: session.updateTopicSnapshot,
  });

  const sessionMessages = session.messages;
  const sessionTopics = session.topics;
  const sessionSetTopics = session.setTopics;
  const currentSessionId = session.sessionId;

  useEffect(() => {
    const activeSessionId = currentSessionId?.trim();
    if (!activeSessionId || stream.isSending || !runtime.generateSessionTitle) {
      return;
    }

    const activeTopic = sessionTopics.find(
      (topic) => topic.id === activeSessionId,
    );
    if (!activeTopic) {
      return;
    }
    const activeTitle = activeTopic?.title?.trim() || "";
    const shouldAutoGenerateTitle =
      activeTitle === "" ||
      activeTitle === "新任务" ||
      activeTitle === "新话题";
    if (!shouldAutoGenerateTitle) {
      autoTitleCompletedSessionIdsRef.current.add(activeSessionId);
      return;
    }

    const hasUserMessage = sessionMessages.some(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    );
    if (!hasUserMessage) {
      return;
    }

    if (
      autoTitleCompletedSessionIdsRef.current.has(activeSessionId) ||
      autoTitleInFlightSessionIdRef.current === activeSessionId
    ) {
      return;
    }

    autoTitleInFlightSessionIdRef.current = activeSessionId;
    let cancelled = false;
    let titleApplied = false;

    void (async () => {
      try {
        const generatedTitle = (
          await runtime.generateSessionTitle?.(activeSessionId)
        )?.trim();
        if (
          cancelled ||
          !generatedTitle ||
          generatedTitle === "新任务" ||
          generatedTitle === "新话题"
        ) {
          return;
        }

        await runtime.renameSession(activeSessionId, generatedTitle);
        sessionSetTopics((previous) =>
          previous.map((topic) =>
            topic.id === activeSessionId
              ? {
                  ...topic,
                  title: generatedTitle,
                }
              : topic,
          ),
        );
        titleApplied = true;
      } catch (error) {
        console.warn("[AsterChat] 自动生成会话标题失败:", error);
      } finally {
        if (!cancelled && titleApplied) {
          autoTitleCompletedSessionIdsRef.current.add(activeSessionId);
        }
        if (autoTitleInFlightSessionIdRef.current === activeSessionId) {
          autoTitleInFlightSessionIdRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentSessionId,
    runtime,
    sessionMessages,
    sessionSetTopics,
    sessionTopics,
    stream.isSending,
  ]);

  useAgentChatStateSnapshotDebug({
    hasActiveTopic,
    isSending: stream.isSending,
    messagesCount: session.messages.length,
    pendingActionsCount: tools.pendingActions.length,
    queuedTurnsCount: session.queuedTurns.length,
    sessionId: session.sessionId ?? null,
    threadTurnsCount: session.threadTurns.length,
    topicsCount: session.topics.length,
    workspaceId,
    workspacePathMissing: context.workspacePathMissing,
  });

  useEffect(() => {
    tools.warnedKeysRef.current.clear();
  }, [tools.warnedKeysRef, workspaceId]);

  const resolveWarmupWorkspaceModelPreference = useCallback(
    async (status?: {
      provider_configured?: boolean;
      provider_name?: string;
      provider_selector?: string;
      model_name?: string;
    }) => {
      if (sessionIdRef.current) {
        return;
      }

      if (
        status?.provider_configured &&
        (status.provider_selector?.trim() || status.provider_name?.trim()) &&
        status.model_name?.trim()
      ) {
        applyWorkspaceModelPreference({
          providerType:
            status.provider_selector?.trim() || status.provider_name!.trim(),
          model: status.model_name.trim(),
        });
        return;
      }

      try {
        const currentProviderType = context.providerTypeRef.current.trim();
        const currentModel = context.modelRef.current.trim();
        const isUsingFrontendDefaultModel =
          currentProviderType === DEFAULT_AGENT_PROVIDER &&
          currentModel === DEFAULT_AGENT_MODEL;
        const defaultProvider = isUsingFrontendDefaultModel
          ? (await getDefaultProvider()).trim()
          : "";
        const fallbackProviderType = isUsingFrontendDefaultModel
          ? defaultProvider
          : currentProviderType;
        const resolvedSelection = await resolveClawWorkspaceProviderSelection({
          currentProviderType:
            fallbackProviderType || defaultProvider || undefined,
          currentModel: isUsingFrontendDefaultModel ? null : currentModel,
          theme: "general",
        });

        if (!resolvedSelection) {
          return;
        }

        applyWorkspaceModelPreference({
          providerType: resolvedSelection.providerType,
          model: resolvedSelection.model,
        });
      } catch (error) {
        console.warn("[AsterChat] 预热阶段解析工作区模型失败:", error);
      }
    },
    [applyWorkspaceModelPreference, context.modelRef, context.providerTypeRef],
  );

  const warmupRuntime = useCallback(async () => {
    if (runtimeWarmupPromiseRef.current) {
      await runtimeWarmupPromiseRef.current;
      return;
    }

    const warmupPromise = runtime
      .init()
      .then(async (status) => {
        await resolveWarmupWorkspaceModelPreference(status);
        setIsInitialized(true);
        console.log("[AsterChat] Agent 初始化成功");
      })
      .catch((err) => {
        setIsInitialized(false);
        console.error("[AsterChat] 初始化失败:", err);
        throw err;
      })
      .finally(() => {
        runtimeWarmupPromiseRef.current = null;
      });

    runtimeWarmupPromiseRef.current = warmupPromise;
    await warmupPromise;
  }, [resolveWarmupWorkspaceModelPreference, runtime]);

  useEffect(() => {
    if (!workspaceId.trim()) {
      setIsInitialized(false);
      return;
    }

    if (initialTopicsLoadMode === "deferred") {
      return scheduleMinimumDelayIdleTask(
        () => {
          void warmupRuntime().catch(() => undefined);
        },
        {
          minimumDelayMs: initialTopicsDeferredDelayMs ?? 0,
        },
      );
    }

    void warmupRuntime().catch(() => undefined);
  }, [
    initialTopicsDeferredDelayMs,
    initialTopicsLoadMode,
    warmupRuntime,
    workspaceId,
  ]);

  const handleStartProcess = async () => {
    try {
      await warmupRuntime();
    } catch {
      return;
    }
  };

  const handleStopProcess = async () => {
    session.clearMessages({ showToast: false });
  };

  return {
    processStatus: { running: isInitialized },
    handleStartProcess,
    handleStopProcess,

    providerType: context.providerType,
    setProviderType: context.setProviderType,
    model: context.model,
    setModel: context.setModel,
    executionStrategy: context.executionStrategy,
    setExecutionStrategy: context.setExecutionStrategy,
    accessMode: context.accessMode,
    setAccessMode: context.setAccessMode,
    providerConfig: {},
    isConfigLoading: false,

    messages: session.messages,
    setMessages: session.setMessages,
    currentThreadId: session.sessionId,
    currentTurnId: session.currentTurnId,
    turns: session.threadTurns,
    threadItems: session.threadItems,
    todoItems: session.todoItems,
    childSubagentSessions: session.childSubagentSessions,
    subagentParentContext: session.subagentParentContext,
    queuedTurns: session.queuedTurns,
    threadRead: session.threadRead,
    executionRuntime: session.executionRuntime,
    activeExecutionRuntime,
    isSending: stream.isSending,
    sendMessage,
    compactSession: stream.compactSession,
    stopSending: stream.stopSending,
    resumeThread: stream.resumeThread,
    replayPendingAction: tools.replayPendingAction,
    promoteQueuedTurn: stream.promoteQueuedTurn,
    removeQueuedTurn: stream.removeQueuedTurn,
    clearMessages: session.clearMessages,
    deleteMessage: session.deleteMessage,
    editMessage: session.editMessage,
    handlePermissionResponse: tools.handlePermissionResponse,
    triggerAIGuide: context.triggerAIGuide,

    topics: session.topics,
    isAutoRestoringSession: session.isAutoRestoringSession,
    sessionId: session.sessionId,
    createFreshSession: session.createFreshSession,
    ensureSession: session.ensureSession,
    switchTopic: session.switchTopic,
    deleteTopic: session.deleteTopic,
    renameTopic: session.renameTopic,
    loadTopics: session.loadTopics,
    updateTopicSnapshot: session.updateTopicSnapshot,

    pendingActions: tools.pendingActions,
    submittedActionsInFlight: tools.submittedActionsInFlight,
    confirmAction: tools.confirmAction,

    workspacePathMissing: context.workspacePathMissing,
    fixWorkspacePathAndRetry: context.fixWorkspacePathAndRetry,
    dismissWorkspacePathError: context.dismissWorkspacePathError,
  };
}
