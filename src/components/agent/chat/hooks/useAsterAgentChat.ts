/**
 * Aster Agent Chat Hook
 *
 * 当前事实源：
 * useAsterAgentChat -> useAgentContext / useAgentSession / useAgentTools / useAgentStream
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { defaultAgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { useAgentContext } from "./useAgentContext";
import { useAgentSession } from "./useAgentSession";
import { useAgentTools } from "./useAgentTools";
import { useAgentStream } from "./useAgentStream";
import {
  buildLiveTaskSnapshot,
  type SendMessageFn,
  type UseAsterAgentChatOptions,
} from "./agentChatShared";

export type { Topic } from "./agentChatShared";

export function useAsterAgentChat(options: UseAsterAgentChatOptions) {
  const { systemPrompt, onWriteFile, workspaceId, disableSessionRestore = false } =
    options;
  const runtime = defaultAgentRuntimeAdapter;

  const [isInitialized, setIsInitialized] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
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
    isInitialized,
    executionStrategy: context.executionStrategy,
    providerTypeRef: context.providerTypeRef,
    modelRef: context.modelRef,
    sessionIdRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    resetPendingActions,
    persistSessionModelPreference: context.persistSessionModelPreference,
    loadSessionModelPreference: context.loadSessionModelPreference,
    applySessionModelPreference: context.applySessionModelPreference,
    filterSessionsByWorkspace: context.filterSessionsByWorkspace,
    setExecutionStrategyState: context.setExecutionStrategyState,
  });

  const tools = useAgentTools({
    runtime,
    sessionIdRef,
    currentStreamingSessionIdRef,
    setMessages: session.setMessages,
    setThreadItems: session.setThreadItems,
  });

  resetPendingActionsRef.current = () => tools.setPendingActions([]);

  const stream = useAgentStream({
    runtime,
    systemPrompt,
    onWriteFile,
    ensureSession: session.ensureSession,
    sessionIdRef,
    executionStrategy: context.executionStrategy,
    providerTypeRef: context.providerTypeRef,
    modelRef: context.modelRef,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    warnedKeysRef: tools.warnedKeysRef,
    getRequiredWorkspaceId: context.getRequiredWorkspaceId,
    setWorkspacePathMissing: context.setWorkspacePathMissing,
    setMessages: session.setMessages,
    setThreadItems: session.setThreadItems,
    setThreadTurns: session.setThreadTurns,
    setCurrentTurnId: session.setCurrentTurnId,
    queuedTurns: session.queuedTurns,
    setQueuedTurns: session.setQueuedTurns,
    setPendingActions: tools.setPendingActions,
  });

  sendMessageRef.current = stream.sendMessage;
  topicsUpdaterRef.current = session.updateTopicExecutionStrategy;

  useEffect(() => {
    tools.warnedKeysRef.current.clear();
  }, [tools.warnedKeysRef, workspaceId]);

  useEffect(() => {
    const init = async () => {
      try {
        await runtime.init();
        setIsInitialized(true);
        console.log("[AsterChat] Agent 初始化成功");
      } catch (err) {
        console.error("[AsterChat] 初始化失败:", err);
      }
    };
    init();
  }, [runtime]);

  useEffect(() => {
    const refreshSessionDetail = session.refreshSessionDetail;
    const activeSessionId = session.sessionId;
    const queuedTurnCount = session.queuedTurns.length;
    const threadTurns = session.threadTurns;

    if (!activeSessionId || stream.isSending) {
      return;
    }

    const hasRecoveredQueueWork =
      queuedTurnCount > 0 || threadTurns.some((turn) => turn.status === "running");
    if (!hasRecoveredQueueWork) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSessionDetail(activeSessionId);
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    session.queuedTurns.length,
    session.refreshSessionDetail,
    session.sessionId,
    session.threadTurns,
    stream.isSending,
  ]);

  useEffect(() => {
    const activeSessionId = session.sessionId;
    const messages = session.messages;
    const queuedTurnCount = session.queuedTurns.length;
    const updateTopicSnapshot = session.updateTopicSnapshot;
    const pendingActionCount = tools.pendingActions.length;
    const workspacePathMissing = context.workspacePathMissing;

    if (!activeSessionId) {
      return;
    }

    const hasActiveTopic = session.topics.some(
      (topic) => topic.id === activeSessionId,
    );
    if (!hasActiveTopic) {
      return;
    }

    const snapshot = buildLiveTaskSnapshot({
      messages,
      isSending: stream.isSending,
      pendingActionCount,
      queuedTurnCount,
      workspaceError: Boolean(workspacePathMissing),
    });

    updateTopicSnapshot(activeSessionId, snapshot);
  }, [
    session.sessionId,
    session.messages,
    session.queuedTurns.length,
    session.topics,
    session.updateTopicSnapshot,
    stream.isSending,
    tools.pendingActions.length,
    context.workspacePathMissing,
  ]);

  const handleStartProcess = async () => {
    // Aster 不需要显式启动独立进程，初始化在 effect 中完成。
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
    providerConfig: {},
    isConfigLoading: false,

    messages: session.messages,
    currentThreadId: session.sessionId,
    currentTurnId: session.currentTurnId,
    turns: session.threadTurns,
    threadItems: session.threadItems,
    queuedTurns: session.queuedTurns,
    isSending: stream.isSending,
    sendMessage: stream.sendMessage,
    stopSending: stream.stopSending,
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
    confirmAction: tools.confirmAction,

    workspacePathMissing: context.workspacePathMissing,
    fixWorkspacePathAndRetry: context.fixWorkspacePathAndRetry,
    dismissWorkspacePathError: context.dismissWorkspacePathError,
  };
}
