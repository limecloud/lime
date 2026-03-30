/**
 * Aster Agent Chat Hook
 *
 * 当前事实源：
 * useAsterAgentChat -> useAgentContext / useAgentSession / useAgentTools / useAgentStream
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import {
  defaultAgentRuntimeAdapter,
  type AgentRuntimeAdapter,
} from "./agentRuntimeAdapter";
import { createAgentChatSendMessage } from "./agentChatSendMessage";
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
  const activeExecutionRuntime = useMemo<
    AsterSessionExecutionRuntime | null
  >(() => {
    const threadStatus = session.threadRead?.status;
    const shouldPreferRuntime =
      stream.isSending || threadStatus === "running" || threadStatus === "queued";
    return shouldPreferRuntime ? session.executionRuntime : null;
  }, [session.executionRuntime, session.threadRead?.status, stream.isSending]);

  useAgentRuntimeSyncEffects({
    runtime,
    sessionIdRef,
    sessionId: session.sessionId,
    parentSessionId: session.subagentParentContext?.parent_session_id,
    isSending: stream.isSending,
    queuedTurnCount: session.queuedTurns.length,
    threadTurns: session.threadTurns,
    refreshSessionDetail: session.refreshSessionDetail,
  });

  useAgentTopicSnapshot({
    sessionId: session.sessionId,
    hasActiveTopic,
    messages: session.messages,
    isSending: stream.isSending,
    pendingActionCount: tools.pendingActions.length,
    queuedTurnCount: session.queuedTurns.length,
    workspaceId,
    workspacePathMissing: Boolean(context.workspacePathMissing),
    topicsCount: session.topics.length,
    updateTopicSnapshot: session.updateTopicSnapshot,
  });

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

  const warmupRuntime = useCallback(async () => {
    if (runtimeWarmupPromiseRef.current) {
      await runtimeWarmupPromiseRef.current;
      return;
    }

    const warmupPromise = runtime
      .init()
      .then(() => {
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
  }, [runtime]);

  useEffect(() => {
    if (!workspaceId.trim()) {
      setIsInitialized(false);
      return;
    }

    void warmupRuntime().catch(() => undefined);
  }, [warmupRuntime, workspaceId]);

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
