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
import { logAgentDebug } from "@/lib/agentDebug";
import type { ActionRequired, Message } from "../types";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";
import {
  AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE,
  AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE,
  buildAgentStreamFirstEventDeferredWarning,
  buildAgentStreamFirstEventSilentRecoveryWarning,
  buildAgentStreamInactivitySilentRecoveryWarning,
  resolveAgentStreamFirstEventTimeoutAction,
  resolveAgentStreamInactivityTimeoutAction,
} from "./agentStreamInactivityController";
import {
  buildAgentStreamFirstEventContext,
  buildAgentStreamFirstEventDeferredContext,
  buildAgentStreamListenerBoundContext,
  extractAgentStreamRuntimeEventType,
  shouldDeferAgentStreamFirstEventTimeout,
  shouldIgnoreAgentStreamInactivityResult,
  shouldScheduleAgentStreamInactivityWatchdog,
} from "./agentStreamListenerReadinessController";
import { startAgentStreamRequest } from "./agentStreamRequestStartController";
import {
  rememberAgentStreamUnknownEventWarning,
  resolveAgentStreamUnknownEventPlan,
} from "./agentStreamUnknownEventController";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import { recordAgentStreamPerformanceMetric } from "./agentStreamPerformanceMetrics";

type MessageParts = NonNullable<Message["contentParts"]>;
const STREAM_FIRST_EVENT_TIMEOUT_MS = 12_000;
const STREAM_INACTIVITY_TIMEOUT_MS = 120_000; // 2 分钟，兼容推理模型长时间思考

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
  systemPrompt?: string;
  thinking?: boolean;
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
    attemptSilentTurnRecovery,
    skipUserMessage,
    effectiveProviderType,
    effectiveModel,
    effectiveExecutionStrategy,
    systemPrompt,
    thinking,
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

  startAgentStreamRequest({
    activeSessionId,
    autoContinue,
    content,
    effectiveExecutionStrategy,
    effectiveModel,
    effectiveProviderType,
    eventName,
    expectingQueue,
    requestState,
    resolvedWorkspaceId,
    skipUserMessage,
    systemPrompt,
  });

  let firstEventReceived = false;
  let lastEventReceivedAt = 0;
  const warnedUnknownEventTypes = new Set<string>();
  const markFirstEventReceived = (params: {
    eventReceivedAt: number;
    eventType: string;
    recognized: boolean;
  }) => {
    if (firstEventReceived) {
      return;
    }

    firstEventReceived = true;
    requestState.firstEventReceivedAt = params.eventReceivedAt;
    const firstEventContext = buildAgentStreamFirstEventContext({
      activeSessionId,
      eventName,
      eventReceivedAt: params.eventReceivedAt,
      eventType: params.eventType,
      recognized: params.recognized,
      requestStartedAt: requestState.requestStartedAt,
      submissionDispatchedAt: requestState.submissionDispatchedAt,
    });
    recordAgentStreamPerformanceMetric(
      "agentStream.firstEvent",
      requestState.performanceTrace,
      firstEventContext,
    );
    logAgentDebug("AgentStream", "firstEvent", firstEventContext);
    clearFirstEventWatchdog();
  };
  let inactivityWatchdogId: ReturnType<typeof setTimeout> | null = null;
  const clearInactivityWatchdog = () => {
    if (inactivityWatchdogId) {
      clearTimeout(inactivityWatchdogId);
      inactivityWatchdogId = null;
    }
  };
  function deferFirstEventTimeoutAfterSubmission() {
    if (
      !shouldDeferAgentStreamFirstEventTimeout({
        firstEventReceived,
        requestFinished: requestState.requestFinished,
        submissionDispatchedAt: requestState.submissionDispatchedAt,
      })
    ) {
      return false;
    }

    firstEventReceived = true;
    lastEventReceivedAt = Date.now();
    const deferredContext = buildAgentStreamFirstEventDeferredContext({
      activeSessionId,
      deferredAt: lastEventReceivedAt,
      eventName,
      requestStartedAt: requestState.requestStartedAt,
      submissionDispatchedAt: requestState.submissionDispatchedAt,
    });
    recordAgentStreamPerformanceMetric(
      "agentStream.firstEventDeferred",
      requestState.performanceTrace,
      deferredContext,
    );
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
        const timeoutAction = resolveAgentStreamFirstEventTimeoutAction({
          canDeferAfterSubmission: shouldDeferAgentStreamFirstEventTimeout({
            firstEventReceived,
            requestFinished: requestState.requestFinished,
            submissionDispatchedAt: requestState.submissionDispatchedAt,
          }),
          firstEventReceived,
          recovered,
          requestFinished: requestState.requestFinished,
        });
        switch (timeoutAction) {
          case "ignore":
            return;
          case "recover":
            console.warn(
              buildAgentStreamFirstEventSilentRecoveryWarning({ eventName }),
            );
            finalizeSilentTurnRecovery();
            return;
          case "defer":
            if (deferFirstEventTimeoutAfterSubmission()) {
              console.warn(
                buildAgentStreamFirstEventDeferredWarning({ eventName }),
              );
            }
            return;
          case "fail":
            firstEventReceived = true;
            dispatchSyntheticError(AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE);
            return;
        }
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
      surfaceThinkingDeltas: thinking !== false,
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
      !shouldScheduleAgentStreamInactivityWatchdog({
        firstEventReceived,
        requestFinished: requestState.requestFinished,
        streamActivated: callbacks.isStreamActivated(),
      })
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
        const timeoutAction = resolveAgentStreamInactivityTimeoutAction({
          recovered,
          shouldIgnore: shouldIgnoreAgentStreamInactivityResult({
            lastEventReceivedAt,
            requestFinished: requestState.requestFinished,
            streamActivated: callbacks.isStreamActivated(),
            timeoutStartedAt,
          }),
        });
        switch (timeoutAction) {
          case "ignore":
            return;
          case "recover":
            console.warn(
              buildAgentStreamInactivitySilentRecoveryWarning({ eventName }),
            );
            finalizeSilentTurnRecovery();
            return;
          case "fail":
            dispatchSyntheticError(AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE);
            return;
        }
      })();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  const unlisten = await runtime.listenToTurnEvents(
    eventName,
    (event: { payload: unknown }) => {
      const eventReceivedAt = Date.now();
      const data = parseAgentEvent(event.payload);
      const eventType = extractAgentStreamRuntimeEventType(event.payload);
      if (!data) {
        const unknownEventPlan = resolveAgentStreamUnknownEventPlan({
          eventName,
          eventType,
          warnedEventTypes: warnedUnknownEventTypes,
        });
        if (!unknownEventPlan) {
          return;
        }
        if (!firstEventReceived) {
          markFirstEventReceived({
            eventReceivedAt,
            eventType: unknownEventPlan.eventType,
            recognized: false,
          });
        }
        lastEventReceivedAt = eventReceivedAt;
        callbacks.activateStream(
          activeSessionId,
          effectiveWaitingRuntimeStatus,
        );
        if (
          unknownEventPlan.shouldWarn &&
          unknownEventPlan.warningMessage &&
          rememberAgentStreamUnknownEventWarning({
            eventType: unknownEventPlan.eventType,
            warnedEventTypes: warnedUnknownEventTypes,
          })
        ) {
          console.warn(unknownEventPlan.warningMessage);
        }
        scheduleInactivityWatchdog();
        return;
      }
      if (!firstEventReceived) {
        markFirstEventReceived({
          eventReceivedAt,
          eventType: data.type,
          recognized: true,
        });
      }
      lastEventReceivedAt = eventReceivedAt;

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
        surfaceThinkingDeltas: thinking !== false,
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

  requestState.listenerBoundAt = Date.now();
  const listenerBoundContext = buildAgentStreamListenerBoundContext({
    activeSessionId,
    eventName,
    expectingQueue,
    listenerBoundAt: requestState.listenerBoundAt,
    requestStartedAt: requestState.requestStartedAt,
  });
  recordAgentStreamPerformanceMetric(
    "agentStream.listenerBound",
    requestState.performanceTrace,
    listenerBoundContext,
  );
  logAgentDebug("AgentStream", "listenerBound", listenerBoundContext);

  return () => {
    clearFirstEventWatchdog();
    clearInactivityWatchdog();
    unlisten();
  };
}
