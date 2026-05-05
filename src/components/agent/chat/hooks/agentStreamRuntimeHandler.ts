import { toast } from "sonner";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AgentEvent,
  AgentThreadItem,
  AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import { logAgentDebug } from "@/lib/agentDebug";
import type { ActionRequired, Message } from "../types";
import { appendTextToParts } from "./agentChatHistory";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  handleActionRequiredEvent,
  handleArtifactSnapshotEvent,
  handleContextTraceEvent,
  handleToolEndEvent,
  handleToolStartEvent,
} from "./agentStreamEventProcessor";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  buildAgentStreamCompletedAssistantMessagePatch,
  buildAgentStreamEmptyFinalErrorPlan,
  buildAgentStreamFinalDonePlan,
  buildAgentStreamMissingFinalReplyFailureSideEffectPlan,
  type AgentStreamMissingFinalReplyPlan,
  isAgentStreamEmptyFinalReplyError,
} from "./agentStreamCompletionController";
import {
  applyAgentStreamErrorToastPlan,
  buildAgentStreamErrorFailurePlan,
  buildAgentStreamFailedAssistantMessagePatch,
  buildAgentStreamFailedTimelineStatePlan,
  buildAgentStreamFailedTimelineItemUpdate,
  buildAgentStreamFailedTimelineTurnUpdate,
} from "./agentStreamErrorController";
import {
  recordAgentStreamPerformanceMetric,
  type AgentUiPerformanceTraceMetadata,
} from "./agentStreamPerformanceMetrics";
import {
  buildAgentStreamRequestLogFinishPlan,
  type AgentStreamRequestLogFinishPayload,
} from "./agentStreamRequestLogController";
import {
  buildAgentStreamFirstRuntimeStatusMetricContext,
  shouldRecordAgentStreamFirstRuntimeStatus,
} from "./agentStreamRuntimeMetricsController";
import {
  buildAgentStreamRuntimeStatusApplyPlan,
  buildAgentStreamRuntimeSummaryItemUpdate,
} from "./agentStreamRuntimeStatusController";
import { buildAgentStreamTextDeltaApplyPlan } from "./agentStreamTextDeltaController";
import {
  buildAgentStreamFirstTextPaintContext,
  buildAgentStreamTextRenderFlushPlan,
} from "./agentStreamTextRenderFlushController";
import {
  buildAgentStreamQueuedDraftCleanupTimerFirePlan,
  buildAgentStreamQueuedDraftCleanupTimerSchedulePlan,
  buildAgentStreamTextRenderTimerSchedulePlan,
  buildAgentStreamTimerClearPlan,
} from "./agentStreamTimerController";
import {
  applyAgentStreamWarningToastAction,
  buildAgentStreamWarningPlan,
  buildAgentStreamWarningToastAction,
} from "./agentStreamWarningController";
import {
  buildAgentStreamQueuedDraftStatePlan,
  shouldWatchAgentStreamQueuedDraftCleanup,
  shouldWatchAgentStreamQueuedDraftCleanupForCleared,
} from "./agentStreamQueueController";
import {
  buildAgentStreamTurnStartedPendingItemUpdate,
  shouldDeferAgentStreamThreadItemUpdate,
} from "./agentStreamThreadItemController";
import { buildAgentStreamToolEndPreApplyPlan } from "./agentStreamToolEventController";
import {
  buildAgentStreamActionRequiredPreApplyPlan,
  buildAgentStreamArtifactSnapshotPreApplyPlan,
} from "./agentStreamArtifactActionController";
import {
  applyAgentStreamModelChangeExecutionRuntime,
  applyAgentStreamTurnContextExecutionRuntime,
  buildAgentStreamContextTracePreApplyPlan,
  buildAgentStreamModelChangePreApplyPlan,
  buildAgentStreamTurnContextPreApplyPlan,
} from "./agentStreamRuntimeContextController";
import {
  buildAgentStreamThinkingDeltaMessagePatch,
  buildAgentStreamThinkingDeltaPreApplyPlan,
} from "./agentStreamThinkingDeltaController";

type MessageParts = NonNullable<Message["contentParts"]>;

interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface StreamRequestState {
  accumulatedContent: string;
  hasMeaningfulCompletionSignal?: boolean;
  queuedTurnId: string | null;
  requestLogId: string | null;
  requestStartedAt: number;
  submissionDispatchedAt?: number | null;
  listenerBoundAt?: number | null;
  firstEventReceivedAt?: number | null;
  firstRuntimeStatusAt?: number | null;
  firstTextDeltaAt?: number | null;
  firstTextPaintAt?: number | null;
  firstTextPaintScheduled?: boolean;
  firstTextRenderFlushAt?: number | null;
  lastTextRenderFlushAt?: number | null;
  textDeltaBufferedCount?: number;
  textDeltaFlushCount?: number;
  maxTextDeltaBacklogChars?: number;
  requestFinished: boolean;
  queuedDraftCleanupTimerId?: ReturnType<typeof setTimeout> | null;
  pendingTextRenderTimerId?: ReturnType<typeof setTimeout> | null;
  renderedContent?: string;
  performanceTrace?: AgentUiPerformanceTraceMetadata | null;
}

interface StreamLifecycleCallbacks {
  activateStream: () => void;
  isStreamActivated: () => boolean;
  clearOptimisticItem: () => void;
  clearOptimisticTurn: () => void;
  disposeListener: () => void;
  removeQueuedDraftMessages: () => void;
  clearActiveStreamIfMatch: (eventName: string) => boolean;
  upsertQueuedTurn: (queuedTurn: QueuedTurnSnapshot) => void;
  removeQueuedTurnState: (queuedTurnIds: string[]) => void;
  playToolcallSound: () => void;
  playTypewriterSound: () => void;
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
}

interface HandleTurnStreamEventOptions {
  data: AgentEvent;
  requestState: StreamRequestState;
  callbacks: StreamLifecycleCallbacks;
  observer?: StreamObserver;
  eventName: string;
  pendingTurnKey: string;
  pendingItemKey: string;
  assistantMsgId: string;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  surfaceThinkingDeltas?: boolean;
  content: string;
  runtime: AgentRuntimeAdapter;
  webSearch?: boolean;
  warnedKeysRef: MutableRefObject<Set<string>>;
  actionLoggedKeys: Set<string>;
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
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

function finishRequestLog(
  requestState: StreamRequestState,
  payload: AgentStreamRequestLogFinishPayload,
) {
  const requestLogPlan = buildAgentStreamRequestLogFinishPlan({
    requestLogId: requestState.requestLogId,
    requestFinished: requestState.requestFinished,
    requestStartedAt: requestState.requestStartedAt,
    finishedAt: Date.now(),
    payload,
  });
  if (
    !requestLogPlan.shouldUpdate ||
    !requestLogPlan.logId ||
    !requestLogPlan.updatePayload
  ) {
    return;
  }

  requestState.requestFinished = requestLogPlan.nextRequestFinished;
  activityLogger.updateLog(requestLogPlan.logId, requestLogPlan.updatePayload);
}

export function handleTurnStreamEvent({
  data,
  requestState,
  callbacks,
  observer,
  eventName,
  pendingTurnKey,
  pendingItemKey,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
  effectiveExecutionStrategy,
  surfaceThinkingDeltas = true,
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
}: HandleTurnStreamEventOptions): void {
  const {
    activateStream,
    isStreamActivated,
    clearOptimisticItem,
    clearOptimisticTurn,
    disposeListener,
    removeQueuedDraftMessages,
    clearActiveStreamIfMatch,
    upsertQueuedTurn,
    removeQueuedTurnState,
    playToolcallSound,
    playTypewriterSound,
    appendThinkingToParts,
  } = callbacks;

  const clearQueuedDraftCleanupTimer = () => {
    const clearPlan = buildAgentStreamTimerClearPlan({
      hasTimer: Boolean(requestState.queuedDraftCleanupTimerId),
    });
    if (clearPlan.shouldClearTimer && requestState.queuedDraftCleanupTimerId) {
      clearTimeout(requestState.queuedDraftCleanupTimerId);
    }
    requestState.queuedDraftCleanupTimerId = clearPlan.nextTimerId;
  };

  const clearPendingTextRenderTimer = () => {
    const clearPlan = buildAgentStreamTimerClearPlan({
      hasTimer: Boolean(requestState.pendingTextRenderTimerId),
    });
    if (clearPlan.shouldClearTimer && requestState.pendingTextRenderTimerId) {
      clearTimeout(requestState.pendingTextRenderTimerId);
    }
    requestState.pendingTextRenderTimerId = clearPlan.nextTimerId;
  };

  const flushPendingTextRender = () => {
    clearPendingTextRenderTimer();
    const renderedContent = requestState.renderedContent || "";
    const nextContent = requestState.accumulatedContent;
    const flushStartedAt = Date.now();
    const flushPlan = buildAgentStreamTextRenderFlushPlan({
      activeSessionId,
      eventName,
      firstTextDeltaAt: requestState.firstTextDeltaAt,
      firstTextPaintAt: requestState.firstTextPaintAt,
      firstTextPaintScheduled: requestState.firstTextPaintScheduled,
      firstTextRenderFlushAt: requestState.firstTextRenderFlushAt,
      flushStartedAt,
      maxTextDeltaBacklogChars: requestState.maxTextDeltaBacklogChars,
      nextContent,
      renderedContent,
      requestStartedAt: requestState.requestStartedAt,
      textDeltaFlushCount: requestState.textDeltaFlushCount,
    });
    if (!flushPlan) {
      return;
    }

    requestState.renderedContent = flushPlan.nextRenderedContent;
    requestState.textDeltaFlushCount = flushPlan.nextTextDeltaFlushCount;
    requestState.lastTextRenderFlushAt =
      flushPlan.nextLastTextRenderFlushAt;
    requestState.maxTextDeltaBacklogChars =
      flushPlan.nextMaxTextDeltaBacklogChars;
    if (
      flushPlan.firstTextRenderFlushAt &&
      flushPlan.firstTextRenderFlushContext
    ) {
      requestState.firstTextRenderFlushAt =
        flushPlan.firstTextRenderFlushAt;
      recordAgentStreamPerformanceMetric(
        "agentStream.firstTextRenderFlush",
        requestState.performanceTrace,
        flushPlan.firstTextRenderFlushContext,
      );
    }
    if (flushPlan.shouldScheduleFirstTextPaint) {
      requestState.firstTextPaintScheduled = true;
    }
    if (flushPlan.shouldLogFlush) {
      logAgentDebug(
        "AgentStream",
        "textRenderFlush",
        flushPlan.flushLogContext,
        {
          dedupeKey: flushPlan.flushLogDedupeKey,
          throttleMs: 250,
        },
      );
    }
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              content: nextContent,
              thinkingContent: undefined,
              contentParts: flushPlan.textDelta
                ? appendTextToParts(
                    surfaceThinkingDeltas
                      ? msg.contentParts || []
                      : (msg.contentParts || []).filter(
                          (part) => part.type !== "thinking",
                        ),
                    flushPlan.textDelta,
                  )
                : msg.contentParts,
            }
          : msg,
      ),
    );
    if (flushPlan.shouldScheduleFirstTextPaint) {
      const recordFirstTextPaint = () => {
        const paintedAt = Date.now();
        requestState.firstTextPaintAt = paintedAt;
        const paintContext = buildAgentStreamFirstTextPaintContext({
          activeSessionId,
          eventName,
          firstTextDeltaAt: requestState.firstTextDeltaAt,
          flushStartedAt,
          paintedAt,
          requestStartedAt: requestState.requestStartedAt,
        });
        recordAgentStreamPerformanceMetric(
          "agentStream.firstTextPaint",
          requestState.performanceTrace,
          paintContext,
        );
        logAgentDebug("AgentStream", "firstTextPaint", paintContext);
      };

      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(recordFirstTextPaint);
        });
      } else {
        setTimeout(recordFirstTextPaint, 0);
      }
    }
  };

  const scheduleTextRenderFlush = () => {
    const renderedContent = requestState.renderedContent || "";
    const schedulePlan = buildAgentStreamTextRenderTimerSchedulePlan({
      accumulatedContent: requestState.accumulatedContent,
      hasPendingTimer: Boolean(requestState.pendingTextRenderTimerId),
      renderedContent,
    });
    if (schedulePlan.action === "flush_now") {
      flushPendingTextRender();
      return;
    }

    if (schedulePlan.action !== "schedule_timer" || !schedulePlan.delayMs) {
      return;
    }
    requestState.pendingTextRenderTimerId = setTimeout(() => {
      requestState.pendingTextRenderTimerId = null;
      flushPendingTextRender();
    }, schedulePlan.delayMs);
  };

  const scheduleQueuedDraftCleanup = (shouldWatchCurrentRequest: boolean) => {
    const cleanupSchedulePlan =
      buildAgentStreamQueuedDraftCleanupTimerSchedulePlan({
        shouldWatchCurrentRequest,
        streamActivated: isStreamActivated(),
      });
    if (cleanupSchedulePlan.shouldClearExistingTimer) {
      clearQueuedDraftCleanupTimer();
    }
    if (
      !cleanupSchedulePlan.shouldScheduleTimer ||
      !cleanupSchedulePlan.delayMs
    ) {
      return;
    }

    requestState.queuedDraftCleanupTimerId = setTimeout(() => {
      requestState.queuedDraftCleanupTimerId = null;
      const cleanupFirePlan =
        buildAgentStreamQueuedDraftCleanupTimerFirePlan({
          requestFinished: requestState.requestFinished,
          streamActivated: isStreamActivated(),
        });
      if (!cleanupFirePlan.shouldCleanup) {
        return;
      }
      disposeListener();
      removeQueuedDraftMessages();
    }, cleanupSchedulePlan.delayMs);
  };

  const markFailedTimelineState = (errorMessage: string) => {
    const failedTimelinePlan = buildAgentStreamFailedTimelineStatePlan({
      activeSessionId,
      errorMessage,
      failedAt: new Date().toISOString(),
      pendingItemKey,
      pendingTurnKey,
    });

    setThreadTurns((prev) => {
      const failedTurn = buildAgentStreamFailedTimelineTurnUpdate({
        activeSessionId: failedTimelinePlan.activeSessionId,
        errorMessage: failedTimelinePlan.errorMessage,
        failedAt: failedTimelinePlan.failedAt,
        pendingTurnKey: failedTimelinePlan.pendingTurnKey,
        turns: prev,
      });
      if (!failedTurn) {
        return prev;
      }

      return upsertThreadTurnState(prev, failedTurn);
    });

    setThreadItems((prev) => {
      const failedItem = buildAgentStreamFailedTimelineItemUpdate({
        errorMessage: failedTimelinePlan.errorMessage,
        failedAt: failedTimelinePlan.failedAt,
        items: prev,
        pendingItemKey: failedTimelinePlan.pendingItemKey,
      });
      if (!failedItem) {
        return prev;
      }

      return upsertThreadItemState(prev, failedItem);
    });
  };

  const finalizeMissingFinalReplyFailure = (
    failurePlan: AgentStreamMissingFinalReplyPlan,
  ) => {
    const sideEffectPlan =
      buildAgentStreamMissingFinalReplyFailureSideEffectPlan(failurePlan);
    if (sideEffectPlan.shouldClearPendingTextRenderTimer) {
      clearPendingTextRenderTimer();
    }
    if (sideEffectPlan.shouldMarkFailedTimeline) {
      markFailedTimelineState(sideEffectPlan.errorMessage);
    }
    removeQueuedTurnState(sideEffectPlan.queuedTurnIds);
    finishRequestLog(requestState, sideEffectPlan.requestLogPayload);
    observer?.onError?.(sideEffectPlan.observerErrorMessage);
    toast.error(sideEffectPlan.toastMessage);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...updateMessageArtifactsStatus(msg, "error"),
              ...buildAgentStreamFailedAssistantMessagePatch({
                errorMessage: sideEffectPlan.errorMessage,
                accumulatedContent: requestState.accumulatedContent,
                previousContent: msg.content,
                usage: sideEffectPlan.usage ?? msg.usage,
              }),
            }
          : msg,
      ),
    );
    if (sideEffectPlan.shouldClearActiveStream) {
      clearActiveStreamIfMatch(eventName);
    }
    if (sideEffectPlan.shouldDisposeListener) {
      disposeListener();
    }
  };

  const markQueuedDraftState = (queuedMessageText?: string | null) => {
    const queuedDraftPlan = buildAgentStreamQueuedDraftStatePlan({
      contentFallback: content,
      executionStrategy: effectiveExecutionStrategy,
      queuedMessageText,
      webSearch,
    });
    if (queuedDraftPlan.shouldClearActiveStream) {
      clearActiveStreamIfMatch(eventName);
    }
    if (queuedDraftPlan.shouldClearOptimisticItem) {
      clearOptimisticItem();
    }
    if (queuedDraftPlan.shouldClearOptimisticTurn) {
      clearOptimisticTurn();
    }
    if (queuedDraftPlan.shouldSetSendingFalse) {
      setIsSending(false);
    }

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              ...queuedDraftPlan.messagePatch,
            }
          : msg,
      ),
    );
  };

  switch (data.type) {
    case "message":
      // 后端会先发送完整 message 快照，再发送细粒度 delta；这里仅确认流已进入已知事件路径，避免误报未知事件。
      activateStream();
      break;

    case "thread_started":
      break;

    case "queue_added":
      requestState.queuedTurnId = data.queued_turn.queued_turn_id;
      upsertQueuedTurn(data.queued_turn);
      markQueuedDraftState(data.queued_turn.message_text);
      break;

    case "queue_removed":
      removeQueuedTurnState([data.queued_turn_id]);
      scheduleQueuedDraftCleanup(
        shouldWatchAgentStreamQueuedDraftCleanup({
          affectedQueuedTurnId: data.queued_turn_id,
          currentQueuedTurnId: requestState.queuedTurnId,
        }),
      );
      break;

    case "queue_started":
      requestState.queuedTurnId = data.queued_turn_id;
      removeQueuedTurnState([data.queued_turn_id]);
      clearQueuedDraftCleanupTimer();
      activateStream();
      break;

    case "queue_cleared":
      removeQueuedTurnState(data.queued_turn_ids);
      scheduleQueuedDraftCleanup(
        shouldWatchAgentStreamQueuedDraftCleanupForCleared({
          clearedQueuedTurnIds: data.queued_turn_ids,
          currentQueuedTurnId: requestState.queuedTurnId,
        }),
      );
      break;

    case "turn_started":
      clearQueuedDraftCleanupTimer();
      activateStream();
      setCurrentTurnId(data.turn.id);
      setThreadTurns((prev) =>
        upsertThreadTurnState(
          removeThreadTurnState(prev, pendingTurnKey),
          data.turn,
        ),
      );
      setThreadItems((prev) => {
        const pendingItem = prev.find((item) => item.id === pendingItemKey);
        const updatedPendingItem =
          buildAgentStreamTurnStartedPendingItemUpdate({
            pendingItem,
            turn: data.turn,
          });
        if (!updatedPendingItem) {
          return prev;
        }

        return upsertThreadItemState(
          removeThreadItemState(prev, pendingItemKey),
          updatedPendingItem,
        );
      });
      break;

    case "item_started":
    case "item_completed":
      activateStream();
      setThreadItems((prev) =>
        upsertThreadItemState(
          removeThreadItemState(prev, pendingItemKey),
          data.item,
        ),
      );
      break;

    case "item_updated":
      activateStream();
      if (shouldDeferAgentStreamThreadItemUpdate(data.item)) {
        break;
      }
      setThreadItems((prev) =>
        upsertThreadItemState(
          removeThreadItemState(prev, pendingItemKey),
          data.item,
        ),
      );
      break;

    case "turn_completed":
    case "turn_failed":
      clearQueuedDraftCleanupTimer();
      activateStream();
      clearOptimisticItem();
      setThreadTurns((prev) =>
        upsertThreadTurnState(
          removeThreadTurnState(prev, pendingTurnKey),
          data.turn,
        ),
      );
      setCurrentTurnId(data.turn.id);
      break;

    case "runtime_status":
      activateStream();
      {
        if (
          shouldRecordAgentStreamFirstRuntimeStatus({
            firstRuntimeStatusAt: requestState.firstRuntimeStatusAt,
          })
        ) {
          requestState.firstRuntimeStatusAt = Date.now();
          const firstRuntimeStatusContext =
            buildAgentStreamFirstRuntimeStatusMetricContext({
              activeSessionId,
              eventName,
              firstEventReceivedAt: requestState.firstEventReceivedAt,
              firstRuntimeStatusAt: requestState.firstRuntimeStatusAt,
              requestStartedAt: requestState.requestStartedAt,
              statusPhase: data.status.phase,
              statusTitle: data.status.title,
            });
          recordAgentStreamPerformanceMetric(
            "agentStream.firstRuntimeStatus",
            requestState.performanceTrace,
            firstRuntimeStatusContext,
          );
          logAgentDebug(
            "AgentStream",
            "firstRuntimeStatus",
            firstRuntimeStatusContext,
          );
        }
        const runtimeStatusPlan = buildAgentStreamRuntimeStatusApplyPlan({
          status: data.status,
          updatedAt: new Date().toISOString(),
        });
        setThreadItems((prev) => {
          const runtimeSummaryItem = buildAgentStreamRuntimeSummaryItemUpdate({
            activeSessionId,
            items: prev,
            pendingItemKey,
            summaryText: runtimeStatusPlan.summaryText,
            updatedAt: runtimeStatusPlan.updatedAt,
          });
          if (!runtimeSummaryItem) {
            return prev;
          }

          return upsertThreadItemState(prev, runtimeSummaryItem);
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  runtimeStatus: runtimeStatusPlan.normalizedStatus,
                }
              : msg,
          ),
        );
      }
      break;

    case "turn_context":
      if (buildAgentStreamTurnContextPreApplyPlan(data).shouldActivateStream) {
        activateStream();
      }
      setExecutionRuntime((current) =>
        applyAgentStreamTurnContextExecutionRuntime(current, data),
      );
      break;

    case "model_change":
      if (buildAgentStreamModelChangePreApplyPlan(data).shouldActivateStream) {
        activateStream();
      }
      setExecutionRuntime((current) =>
        applyAgentStreamModelChangeExecutionRuntime(current, data),
      );
      break;

    case "thinking_delta":
      {
        const thinkingPlan = buildAgentStreamThinkingDeltaPreApplyPlan({
          surfaceThinkingDeltas,
        });
        if (thinkingPlan.shouldActivateStream) {
          activateStream();
        }
        if (!thinkingPlan.shouldApplyThinkingDelta) {
          break;
        }
      }
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMsgId) {
            return msg;
          }

          return {
            ...msg,
            ...buildAgentStreamThinkingDeltaMessagePatch({
              appendThinkingToParts,
              contentParts: msg.contentParts,
              textDelta: data.text,
              thinkingContent: msg.thinkingContent,
            }),
          };
        }),
      );
      break;

    case "text_delta":
      activateStream();
      clearOptimisticItem();
      {
        const textDeltaPlan = buildAgentStreamTextDeltaApplyPlan({
          activeSessionId,
          accumulatedContent: requestState.accumulatedContent,
          deltaText: data.text,
          eventName,
          firstEventReceivedAt: requestState.firstEventReceivedAt,
          firstRuntimeStatusAt: requestState.firstRuntimeStatusAt,
          firstTextDeltaAt: requestState.firstTextDeltaAt,
          now: Date.now(),
          requestStartedAt: requestState.requestStartedAt,
          textDeltaBufferedCount: requestState.textDeltaBufferedCount,
        });
        requestState.textDeltaBufferedCount =
          textDeltaPlan.nextBufferedCount;
        if (
          textDeltaPlan.firstTextDeltaAt &&
          textDeltaPlan.firstTextDeltaContext
        ) {
          requestState.firstTextDeltaAt = textDeltaPlan.firstTextDeltaAt;
          recordAgentStreamPerformanceMetric(
            "agentStream.firstTextDelta",
            requestState.performanceTrace,
            textDeltaPlan.firstTextDeltaContext,
          );
          logAgentDebug(
            "AgentStream",
            "firstTextDelta",
            textDeltaPlan.firstTextDeltaContext,
          );
        }
        requestState.accumulatedContent =
          textDeltaPlan.nextAccumulatedContent;
      }
      observer?.onTextDelta?.(data.text, requestState.accumulatedContent);
      playTypewriterSound();
      scheduleTextRenderFlush();
      break;

    case "tool_start":
      activateStream();
      clearOptimisticItem();
      playToolcallSound();
      handleToolStartEvent({
        data,
        setPendingActions,
        onWriteFile,
        toolLogIdByToolId,
        toolStartedAtByToolId,
        toolNameByToolId,
        assistantMsgId,
        activeSessionId,
        resolvedWorkspaceId,
        setMessages,
      });
      break;

    case "tool_end":
      activateStream();
      clearOptimisticItem();
      {
        const toolEndPlan = buildAgentStreamToolEndPreApplyPlan({
          result: data.result,
          toolId: data.tool_id,
          toolNameByToolId,
        });
        if (toolEndPlan.hasMeaningfulCompletionSignal) {
          requestState.hasMeaningfulCompletionSignal = true;
        }
      }
      handleToolEndEvent({
        data,
        onWriteFile,
        toolLogIdByToolId,
        toolStartedAtByToolId,
        toolNameByToolId,
        assistantMsgId,
        activeSessionId,
        resolvedWorkspaceId,
        setMessages,
      });
      break;

    case "artifact_snapshot":
      {
        const artifactPlan = buildAgentStreamArtifactSnapshotPreApplyPlan({
          artifact: data.artifact,
        });
        if (artifactPlan.shouldActivateStream) {
          activateStream();
        }
        if (artifactPlan.shouldClearOptimisticItem) {
          clearOptimisticItem();
        }
        if (artifactPlan.shouldMarkMeaningfulCompletionSignal) {
          requestState.hasMeaningfulCompletionSignal = true;
        }
      }
      handleArtifactSnapshotEvent({
        data,
        onWriteFile,
        assistantMsgId,
        activeSessionId,
        resolvedWorkspaceId,
        setMessages,
      });
      break;

    case "action_required":
      {
        const actionPlan = buildAgentStreamActionRequiredPreApplyPlan(data);
        if (actionPlan.shouldActivateStream) {
          activateStream();
        }
        if (actionPlan.shouldClearOptimisticItem) {
          clearOptimisticItem();
        }
      }
      handleActionRequiredEvent({
        data,
        actionLoggedKeys,
        effectiveExecutionStrategy,
        runtime,
        setPendingActions,
        assistantMsgId,
        activeSessionId,
        resolvedWorkspaceId,
        setMessages,
      });
      break;

    case "context_trace":
      {
        const contextTracePlan =
          buildAgentStreamContextTracePreApplyPlan(data);
        if (contextTracePlan.shouldActivateStream) {
          activateStream();
        }
        if (contextTracePlan.shouldClearOptimisticItem) {
          clearOptimisticItem();
        }
      }
      handleContextTraceEvent({
        data,
        assistantMsgId,
        activeSessionId,
        resolvedWorkspaceId,
        setMessages,
      });
      break;

    case "final_done": {
      clearQueuedDraftCleanupTimer();
      flushPendingTextRender();
      clearOptimisticItem();
      clearOptimisticTurn();
      const finalDonePlan = buildAgentStreamFinalDonePlan({
        accumulatedContent: requestState.accumulatedContent,
        hasMeaningfulCompletionSignal:
          requestState.hasMeaningfulCompletionSignal,
        queuedTurnId: requestState.queuedTurnId,
        toolCallCount: toolLogIdByToolId.size,
        usage: data.usage,
      });
      if (finalDonePlan.type === "missing_final_reply_failure") {
        finalizeMissingFinalReplyFailure(finalDonePlan);
        break;
      }

      removeQueuedTurnState(finalDonePlan.queuedTurnIds);
      finishRequestLog(requestState, finalDonePlan.requestLogPayload);
      const finalContent = finalDonePlan.finalContent;
      observer?.onComplete?.(finalContent);
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMsgId) {
            return msg;
          }

          return {
            ...updateMessageArtifactsStatus(msg, "complete"),
            ...buildAgentStreamCompletedAssistantMessagePatch({
              parts: msg.contentParts,
              finalContent,
              rawContent: requestState.accumulatedContent,
              surfaceThinkingDeltas,
              usage: data.usage ?? msg.usage,
            }),
          };
        }),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "error": {
      clearQueuedDraftCleanupTimer();
      flushPendingTextRender();
      if (isAgentStreamEmptyFinalReplyError(data.message)) {
        clearOptimisticItem();
        clearOptimisticTurn();
        const emptyFinalErrorPlan = buildAgentStreamEmptyFinalErrorPlan({
          errorMessage: data.message,
          accumulatedContent: requestState.accumulatedContent,
          hasMeaningfulCompletionSignal:
            requestState.hasMeaningfulCompletionSignal,
          queuedTurnId: requestState.queuedTurnId,
        });
        if (emptyFinalErrorPlan.type === "missing_final_reply_failure") {
          finalizeMissingFinalReplyFailure(emptyFinalErrorPlan);
          break;
        }
        removeQueuedTurnState(emptyFinalErrorPlan.queuedTurnIds);
        finishRequestLog(requestState, emptyFinalErrorPlan.requestLogPayload);
        const gracefulContent = emptyFinalErrorPlan.finalContent;
        observer?.onComplete?.(gracefulContent);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...updateMessageArtifactsStatus(msg, "complete"),
                  ...buildAgentStreamCompletedAssistantMessagePatch({
                    parts: msg.contentParts,
                    finalContent: gracefulContent,
                    rawContent: requestState.accumulatedContent,
                    surfaceThinkingDeltas,
                  }),
                }
              : msg,
          ),
        );
        clearActiveStreamIfMatch(eventName);
        disposeListener();
        break;
      }

      const errorFailurePlan = buildAgentStreamErrorFailurePlan({
        errorMessage: data.message,
        queuedTurnId: requestState.queuedTurnId,
      });
      markFailedTimelineState(errorFailurePlan.errorMessage);
      removeQueuedTurnState(errorFailurePlan.queuedTurnIds);
      finishRequestLog(requestState, errorFailurePlan.requestLogPayload);
      observer?.onError?.(errorFailurePlan.errorMessage);
      applyAgentStreamErrorToastPlan(errorFailurePlan.toast, toast);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...updateMessageArtifactsStatus(msg, "error"),
                ...buildAgentStreamFailedAssistantMessagePatch({
                  errorMessage: errorFailurePlan.errorMessage,
                  accumulatedContent: requestState.accumulatedContent,
                  previousContent: msg.content,
                }),
              }
            : msg,
        ),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "warning": {
      const warningKey = `${activeSessionId}:${data.code || data.message}`;
      const warningPlan = buildAgentStreamWarningPlan({
        activeSessionId,
        alreadyWarned: warnedKeysRef.current.has(warningKey),
        code: data.code,
        message: data.message,
      });
      if (warningPlan.shouldMarkWarned && warningPlan.warningKey) {
        warnedKeysRef.current.add(warningPlan.warningKey);
      }
      applyAgentStreamWarningToastAction(
        buildAgentStreamWarningToastAction(warningPlan.toast),
        toast,
      );
      break;
    }

    default:
      break;
  }
}
