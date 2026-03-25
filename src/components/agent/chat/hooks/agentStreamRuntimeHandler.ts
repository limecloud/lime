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
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
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
import {
  applyModelChangeExecutionRuntime,
  applyTurnContextExecutionRuntime,
} from "../utils/sessionExecutionRuntime";

type MessageParts = NonNullable<Message["contentParts"]>;

interface StreamObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface StreamRequestState {
  accumulatedContent: string;
  queuedTurnId: string | null;
  requestLogId: string | null;
  requestStartedAt: number;
  requestFinished: boolean;
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
  runtime: AgentRuntimeAdapter;
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
  runtime,
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

  switch (data.type) {
    case "thread_started":
      break;

    case "queue_added":
      requestState.queuedTurnId = data.queued_turn.queued_turn_id;
      upsertQueuedTurn(data.queued_turn);
      break;

    case "queue_removed":
      removeQueuedTurnState([data.queued_turn_id]);
      if (
        !isStreamActivated() &&
        (!requestState.queuedTurnId ||
          requestState.queuedTurnId === data.queued_turn_id)
      ) {
        disposeListener();
        removeQueuedDraftMessages();
      }
      break;

    case "queue_started":
      requestState.queuedTurnId = data.queued_turn_id;
      removeQueuedTurnState([data.queued_turn_id]);
      activateStream();
      break;

    case "queue_cleared":
      removeQueuedTurnState(data.queued_turn_ids);
      if (
        !isStreamActivated() &&
        (!requestState.queuedTurnId ||
          data.queued_turn_ids.includes(requestState.queuedTurnId))
      ) {
        disposeListener();
        removeQueuedDraftMessages();
      }
      break;

    case "turn_started":
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
    case "item_updated":
    case "item_completed":
      activateStream();
      setThreadItems((prev) =>
        upsertThreadItemState(
          removeThreadItemState(prev, pendingItemKey),
          data.item,
        ),
      );
      break;

    case "turn_completed":
    case "turn_failed":
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
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                runtimeStatus: data.status,
              }
            : msg,
        ),
      );
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
                contentParts: appendTextToParts(msg.contentParts || [], data.text),
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
      clearOptimisticItem();
      clearOptimisticTurn();
      removeQueuedTurnState(requestState.queuedTurnId ? [requestState.queuedTurnId] : []);
      finishRequestLog(requestState, {
        eventType: "chat_request_complete",
        status: "success",
        description: `请求完成，工具调用 ${toolLogIdByToolId.size} 次`,
      });
      const finalContent =
        requestState.accumulatedContent.trim() ||
        "已完成工具执行，但模型未输出最终答复，请重试。";
      if (!requestState.accumulatedContent.trim()) {
        toast.error("已完成工具执行，但模型未输出最终答复，请重试");
      }
      observer?.onComplete?.(finalContent);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...updateMessageArtifactsStatus(msg, "complete"),
                isThinking: false,
                content: finalContent,
                runtimeStatus: undefined,
              }
            : msg,
        ),
      );
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      break;
    }

    case "error": {
      markFailedTimelineState(data.message);
      removeQueuedTurnState(requestState.queuedTurnId ? [requestState.queuedTurnId] : []);
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
        toast.error(`响应错误: ${data.message}`);
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
        toast.warning(data.message);
      }
      break;
    }

    default:
      break;
  }
}
