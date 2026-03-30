import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { parseAgentEvent, type AgentThreadItem, type AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AutoContinueRequestPayload,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import type { ActionRequired, Message } from "../types";
import { mapProviderName } from "./agentChatCoreUtils";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";

type MessageParts = NonNullable<Message["contentParts"]>;

interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface RegisterAgentStreamTurnEventBindingOptions {
  runtime: AgentRuntimeAdapter;
  eventName: string;
  requestState: StreamRequestState;
  skipUserMessage: boolean;
  effectiveProviderType: string;
  effectiveModel: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  content: string;
  webSearch?: boolean;
  autoContinue?: AutoContinueRequestPayload;
  expectingQueue: boolean;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  assistantMsgId: string;
  pendingTurnKey: string;
  pendingItemKey: string;
  effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>;
  warnedKeysRef: MutableRefObject<Set<string>>;
  actionLoggedKeys: Set<string>;
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
  observer?: StreamObserver;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  callbacks: {
    activateStream: (
      activeSessionId: string,
      effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>,
    ) => void;
    isStreamActivated: () => boolean;
    clearOptimisticItem: () => void;
    clearOptimisticTurn: () => void;
    disposeListener: () => void;
    removeQueuedDraftMessages: () => void;
    clearActiveStreamIfMatch: (eventName: string) => boolean;
    upsertQueuedTurn: (queuedTurn: QueuedTurnSnapshot) => void;
    removeQueuedTurnState: (queuedTurnIds: string[]) => void;
  };
  sounds: {
    playToolcallSound: () => void;
    playTypewriterSound: () => void;
  };
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AsterSessionExecutionRuntime | null>
  >;
  setIsSending: Dispatch<SetStateAction<boolean>>;
}

export async function registerAgentStreamTurnEventBinding(
  options: RegisterAgentStreamTurnEventBindingOptions,
) {
  const {
    runtime,
    eventName,
    requestState,
    skipUserMessage,
    effectiveProviderType,
    effectiveModel,
    effectiveExecutionStrategy,
    content,
    webSearch,
    autoContinue,
    expectingQueue,
    activeSessionId,
    resolvedWorkspaceId,
    assistantMsgId,
    pendingTurnKey,
    pendingItemKey,
    effectiveWaitingRuntimeStatus,
    warnedKeysRef,
    actionLoggedKeys,
    toolLogIdByToolId,
    toolStartedAtByToolId,
    toolNameByToolId,
    observer,
    onWriteFile,
    callbacks,
    sounds,
    appendThinkingToParts,
    setMessages,
    setPendingActions,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    setExecutionRuntime,
    setIsSending,
  } = options;

  requestState.requestStartedAt = Date.now();
  requestState.requestLogId = activityLogger.log({
    eventType: "chat_request_start",
    status: "pending",
    title: skipUserMessage ? "系统引导请求" : "发送请求",
    description: `模型: ${effectiveModel} · 策略: ${effectiveExecutionStrategy}`,
    workspaceId: resolvedWorkspaceId,
    sessionId: activeSessionId,
    source: "aster-chat",
    metadata: {
      provider: mapProviderName(effectiveProviderType),
      model: effectiveModel,
      executionStrategy: effectiveExecutionStrategy,
      contentLength: content.trim().length,
      skipUserMessage,
      autoContinueEnabled: autoContinue?.enabled ?? false,
      autoContinue: autoContinue?.enabled ? autoContinue : undefined,
      queuedSubmission: expectingQueue,
    },
  });

  return runtime.listenToTurnEvents(eventName, (event: { payload: unknown }) => {
    const data = parseAgentEvent(event.payload);
    if (!data) {
      return;
    }

    handleTurnStreamEvent({
      data,
      requestState,
      callbacks: {
        activateStream: () =>
          callbacks.activateStream(
            activeSessionId,
            effectiveWaitingRuntimeStatus,
          ),
        isStreamActivated: callbacks.isStreamActivated,
        clearOptimisticItem: callbacks.clearOptimisticItem,
        clearOptimisticTurn: callbacks.clearOptimisticTurn,
        disposeListener: callbacks.disposeListener,
        removeQueuedDraftMessages: callbacks.removeQueuedDraftMessages,
        clearActiveStreamIfMatch: callbacks.clearActiveStreamIfMatch,
        upsertQueuedTurn: callbacks.upsertQueuedTurn,
        removeQueuedTurnState: callbacks.removeQueuedTurnState,
        playToolcallSound: sounds.playToolcallSound,
        playTypewriterSound: sounds.playTypewriterSound,
        appendThinkingToParts,
      },
      observer,
      eventName,
      pendingTurnKey,
      pendingItemKey,
      assistantMsgId,
      activeSessionId,
      resolvedWorkspaceId,
      effectiveExecutionStrategy,
      content,
      runtime,
      webSearch,
      warnedKeysRef,
      actionLoggedKeys,
      toolLogIdByToolId,
      toolStartedAtByToolId,
      toolNameByToolId,
      onWriteFile,
      setMessages,
      setPendingActions,
      setThreadItems,
      setThreadTurns,
      setCurrentTurnId,
      setExecutionRuntime,
      setIsSending,
    });
  });
}
