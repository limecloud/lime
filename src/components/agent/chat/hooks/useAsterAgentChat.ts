/**
 * Aster Agent Chat Hook
 *
 * 当前事实源：
 * useAsterAgentChat -> useAgentContext / useAgentSession / useAgentTools / useAgentStream
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { parseAgentEvent } from "@/lib/api/agentProtocol";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  executeCodexSlashCommand,
  parseCodexSlashCommand,
} from "../commands";
import {
  defaultAgentRuntimeAdapter,
  type AgentRuntimeAdapter,
} from "./agentRuntimeAdapter";
import { useAgentContext } from "./useAgentContext";
import { useAgentSession } from "./useAgentSession";
import { useAgentTools } from "./useAgentTools";
import { useAgentStream } from "./useAgentStream";
import {
  buildLiveTaskSnapshot,
  type SendMessageFn,
  type UseAsterAgentChatOptions,
} from "./agentChatShared";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";

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
    runtimeAdapter,
    preserveRestoredMessages = false,
  } = options;
  const runtime = runtimeAdapter ?? defaultAgentRuntimeAdapter;

  const [isInitialized, setIsInitialized] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const currentStreamingEventNameRef = useRef<string | null>(null);
  const lastTopicSnapshotKeyRef = useRef<string | null>(null);
  const lastIsSendingRef = useRef(false);
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
    providerTypeRef: context.providerTypeRef,
    modelRef: context.modelRef,
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

  const sendMessage = useCallback<SendMessageFn>(
    async (
      content,
      images,
      webSearch,
      thinking,
      skipUserMessage,
      executionStrategyOverride,
      modelOverride,
      autoContinue,
      sendOptions,
    ) => {
      if (!skipUserMessage) {
        const parsedCodexCommand = parseCodexSlashCommand(content);
        if (parsedCodexCommand) {
          const effectiveModel =
            modelOverride?.trim() || context.modelRef.current;
          const effectiveExecutionStrategy =
            executionStrategyOverride || context.executionStrategy;
          const handled = await executeCodexSlashCommand({
            command: parsedCodexCommand,
            statusSnapshot: {
              sessionId: activeSessionId,
              currentTurnId,
              providerType: context.providerTypeRef.current,
              model: effectiveModel,
              executionStrategy: effectiveExecutionStrategy,
              queuedTurnsCount,
              isSending: isStreamSending,
            },
            sendPrompt: async (prompt) => {
              await rawSendMessage(
                prompt,
                images,
                webSearch,
                thinking,
                skipUserMessage,
                executionStrategyOverride,
                modelOverride,
                autoContinue,
                sendOptions,
              );
            },
            compactSession: compactCurrentSession,
            clearMessages: clearChatMessages,
            createFreshSession,
            appendAssistantMessage: appendLocalAssistantMessage,
            notifyInfo: (message) => toast.info(message),
            notifySuccess: (message) => toast.success(message),
          });
          if (handled) {
            return;
          }
        }
      }

      await rawSendMessage(
        content,
        images,
        webSearch,
        thinking,
        skipUserMessage,
        executionStrategyOverride,
        modelOverride,
        autoContinue,
        sendOptions,
      );
    },
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
  const currentSessionId = session.sessionId;
  const refreshActiveSessionDetail = session.refreshSessionDetail;

  useEffect(() => {
    logAgentDebug(
      "useAsterAgentChat",
      "stateSnapshot",
      {
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
      },
      {
        dedupeKey: JSON.stringify({
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
        }),
        throttleMs: 800,
      },
    );
  }, [
    context.workspacePathMissing,
    hasActiveTopic,
    session.messages.length,
    session.queuedTurns.length,
    session.sessionId,
    session.threadTurns.length,
    session.topics.length,
    stream.isSending,
    tools.pendingActions.length,
    workspaceId,
  ]);

  useEffect(() => {
    tools.warnedKeysRef.current.clear();
  }, [tools.warnedKeysRef, workspaceId]);

  useEffect(() => {
    const wasSending = lastIsSendingRef.current;
    lastIsSendingRef.current = stream.isSending;

    if (!wasSending || stream.isSending) {
      return;
    }

    const activeSessionId = currentSessionId;
    if (!activeSessionId) {
      return;
    }

    void refreshActiveSessionDetail(activeSessionId);
  }, [currentSessionId, refreshActiveSessionDetail, stream.isSending]);

  useEffect(() => {
    const refreshSessionDetail = session.refreshSessionDetail;
    const activeSessionId = session.sessionId;
    const queuedTurnCount = session.queuedTurns.length;
    const threadTurns = session.threadTurns;

    if (!activeSessionId || stream.isSending) {
      return;
    }

    const hasRecoveredQueueWork =
      queuedTurnCount > 0 ||
      threadTurns.some((turn) => turn.status === "running");
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
    const refreshSessionDetail = session.refreshSessionDetail;
    const parentSessionId =
      session.subagentParentContext?.parent_session_id?.trim() || null;

    if (!activeSessionId) {
      return;
    }

    const eventNames = [
      `agent_subagent_status:${activeSessionId}`,
      parentSessionId ? `agent_subagent_status:${parentSessionId}` : null,
    ].filter((value, index, values): value is string => {
      return Boolean(value) && values.indexOf(value) === index;
    });

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      for (const eventName of eventNames) {
        const unlisten = await runtime.listenToTeamEvents(
          eventName,
          (event) => {
            const data = parseAgentEvent(event.payload);
            if (disposed || data?.type !== "subagent_status_changed") {
              return;
            }
            if (sessionIdRef.current !== activeSessionId) {
              return;
            }
            void refreshSessionDetail(activeSessionId);
          },
        );
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [
    runtime,
    session.sessionId,
    session.refreshSessionDetail,
    session.subagentParentContext?.parent_session_id,
    sessionIdRef,
  ]);

  useEffect(() => {
    const activeSessionId = session.sessionId;
    const messages = session.messages;
    const queuedTurnCount = session.queuedTurns.length;
    const updateTopicSnapshot = session.updateTopicSnapshot;
    const pendingActionCount = tools.pendingActions.length;
    const workspacePathMissing = context.workspacePathMissing;

    if (!activeSessionId || !hasActiveTopic) {
      if (activeSessionId && !hasActiveTopic) {
        logAgentDebug(
          "useAsterAgentChat",
          "topicSnapshot.skipWithoutActiveTopic",
          {
            activeSessionId,
            topicsCount: session.topics.length,
            workspaceId,
          },
          { level: "warn", throttleMs: 1000 },
        );
      }
      lastTopicSnapshotKeyRef.current = null;
      return;
    }

    const snapshot = buildLiveTaskSnapshot({
      messages,
      isSending: stream.isSending,
      pendingActionCount,
      queuedTurnCount,
      workspaceError: Boolean(workspacePathMissing),
    });

    const snapshotKey = JSON.stringify({
      sessionId: activeSessionId,
      updatedAt: snapshot.updatedAt?.getTime() ?? null,
      messagesCount: snapshot.messagesCount,
      status: snapshot.status,
      statusReason: snapshot.statusReason ?? null,
      lastPreview: snapshot.lastPreview,
      hasUnread: snapshot.hasUnread,
    });

    if (lastTopicSnapshotKeyRef.current === snapshotKey) {
      logAgentDebug(
        "useAsterAgentChat",
        "topicSnapshot.skipDuplicate",
        {
          activeSessionId,
          snapshotKey,
        },
        { throttleMs: 1200 },
      );
      return;
    }

    lastTopicSnapshotKeyRef.current = snapshotKey;
    logAgentDebug("useAsterAgentChat", "topicSnapshot.apply", {
      activeSessionId,
      hasUnread: snapshot.hasUnread,
      messagesCount: snapshot.messagesCount,
      status: snapshot.status,
      statusReason: snapshot.statusReason ?? null,
      updatedAt: snapshot.updatedAt?.toISOString() ?? null,
    });
    updateTopicSnapshot(activeSessionId, snapshot);
  }, [
    hasActiveTopic,
    session.sessionId,
    session.messages,
    session.queuedTurns.length,
    session.topics.length,
    session.updateTopicSnapshot,
    stream.isSending,
    tools.pendingActions.length,
    context.workspacePathMissing,
    workspaceId,
  ]);

  const handleStartProcess = async () => {
    try {
      await runtime.init();
      setIsInitialized(true);
      console.log("[AsterChat] Agent 初始化成功");
    } catch (err) {
      setIsInitialized(false);
      console.error("[AsterChat] 初始化失败:", err);
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
