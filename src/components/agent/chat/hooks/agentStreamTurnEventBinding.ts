import { parseAgentEvent, type AgentEvent } from "@/lib/api/agentProtocol";
import { logAgentDebug } from "@/lib/agentDebug";
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
  extractAgentStreamRuntimeEventSchemaVersion,
  extractAgentStreamRuntimeEventType,
  shouldDeferAgentStreamFirstEventTimeout,
  shouldIgnoreAgentStreamInactivityResult,
  shouldScheduleAgentStreamInactivityWatchdog,
} from "./agentStreamListenerReadinessController";
import { startAgentStreamRequest } from "./agentStreamRequestStartController";
import {
  buildAgentEventPerformanceTrace,
  buildAgentStreamProviderTraceMetricContext,
} from "./agentStreamRuntimeMetricsController";
import {
  rememberAgentStreamUnknownEventWarning,
  resolveAgentStreamUnknownEventPlan,
} from "./agentStreamUnknownEventController";
import { recordAgentStreamPerformanceMetric } from "./agentStreamPerformanceMetrics";
import { isAgentMessageFinalAnswerPhase } from "../utils/agentMessagePhase";
import { projectCommandContinuation } from "./commandContinuation";
import { hasRunningSessionCommand } from "../projection/commandActivity";
import { upsertThreadItemState } from "./agentThreadState";

const STREAM_FIRST_EVENT_TIMEOUT_MS = 12_000;
const STREAM_INACTIVITY_TIMEOUT_MS = 120_000; // 2 分钟，兼容推理模型长时间思考
const STREAM_DEFERRED_RECOVERY_POLL_MS = 5_000;
const STREAM_DEFERRED_RECOVERY_MAX_DURATION_MS = 120_000;

function isFinalAgentMessageSnapshotEvent(event: AgentEvent): boolean {
  return (
    (event.type === "item_started" ||
      event.type === "item_updated" ||
      event.type === "item_completed") &&
    event.item.type === "agent_message" &&
    isAgentMessageFinalAnswerPhase(event.item.phase) &&
    Boolean(event.item.text.trim())
  );
}

import type { RegisterAgentStreamTurnEventBindingOptions } from "./turnEventBindingTypes";

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
    content,
    webSearch,
    autoContinue,
    activeSessionId,
    resolvedWorkspaceId,
    assistantMsgId,
    pendingTurnKey,
    pendingItemKey,
    effectiveWaitingRuntimeStatus,
    preserveAssistantContent,
    assistantFallbackContent,
    warnedKeysRef,
    actionLoggedKeys,
    toolLogIdByToolId,
    toolStartedAtByToolId,
    toolNameByToolId,
    observer,
    onWriteFile,
    callbacks,
    appendThinkingToParts,
    setMessages,
    setPendingActions,
    getThreadItems,
    setThreadItems,
    setTodoItems,
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
    requestState,
    resolvedWorkspaceId,
    skipUserMessage,
    systemPrompt,
  });

  let firstEventReceived = false;
  let lastEventReceivedAt = 0;
  let lastRuntimeEventType: string | null = null;
  const warnedUnknownEventTypes = new Set<string>();
  const surfaceThinkingDeltas = false;
  let terminalRecoveryPollStarted = false;
  let terminalRecoveryPollStartedAt: number | null = null;
  let terminalRecoveryPollAttempts = 0;
  let recoveryPollGeneration = 0;
  let disposed = false;
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
  let deferredRecoveryPollId: ReturnType<typeof setTimeout> | null = null;
  const clearDeferredRecoveryPoll = () => {
    if (deferredRecoveryPollId) {
      clearTimeout(deferredRecoveryPollId);
      deferredRecoveryPollId = null;
    }
    recoveryPollGeneration += 1;
  };
  const readRecoveryTurnId = () =>
    requestState.activeTextSegmentTurnId ?? requestState.currentTurnId ?? null;
  function scheduleDeferredRecoveryPoll() {
    clearDeferredRecoveryPoll();
    if (
      disposed ||
      requestState.requestFinished ||
      !terminalRecoveryPollStarted
    ) {
      return;
    }
    const generation = recoveryPollGeneration;
    logAgentDebug(
      "AgentStream",
      "terminalRecoveryPoll.scheduled",
      {
        eventName,
        requireTerminal: terminalRecoveryPollStarted,
        sessionId: activeSessionId,
        turnId: readRecoveryTurnId(),
      },
      {
        dedupeKey: `${eventName}:terminalRecoveryPoll.scheduled`,
        throttleMs: 1000,
      },
    );
    deferredRecoveryPollId = globalThis.setTimeout(() => {
      deferredRecoveryPollId = null;
      if (
        disposed ||
        requestState.requestFinished ||
        generation !== recoveryPollGeneration
      ) {
        return;
      }
      terminalRecoveryPollAttempts += 1;
      void (async () => {
        logAgentDebug(
          "AgentStream",
          "terminalRecoveryPoll.attempt",
          {
            eventName,
            requireTerminal: terminalRecoveryPollStarted,
            sessionId: activeSessionId,
            turnId: readRecoveryTurnId(),
          },
          {
            dedupeKey: `${eventName}:terminalRecoveryPoll.attempt`,
            throttleMs: 1000,
          },
        );
        const recovered = await tryRecoverSilentTurn({
          requireTerminal: terminalRecoveryPollStarted,
        });
        if (
          disposed ||
          requestState.requestFinished ||
          generation !== recoveryPollGeneration
        ) {
          return;
        }
        if (recovered) {
          logAgentDebug("AgentStream", "terminalRecoveryPoll.recovered", {
            eventName,
            sessionId: activeSessionId,
            turnId: readRecoveryTurnId(),
          });
          console.warn(
            buildAgentStreamFirstEventSilentRecoveryWarning({ eventName }),
          );
          finalizeSilentTurnRecovery();
          return;
        }
        const startedAt = terminalRecoveryPollStartedAt ?? Date.now();
        if (
          Date.now() - startedAt >=
          STREAM_DEFERRED_RECOVERY_MAX_DURATION_MS
        ) {
          logAgentDebug("AgentStream", "terminalRecoveryPoll.exhausted", {
            attempts: terminalRecoveryPollAttempts,
            eventName,
            sessionId: activeSessionId,
            turnId: readRecoveryTurnId(),
          });
          return;
        }
        scheduleDeferredRecoveryPoll();
      })();
    }, STREAM_DEFERRED_RECOVERY_POLL_MS);
  }
  const startTerminalRecoveryPoll = () => {
    if (disposed || requestState.requestFinished) {
      return;
    }
    if (!terminalRecoveryPollStarted) {
      terminalRecoveryPollStarted = true;
      terminalRecoveryPollStartedAt = Date.now();
      terminalRecoveryPollAttempts = 0;
    }
    scheduleDeferredRecoveryPoll();
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
    lastRuntimeEventType = "deferred_submission";
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
    startTerminalRecoveryPoll();
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
    clearDeferredRecoveryPoll();
    if (
      hasRunningSessionCommand(
        requestState.conversationProjectionOwner?.reducer.getProjection()
          .items ??
          getThreadItems?.() ??
          [],
      )
    )
      return;
    disposed = true;
    callbacks.disposeListener();
  };
  const finalizeSilentTurnRecovery = () => {
    firstEventReceived = true;
    const activeStreamCleared = callbacks.clearActiveStreamIfMatch(eventName);
    disposeListenerWithWatchdogs();
    if (activeStreamCleared) {
      setIsSending(false);
    }
  };
  const tryRecoverSilentTurn = async (recoveryOptions?: {
    requireTerminal?: boolean;
  }) => {
    if (!attemptSilentTurnRecovery) {
      return false;
    }
    return await attemptSilentTurnRecovery(
      activeSessionId,
      requestState.requestStartedAt,
      content,
      {
        requireTerminal: recoveryOptions?.requireTerminal === true,
        turnId: readRecoveryTurnId(),
      },
    );
  };
  requestState.startTerminalRecoveryPoll = startTerminalRecoveryPoll;
  const dispatchSyntheticEvent = (data: AgentEvent) => {
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
        clearActiveStreamIfMatch: callbacks.clearActiveStreamIfMatch,
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
      surfaceThinkingDeltas,
      preserveAssistantContent,
      assistantFallbackContent,
      content,
      runtime,
      _webSearch: webSearch,
      warnedKeysRef,
      actionLoggedKeys,
      toolLogIdByToolId,
      toolStartedAtByToolId,
      toolNameByToolId,
      onWriteFile,
      setMessages,
      setPendingActions,
      getThreadItems,
      setThreadItems,
      setTodoItems,
      setThreadTurns,
      setCurrentTurnId,
      setExecutionRuntime,
      setIsSending,

    });
  };
  const dispatchSyntheticError = (message: string) => {
    dispatchSyntheticEvent({
      type: "error",
      message,
    } as AgentEvent);
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
      logAgentDebug(
        "AgentStream",
        "inactivityWatchdog.timeout",
        {
          eventName,
          sessionId: activeSessionId,
          elapsedSinceLastEventMs: lastEventReceivedAt
            ? timeoutStartedAt - lastEventReceivedAt
            : null,
          lastRuntimeEventType,
          requestElapsedMs: timeoutStartedAt - requestState.requestStartedAt,
        },
        { level: "warn" },
      );
      void (async () => {
        const recovered = await tryRecoverSilentTurn({
          requireTerminal: true,
        });
        const activeReadModelActivity = recovered
          ? false
          : await tryRecoverSilentTurn({
              requireTerminal: false,
            });
        const timeoutAction = resolveAgentStreamInactivityTimeoutAction({
          activeReadModelActivity,
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
            logAgentDebug("AgentStream", "inactivityWatchdog.ignored", {
              eventName,
              sessionId: activeSessionId,
              lastRuntimeEventType,
            });
            return;
          case "recover":
            console.warn(
              buildAgentStreamInactivitySilentRecoveryWarning({ eventName }),
            );
            logAgentDebug("AgentStream", "inactivityWatchdog.recovered", {
              eventName,
              sessionId: activeSessionId,
              lastRuntimeEventType,
            });
            finalizeSilentTurnRecovery();
            return;
          case "continue":
            logAgentDebug("AgentStream", "inactivityWatchdog.continue", {
              eventName,
              sessionId: activeSessionId,
              lastRuntimeEventType,
            });
            scheduleInactivityWatchdog();
            return;
          case "fail":
            logAgentDebug(
              "AgentStream",
              "inactivityWatchdog.failed",
              {
                eventName,
                sessionId: activeSessionId,
                lastRuntimeEventType,
              },
              { level: "warn" },
            );
            dispatchSyntheticError(AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE);
            return;
        }
      })();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  const unlisten = await runtime.listenToTurnEvents(
    eventName,
    (event: { payload: unknown }) => {
      if (disposed) return;
      const eventReceivedAt = Date.now();
      const data = parseAgentEvent(event.payload);
      if (data) {
        const continuation = projectCommandContinuation({
          event: data,
          items: getThreadItems?.() ?? [],
          host: requestState,
          threadId: activeSessionId,
          currentTurnId: requestState.currentTurnId,
          requestFinished: requestState.requestFinished,
        });
        if (continuation.handled) {
          if (continuation.item) {
            const item = continuation.item;
            setThreadItems((previous) => upsertThreadItemState(previous, item));
          }
          if (requestState.requestFinished) disposeListenerWithWatchdogs();
          return;
        }
      }
      if (requestState.requestFinished) return;
      const eventType = extractAgentStreamRuntimeEventType(event.payload);
      const schemaVersion = extractAgentStreamRuntimeEventSchemaVersion(
        event.payload,
      );
      if (data?.type === "text_delta" || data?.type === "text_delta_batch") {
        logAgentDebug(
          "AgentStream",
          "inboundTextDelta",
          {
            eventName,
            itemId: data.itemId ?? null,
            parsedType: data.type,
            phase: data.phase ?? null,
            rawEventType: eventType,
            sequence: data.sequence ?? null,
            sessionId: data.session_id ?? activeSessionId,
            turnId: data.turn_id ?? null,
          },
          {
            consoleOnly: true,
            dedupeKey: `${eventName}:inboundTextDelta:${data.itemId ?? "no-item"}:${data.phase ?? "no-phase"}`,
            throttleMs: 1000,
          },
        );
      }
      if (!data) {
        if (!terminalRecoveryPollStarted) {
          clearDeferredRecoveryPoll();
        }
        const unknownEventPlan = resolveAgentStreamUnknownEventPlan({
          eventName,
          eventType,
          schemaVersion,
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
        lastRuntimeEventType = unknownEventPlan.eventType;
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
      if (!terminalRecoveryPollStarted) {
        clearDeferredRecoveryPoll();
      }
      lastEventReceivedAt = eventReceivedAt;
      lastRuntimeEventType = data.type;
      requestState.performanceTrace = buildAgentEventPerformanceTrace({
        activeSessionId,
        event: data,
        eventReceivedAt,
        previousTrace: requestState.performanceTrace,
        resolvedWorkspaceId,
      });

      if (data.type === "provider_trace") {
        const providerTraceContext = buildAgentStreamProviderTraceMetricContext(
          {
            activeSessionId,
            attempt: data.attempt,
            cancelReason: data.cancel_reason,
            elapsedMs: data.elapsed_ms,
            eventName,
            failureCategory: data.failure_category,
            model: data.model,
            provider: data.provider,
            retryable: data.retryable,
            runtimeProviderActiveModel: data.runtime_provider_active_model,
            runtimeProviderBackend: data.runtime_provider_backend,
            runtimeProviderProtocol: data.runtime_provider_protocol,
            runtimeProviderSelector: data.runtime_provider_selector,
            runtimeEventType: data.runtime_event_type,
            stage: data.stage,
            status: data.status,
            textChars: data.text_chars,
          },
        );
        recordAgentStreamPerformanceMetric(
          "agentStream.providerTrace",
          requestState.performanceTrace,
          providerTraceContext,
        );
        logAgentDebug("AgentStream", "providerTrace", providerTraceContext, {
          consoleOnly: true,
          dedupeKey: `${eventName}:providerTrace:${data.stage ?? "no-stage"}:${data.status ?? "no-status"}`,
          throttleMs: 1000,
        });
        scheduleInactivityWatchdog();
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
          disposeListener: disposeListenerWithWatchdogs,
          clearActiveStreamIfMatch: callbacks.clearActiveStreamIfMatch,
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
        surfaceThinkingDeltas,
        preserveAssistantContent,
        assistantFallbackContent,
        content,
        runtime,
        _webSearch: webSearch,
        warnedKeysRef,
        actionLoggedKeys,
        toolLogIdByToolId,
        toolStartedAtByToolId,
        toolNameByToolId,
        onWriteFile,
        setMessages,
        setPendingActions,
        getThreadItems,
        setThreadItems,
        setTodoItems,
        setThreadTurns,
        setCurrentTurnId,
        setExecutionRuntime,
        setIsSending,

      });
      if (
        data.type === "text_delta" ||
        data.type === "text_delta_batch" ||
        isFinalAgentMessageSnapshotEvent(data)
      ) {
        startTerminalRecoveryPoll();
      }
      scheduleInactivityWatchdog();
    },
  );

  requestState.listenerBoundAt = Date.now();
  const listenerBoundContext = buildAgentStreamListenerBoundContext({
    activeSessionId,
    eventName,
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
    disposed = true;
    clearFirstEventWatchdog();
    clearInactivityWatchdog();
    clearDeferredRecoveryPoll();
    if (requestState.pendingTextRenderTimerId) {
      clearTimeout(requestState.pendingTextRenderTimerId);
      requestState.pendingTextRenderTimerId = null;
    }
    unlisten();
  };
}
