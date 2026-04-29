import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  parseAgentEvent,
  type AgentEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
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
const STREAM_FIRST_EVENT_TIMEOUT_MS = 12_000;
const STREAM_FIRST_EVENT_TIMEOUT_MESSAGE =
  "执行已中断：运行时未返回任何进度事件，请重试。";
const STREAM_INACTIVITY_TIMEOUT_MS = 120_000; // 2 分钟，兼容推理模型长时间思考
const STREAM_INACTIVITY_TIMEOUT_MESSAGE =
  "执行已中断：运行时长时间没有返回新进度，请重试。";

interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface RegisterAgentStreamTurnEventBindingOptions {
  runtime: AgentRuntimeAdapter;
  eventName: string;
  requestState: StreamRequestState;
  attemptSilentTurnRecovery?: (
    sessionId: string,
    requestStartedAt: number,
    promptText: string,
  ) => Promise<boolean>;
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

function extractRuntimeEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" && type.trim() ? type : null;
}

export async function registerAgentStreamTurnEventBinding(
  options: RegisterAgentStreamTurnEventBindingOptions,
) {
  const {
    runtime,
    eventName,
    requestState,
    attemptSilentTurnRecovery,
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

  let firstEventReceived = false;
  let lastEventReceivedAt = 0;
  const warnedUnknownEventTypes = new Set<string>();
  let inactivityWatchdogId: ReturnType<typeof setTimeout> | null = null;
  const clearInactivityWatchdog = () => {
    if (inactivityWatchdogId) {
      clearTimeout(inactivityWatchdogId);
      inactivityWatchdogId = null;
    }
  };
  function deferFirstEventTimeoutAfterSubmission() {
    if (
      firstEventReceived ||
      requestState.requestFinished ||
      !requestState.submissionDispatchedAt
    ) {
      return false;
    }

    firstEventReceived = true;
    lastEventReceivedAt = Date.now();
    callbacks.activateStream(activeSessionId, effectiveWaitingRuntimeStatus);
    scheduleInactivityWatchdog();
    return true;
  }

  let firstEventWatchdogId: ReturnType<typeof setTimeout> | null =
    globalThis.setTimeout(() => {
      firstEventWatchdogId = null;
      if (firstEventReceived || requestState.requestFinished) {
        return;
      }
      void (async () => {
        const recovered = await tryRecoverSilentTurn();
        if (firstEventReceived || requestState.requestFinished) {
          return;
        }
        if (recovered) {
          console.warn(
            `[AsterChat] 首个运行时事件静默，已降级切换为会话快照同步: ${eventName}`,
          );
          finalizeSilentTurnRecovery();
          return;
        }
        if (deferFirstEventTimeoutAfterSubmission()) {
          console.warn(
            `[AsterChat] 首个运行时事件暂未到达，已基于提交派发继续等待后续进度: ${eventName}`,
          );
          return;
        }
        firstEventReceived = true;
        dispatchSyntheticError(STREAM_FIRST_EVENT_TIMEOUT_MESSAGE);
      })();
    }, STREAM_FIRST_EVENT_TIMEOUT_MS);

  const clearFirstEventWatchdog = () => {
    if (firstEventWatchdogId) {
      clearTimeout(firstEventWatchdogId);
      firstEventWatchdogId = null;
    }
  };
  const disposeListenerWithWatchdogs = () => {
    clearFirstEventWatchdog();
    clearInactivityWatchdog();
    callbacks.disposeListener();
  };
  const finalizeSilentTurnRecovery = () => {
    firstEventReceived = true;
    callbacks.clearActiveStreamIfMatch(eventName);
    disposeListenerWithWatchdogs();
    setIsSending(false);
  };
  const tryRecoverSilentTurn = async () => {
    if (!attemptSilentTurnRecovery) {
      return false;
    }
    return await attemptSilentTurnRecovery(
      activeSessionId,
      requestState.requestStartedAt,
      content,
    );
  };
  const dispatchSyntheticError = (message: string) => {
    handleTurnStreamEvent({
      data: {
        type: "error",
        message,
      } as AgentEvent,
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
        disposeListener: disposeListenerWithWatchdogs,
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
  };
  const scheduleInactivityWatchdog = () => {
    clearInactivityWatchdog();
    if (
      !firstEventReceived ||
      requestState.requestFinished ||
      !callbacks.isStreamActivated()
    ) {
      return;
    }

    inactivityWatchdogId = globalThis.setTimeout(() => {
      inactivityWatchdogId = null;
      if (requestState.requestFinished || !callbacks.isStreamActivated()) {
        return;
      }
      const timeoutStartedAt = Date.now();
      void (async () => {
        const recovered = await tryRecoverSilentTurn();
        if (
          requestState.requestFinished ||
          !callbacks.isStreamActivated() ||
          lastEventReceivedAt > timeoutStartedAt
        ) {
          return;
        }
        if (recovered) {
          console.warn(
            `[AsterChat] 运行时事件静默，已降级切换为会话快照同步: ${eventName}`,
          );
          finalizeSilentTurnRecovery();
          return;
        }
        dispatchSyntheticError(STREAM_INACTIVITY_TIMEOUT_MESSAGE);
      })();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  const unlisten = await runtime.listenToTurnEvents(
    eventName,
    (event: { payload: unknown }) => {
      const data = parseAgentEvent(event.payload);
      const eventType = extractRuntimeEventType(event.payload);
      if (!data) {
        if (!eventType) {
          return;
        }
        if (!firstEventReceived) {
          firstEventReceived = true;
          clearFirstEventWatchdog();
        }
        lastEventReceivedAt = Date.now();
        callbacks.activateStream(
          activeSessionId,
          effectiveWaitingRuntimeStatus,
        );
        if (!warnedUnknownEventTypes.has(eventType)) {
          warnedUnknownEventTypes.add(eventType);
          console.warn(
            `[AsterChat] 收到未识别的运行时事件，已保留流活跃态: ${eventName} · ${eventType}`,
          );
        }
        scheduleInactivityWatchdog();
        return;
      }
      if (!firstEventReceived) {
        firstEventReceived = true;
        clearFirstEventWatchdog();
      }
      lastEventReceivedAt = Date.now();

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
          disposeListener: disposeListenerWithWatchdogs,
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
      scheduleInactivityWatchdog();
    },
  );

  return () => {
    clearFirstEventWatchdog();
    clearInactivityWatchdog();
    unlisten();
  };
}
