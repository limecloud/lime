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
import type { ActionRequired, Message } from "../types";
import { appendTextToParts } from "./agentChatHistory";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import { WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE } from "./agentChatCoreUtils";
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
  buildFailedAgentMessageContent,
  buildFailedAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";
import { resolveAgentRuntimeErrorPresentation } from "../utils/agentRuntimeErrorPresentation";
import { normalizeLegacyRuntimeStatusTitle } from "@/lib/api/agentTextNormalization";
import { resolveRuntimeWarningToastPresentation } from "./runtimeWarningPresentation";
import { buildQueuedRuntimeStatus } from "./agentStreamSubmitDraft";
import {
  applyModelChangeExecutionRuntime,
  applyTurnContextExecutionRuntime,
} from "../utils/sessionExecutionRuntime";
import {
  containsAssistantProtocolResidue,
  stripAssistantProtocolResidue,
} from "../utils/protocolResidue";
import { normalizeIncomingToolResult } from "./agentChatToolResult";
import { hasMeaningfulSiteToolResultSignal } from "../utils/siteToolResultSummary";
import {
  buildImageTaskPreviewFromToolResult,
  buildTaskPreviewFromToolResult,
  buildToolResultArtifactFromToolResult,
} from "../utils/taskPreviewFromToolResult";

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
  requestFinished: boolean;
  queuedDraftCleanupTimerId?: ReturnType<typeof setTimeout> | null;
}

const EMPTY_FINAL_REPLY_ERROR_HINT = "模型未输出最终答复";
const EMPTY_FINAL_REPLY_ERROR_MESSAGE = "模型未输出最终答复，请重试";
const EMPTY_FINAL_REPLY_FALLBACK_CONTENT =
  "本轮执行已完成，详细过程与产物已保留在当前对话中。";
const QUEUED_DRAFT_CLEANUP_GRACE_MS = 1800;

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
  payload: {
    eventType: "chat_request_complete" | "chat_request_error";
    status: "success" | "error";
    description?: string;
    error?: string;
  },
) {
  if (!requestState.requestLogId || requestState.requestFinished) {
    return;
  }

  requestState.requestFinished = true;
  activityLogger.updateLog(requestState.requestLogId, {
    eventType: payload.eventType,
    status: payload.status,
    duration: Date.now() - requestState.requestStartedAt,
    description: payload.description,
    error: payload.error,
  });
}

function shouldDeferHighFrequencyThreadItemUpdate(
  item: AgentThreadItem,
): boolean {
  return (
    item.status === "in_progress" &&
    (item.type === "reasoning" || item.type === "agent_message")
  );
}

function hasMeaningfulCompletionSignalFromToolResult(params: {
  toolId: string;
  toolName: string;
  normalizedResult:
    | {
        metadata?: unknown;
      }
    | undefined;
}): boolean {
  const resultRecord =
    params.normalizedResult &&
    typeof params.normalizedResult === "object" &&
    !Array.isArray(params.normalizedResult)
      ? (params.normalizedResult as Record<string, unknown>)
      : undefined;

  if (hasMeaningfulSiteToolResultSignal(resultRecord?.metadata)) {
    return true;
  }

  const previewParams = {
    toolId: params.toolId,
    toolName: params.toolName,
    toolArguments: undefined,
    toolResult: resultRecord,
    fallbackPrompt: "",
  };

  return Boolean(
    buildImageTaskPreviewFromToolResult(previewParams) ||
    buildTaskPreviewFromToolResult(previewParams) ||
    buildToolResultArtifactFromToolResult(previewParams),
  );
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
    if (requestState.queuedDraftCleanupTimerId) {
      clearTimeout(requestState.queuedDraftCleanupTimerId);
      requestState.queuedDraftCleanupTimerId = null;
    }
  };

  const scheduleQueuedDraftCleanup = (shouldWatchCurrentRequest: boolean) => {
    clearQueuedDraftCleanupTimer();
    if (!shouldWatchCurrentRequest || isStreamActivated()) {
      return;
    }

    requestState.queuedDraftCleanupTimerId = setTimeout(() => {
      requestState.queuedDraftCleanupTimerId = null;
      if (requestState.requestFinished || isStreamActivated()) {
        return;
      }
      disposeListener();
      removeQueuedDraftMessages();
    }, QUEUED_DRAFT_CLEANUP_GRACE_MS);
  };

  const markFailedTimelineState = (errorMessage: string) => {
    const failedAt = new Date().toISOString();
    const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errorMessage);

    setThreadTurns((prev) => {
      const runningTurn =
        prev.find((turn) => turn.id === pendingTurnKey) ||
        [...prev]
          .reverse()
          .find(
            (turn) =>
              turn.thread_id === activeSessionId && turn.status === "running",
          );

      if (!runningTurn) {
        return prev;
      }

      return upsertThreadTurnState(prev, {
        ...runningTurn,
        status: "failed",
        error_message: errorMessage,
        completed_at: runningTurn.completed_at || failedAt,
        updated_at: failedAt,
      });
    });

    setThreadItems((prev) => {
      const pendingItem = prev.find((item) => item.id === pendingItemKey);
      if (!pendingItem || pendingItem.type !== "turn_summary") {
        return prev;
      }

      return upsertThreadItemState(prev, {
        ...pendingItem,
        status: "failed",
        completed_at: pendingItem.completed_at || failedAt,
        updated_at: failedAt,
        text: formatAgentRuntimeStatusSummary(failedRuntimeStatus),
      });
    });
  };

  const resolveGracefulCompletionContent = () => {
    const rawFinalContent = requestState.accumulatedContent.trim();
    const cleanedFinalContent = stripAssistantProtocolResidue(
      requestState.accumulatedContent,
    );
    return (
      cleanedFinalContent ||
      (!containsAssistantProtocolResidue(requestState.accumulatedContent)
        ? rawFinalContent
        : "") ||
      EMPTY_FINAL_REPLY_FALLBACK_CONTENT
    );
  };

  const finalizeMissingFinalReplyFailure = (
    errorMessage: string,
    usage?: Message["usage"],
  ) => {
    markFailedTimelineState(errorMessage);
    removeQueuedTurnState(
      requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
    );
    finishRequestLog(requestState, {
      eventType: "chat_request_error",
      status: "error",
      error: errorMessage,
    });
    observer?.onError?.(errorMessage);
    const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errorMessage);
    toast.error(EMPTY_FINAL_REPLY_ERROR_MESSAGE);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...updateMessageArtifactsStatus(msg, "error"),
              isThinking: false,
              content: buildFailedAgentMessageContent(
                errorMessage,
                requestState.accumulatedContent || msg.content,
              ),
              runtimeStatus: failedRuntimeStatus,
              usage: usage ?? msg.usage,
            }
          : msg,
      ),
    );
    clearActiveStreamIfMatch(eventName);
    disposeListener();
  };

  const markQueuedDraftState = (queuedMessageText?: string | null) => {
    clearActiveStreamIfMatch(eventName);
    clearOptimisticItem();
    clearOptimisticTurn();
    setIsSending(false);

    const queuedRuntimeStatus = buildQueuedRuntimeStatus(
      effectiveExecutionStrategy,
      queuedMessageText?.trim() || content,
      webSearch,
    );

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              isThinking: false,
              runtimeStatus: queuedRuntimeStatus,
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
        !requestState.queuedTurnId ||
          requestState.queuedTurnId === data.queued_turn_id,
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
        !requestState.queuedTurnId ||
          data.queued_turn_ids.includes(requestState.queuedTurnId),
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
        if (!pendingItem) {
          return prev;
        }

        return upsertThreadItemState(
          removeThreadItemState(prev, pendingItemKey),
          {
            ...pendingItem,
            thread_id: data.turn.thread_id,
            turn_id: data.turn.id,
            updated_at:
              data.turn.updated_at ||
              data.turn.started_at ||
              pendingItem.updated_at,
          },
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
      if (shouldDeferHighFrequencyThreadItemUpdate(data.item)) {
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
        const normalizedStatus = {
          ...data.status,
          title: normalizeLegacyRuntimeStatusTitle(data.status.title),
        };
        const nextSummaryText =
          formatAgentRuntimeStatusSummary(normalizedStatus);
        const updatedAt = new Date().toISOString();
        setThreadItems((prev) => {
          const runtimeSummaryItem =
            prev.find((item) => item.id === pendingItemKey) ||
            [...prev]
              .reverse()
              .find(
                (item) =>
                  item.thread_id === activeSessionId &&
                  item.type === "turn_summary" &&
                  item.status === "in_progress",
              );
          if (
            !runtimeSummaryItem ||
            runtimeSummaryItem.type !== "turn_summary"
          ) {
            return prev;
          }

          return upsertThreadItemState(prev, {
            ...runtimeSummaryItem,
            text: nextSummaryText,
            updated_at: updatedAt,
          });
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  runtimeStatus: normalizedStatus,
                }
              : msg,
          ),
        );
      }
      break;

    case "turn_context":
      activateStream();
      setExecutionRuntime((current) =>
        applyTurnContextExecutionRuntime(current, data),
      );
      break;

    case "model_change":
      activateStream();
      setExecutionRuntime((current) =>
        applyModelChangeExecutionRuntime(current, data),
      );
      break;

    case "thinking_delta":
      activateStream();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                isThinking: true,
                thinkingContent: (msg.thinkingContent || "") + data.text,
                contentParts: appendThinkingToParts(
                  msg.contentParts || [],
                  data.text,
                ),
              }
            : msg,
        ),
      );
      break;

    case "text_delta":
      activateStream();
      clearOptimisticItem();
      requestState.accumulatedContent += data.text;
      observer?.onTextDelta?.(data.text, requestState.accumulatedContent);
      playTypewriterSound();
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: requestState.accumulatedContent,
                thinkingContent: undefined,
                contentParts: appendTextToParts(
                  msg.contentParts || [],
                  data.text,
                ),
              }
            : msg,
        ),
      );
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
        const normalizedResult = normalizeIncomingToolResult(data.result);
        const toolName = toolNameByToolId.get(data.tool_id) || "";
        if (
          hasMeaningfulCompletionSignalFromToolResult({
            toolId: data.tool_id,
            toolName,
            normalizedResult,
          })
        ) {
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
      activateStream();
      clearOptimisticItem();
      requestState.hasMeaningfulCompletionSignal = true;
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
      activateStream();
      clearOptimisticItem();
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
      activateStream();
      clearOptimisticItem();
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
      clearOptimisticItem();
      clearOptimisticTurn();
      const rawFinalContent = requestState.accumulatedContent.trim();
      const cleanedFinalContent = stripAssistantProtocolResidue(
        requestState.accumulatedContent,
      );
      const missingFinalReply =
        !cleanedFinalContent &&
        (containsAssistantProtocolResidue(requestState.accumulatedContent) ||
          !rawFinalContent);
      if (missingFinalReply && !requestState.hasMeaningfulCompletionSignal) {
        finalizeMissingFinalReplyFailure(
          EMPTY_FINAL_REPLY_ERROR_MESSAGE,
          data.usage,
        );
        break;
      }

      removeQueuedTurnState(
        requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
      );
      finishRequestLog(requestState, {
        eventType: "chat_request_complete",
        status: "success",
        description: `请求完成，工具调用 ${toolLogIdByToolId.size} 次`,
      });
      const finalContent = resolveGracefulCompletionContent();
      observer?.onComplete?.(finalContent);
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMsgId) {
            return msg;
          }

          return {
            ...updateMessageArtifactsStatus(msg, "complete"),
            isThinking: false,
            content: finalContent,
            runtimeStatus: undefined,
            usage: data.usage ?? msg.usage,
          };
        }),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "error": {
      clearQueuedDraftCleanupTimer();
      if (data.message.includes(EMPTY_FINAL_REPLY_ERROR_HINT)) {
        clearOptimisticItem();
        clearOptimisticTurn();
        if (!requestState.hasMeaningfulCompletionSignal) {
          finalizeMissingFinalReplyFailure(data.message);
          break;
        }
        removeQueuedTurnState(
          requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
        );
        finishRequestLog(requestState, {
          eventType: "chat_request_complete",
          status: "success",
          description: "请求完成，模型未补充最终总结，已降级保留当前过程结果",
        });
        const gracefulContent = resolveGracefulCompletionContent();
        observer?.onComplete?.(gracefulContent);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...updateMessageArtifactsStatus(msg, "complete"),
                  isThinking: false,
                  content: gracefulContent,
                  runtimeStatus: undefined,
                }
              : msg,
          ),
        );
        clearActiveStreamIfMatch(eventName);
        disposeListener();
        break;
      }

      markFailedTimelineState(data.message);
      removeQueuedTurnState(
        requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
      );
      finishRequestLog(requestState, {
        eventType: "chat_request_error",
        status: "error",
        error: data.message,
      });
      observer?.onError?.(data.message);
      const failedRuntimeStatus = buildFailedAgentRuntimeStatus(data.message);
      if (
        data.message.includes("429") ||
        data.message.toLowerCase().includes("rate limit")
      ) {
        toast.warning("请求过于频繁，请稍后重试");
      } else {
        toast.error(
          resolveAgentRuntimeErrorPresentation(data.message).toastMessage,
        );
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...updateMessageArtifactsStatus(msg, "error"),
                isThinking: false,
                content: buildFailedAgentMessageContent(
                  data.message,
                  requestState.accumulatedContent || msg.content,
                ),
                runtimeStatus: failedRuntimeStatus,
              }
            : msg,
        ),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "warning": {
      if (data.code === WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE) {
        break;
      }
      const warningKey = `${activeSessionId}:${data.code || data.message}`;
      if (!warnedKeysRef.current.has(warningKey)) {
        warnedKeysRef.current.add(warningKey);
        const presentation = resolveRuntimeWarningToastPresentation({
          code: data.code,
          message: data.message,
        });
        if (!presentation.shouldToast) {
          break;
        }
        switch (presentation.level) {
          case "info":
            toast.info(presentation.message);
            break;
          case "error":
            toast.error(presentation.message);
            break;
          case "warning":
          default:
            toast.warning(presentation.message);
            break;
        }
      }
      break;
    }

    default:
      break;
  }
}
