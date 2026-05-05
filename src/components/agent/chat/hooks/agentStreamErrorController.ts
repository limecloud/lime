import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildFailedAgentMessageContent,
  buildFailedAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";
import { resolveAgentRuntimeErrorPresentation } from "../utils/agentRuntimeErrorPresentation";

export interface AgentStreamErrorToastPlan {
  level: "error" | "warning";
  message: string;
}

export interface AgentStreamErrorToastDispatcher {
  error: (message: string) => void;
  warning: (message: string) => void;
}

interface AgentStreamErrorRequestLogPayload {
  eventType: "chat_request_error";
  status: "error";
  error: string;
}

export interface AgentStreamErrorFailurePlan {
  errorMessage: string;
  queuedTurnIds: string[];
  requestLogPayload: AgentStreamErrorRequestLogPayload;
  toast: AgentStreamErrorToastPlan;
}

export interface AgentStreamFailedTimelineStatePlan {
  activeSessionId: string;
  errorMessage: string;
  failedAt: string;
  pendingItemKey: string;
  pendingTurnKey: string;
}

const resolveQueuedTurnIds = (queuedTurnId?: string | null): string[] =>
  queuedTurnId ? [queuedTurnId] : [];

export function buildAgentStreamErrorToastPlan(
  errorMessage: string,
): AgentStreamErrorToastPlan {
  const lowerMessage = errorMessage.toLowerCase();
  if (errorMessage.includes("429") || lowerMessage.includes("rate limit")) {
    return {
      level: "warning",
      message: "请求过于频繁，请稍后重试",
    };
  }

  return {
    level: "error",
    message: resolveAgentRuntimeErrorPresentation(errorMessage).toastMessage,
  };
}

export function buildAgentStreamFailedAssistantMessagePatch(params: {
  accumulatedContent: string;
  errorMessage: string;
  previousContent: string;
  usage?: Message["usage"];
}): Pick<Message, "content" | "isThinking" | "runtimeStatus"> &
  Partial<Pick<Message, "usage">> {
  return {
    isThinking: false,
    content: buildFailedAgentMessageContent(
      params.errorMessage,
      params.accumulatedContent || params.previousContent,
    ),
    runtimeStatus: buildFailedAgentRuntimeStatus(params.errorMessage),
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };
}

export function buildAgentStreamErrorFailurePlan(params: {
  errorMessage: string;
  queuedTurnId?: string | null;
}): AgentStreamErrorFailurePlan {
  return {
    errorMessage: params.errorMessage,
    queuedTurnIds: resolveQueuedTurnIds(params.queuedTurnId),
    requestLogPayload: {
      eventType: "chat_request_error",
      status: "error",
      error: params.errorMessage,
    },
    toast: buildAgentStreamErrorToastPlan(params.errorMessage),
  };
}

export function applyAgentStreamErrorToastPlan(
  toastPlan: AgentStreamErrorToastPlan,
  dispatcher: AgentStreamErrorToastDispatcher,
): void {
  if (toastPlan.level === "warning") {
    dispatcher.warning(toastPlan.message);
    return;
  }

  dispatcher.error(toastPlan.message);
}

export function buildAgentStreamFailedTimelineStatePlan(params: {
  activeSessionId: string;
  errorMessage: string;
  failedAt: string;
  pendingItemKey: string;
  pendingTurnKey: string;
}): AgentStreamFailedTimelineStatePlan {
  return {
    activeSessionId: params.activeSessionId,
    errorMessage: params.errorMessage,
    failedAt: params.failedAt,
    pendingItemKey: params.pendingItemKey,
    pendingTurnKey: params.pendingTurnKey,
  };
}

export function selectAgentStreamFailedTimelineTurn(params: {
  activeSessionId: string;
  pendingTurnKey: string;
  turns: readonly AgentThreadTurn[];
}): AgentThreadTurn | null {
  const pendingTurn = params.turns.find(
    (turn) => turn.id === params.pendingTurnKey,
  );
  if (pendingTurn) {
    return pendingTurn;
  }

  return (
    [...params.turns]
      .reverse()
      .find(
        (turn) =>
          turn.thread_id === params.activeSessionId &&
          turn.status === "running",
      ) ?? null
  );
}

export function buildAgentStreamFailedTimelineTurnUpdate(params: {
  activeSessionId: string;
  errorMessage: string;
  failedAt: string;
  pendingTurnKey: string;
  turns: readonly AgentThreadTurn[];
}): AgentThreadTurn | null {
  const runningTurn = selectAgentStreamFailedTimelineTurn(params);
  if (!runningTurn) {
    return null;
  }

  return {
    ...runningTurn,
    status: "failed",
    error_message: params.errorMessage,
    completed_at: runningTurn.completed_at || params.failedAt,
    updated_at: params.failedAt,
  };
}

export function buildAgentStreamFailedTimelineItemUpdate(params: {
  errorMessage: string;
  failedAt: string;
  items: readonly AgentThreadItem[];
  pendingItemKey: string;
}): AgentThreadItem | null {
  const pendingItem = params.items.find(
    (item) => item.id === params.pendingItemKey,
  );
  if (!pendingItem || pendingItem.type !== "turn_summary") {
    return null;
  }

  const failedRuntimeStatus = buildFailedAgentRuntimeStatus(
    params.errorMessage,
  );
  return {
    ...pendingItem,
    status: "failed",
    completed_at: pendingItem.completed_at || params.failedAt,
    updated_at: params.failedAt,
    text: formatAgentRuntimeStatusSummary(failedRuntimeStatus),
  };
}
