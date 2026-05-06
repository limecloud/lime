import type { Message } from "../types";
import {
  containsAssistantProtocolResidue,
  stripAssistantProtocolResidue,
} from "../utils/protocolResidue";

export const AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_HINT =
  "模型未输出最终答复";
export const AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE =
  "模型未输出最终答复，请重试";
export const AGENT_STREAM_EMPTY_FINAL_REPLY_FALLBACK_CONTENT =
  "本轮执行已完成，详细过程与产物已保留在当前对话中。";

interface AgentStreamCompletionRequestLogPayload {
  eventType: "chat_request_complete";
  status: "success";
  description: string;
}

interface AgentStreamCompletionErrorRequestLogPayload {
  eventType: "chat_request_error";
  status: "error";
  error: string;
}

export interface AgentStreamMissingFinalReplyPlan {
  type: "missing_final_reply_failure";
  errorMessage: string;
  queuedTurnIds: string[];
  requestLogPayload: AgentStreamCompletionErrorRequestLogPayload;
  toastMessage: string;
  usage?: Message["usage"];
}

export interface AgentStreamMissingFinalReplyFailureSideEffectPlan {
  errorMessage: string;
  observerErrorMessage: string;
  queuedTurnIds: string[];
  requestLogPayload: AgentStreamCompletionErrorRequestLogPayload;
  shouldClearActiveStream: boolean;
  shouldClearPendingTextRenderTimer: boolean;
  shouldDisposeListener: boolean;
  shouldMarkFailedTimeline: boolean;
  toastMessage: string;
  usage?: Message["usage"];
}

interface AgentStreamCompletionSuccessPlan {
  type: "complete";
  finalContent: string;
  queuedTurnIds: string[];
  requestLogPayload: AgentStreamCompletionRequestLogPayload;
}

export type AgentStreamFinalDonePlan =
  | AgentStreamMissingFinalReplyPlan
  | AgentStreamCompletionSuccessPlan;

export type AgentStreamEmptyFinalErrorPlan =
  | AgentStreamMissingFinalReplyPlan
  | AgentStreamCompletionSuccessPlan;

const resolveQueuedTurnIds = (queuedTurnId?: string | null): string[] =>
  queuedTurnId ? [queuedTurnId] : [];

export function buildAgentStreamMissingFinalReplyFailurePlan(params: {
  errorMessage: string;
  queuedTurnId?: string | null;
  usage?: Message["usage"];
}): AgentStreamMissingFinalReplyPlan {
  return {
    type: "missing_final_reply_failure",
    errorMessage: params.errorMessage,
    queuedTurnIds: resolveQueuedTurnIds(params.queuedTurnId),
    requestLogPayload: {
      eventType: "chat_request_error",
      status: "error",
      error: params.errorMessage,
    },
    toastMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };
}

export function buildAgentStreamMissingFinalReplyFailureSideEffectPlan(
  failurePlan: AgentStreamMissingFinalReplyPlan,
): AgentStreamMissingFinalReplyFailureSideEffectPlan {
  return {
    errorMessage: failurePlan.errorMessage,
    observerErrorMessage: failurePlan.errorMessage,
    queuedTurnIds: failurePlan.queuedTurnIds,
    requestLogPayload: failurePlan.requestLogPayload,
    shouldClearActiveStream: true,
    shouldClearPendingTextRenderTimer: true,
    shouldDisposeListener: true,
    shouldMarkFailedTimeline: true,
    toastMessage: failurePlan.toastMessage,
    ...(failurePlan.usage !== undefined ? { usage: failurePlan.usage } : {}),
  };
}

export function isAgentStreamEmptyFinalReplyError(message: string): boolean {
  return message.includes(AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_HINT);
}

export function shouldFailAgentStreamMissingFinalReply(params: {
  accumulatedContent: string;
  hasMeaningfulCompletionSignal?: boolean;
}): boolean {
  if (params.hasMeaningfulCompletionSignal) {
    return false;
  }

  const rawFinalContent = params.accumulatedContent.trim();
  const cleanedFinalContent = stripAssistantProtocolResidue(
    params.accumulatedContent,
  );

  return (
    !cleanedFinalContent &&
    (containsAssistantProtocolResidue(params.accumulatedContent) ||
      !rawFinalContent)
  );
}

export function resolveAgentStreamGracefulCompletionContent(params: {
  accumulatedContent: string;
  fallbackContent?: string;
}): string {
  const rawFinalContent = params.accumulatedContent.trim();
  const cleanedFinalContent = stripAssistantProtocolResidue(
    params.accumulatedContent,
  );

  return (
    cleanedFinalContent ||
    (!containsAssistantProtocolResidue(params.accumulatedContent)
      ? rawFinalContent
      : "") ||
    params.fallbackContent ||
    AGENT_STREAM_EMPTY_FINAL_REPLY_FALLBACK_CONTENT
  );
}

export function reconcileAgentStreamFinalContentParts(params: {
  parts: Message["contentParts"];
  finalContent: string;
  rawContent: string;
  surfaceThinkingDeltas: boolean;
}): Message["contentParts"] {
  if (!params.parts?.length) {
    return params.parts;
  }

  const visibleParts = params.surfaceThinkingDeltas
    ? params.parts
    : params.parts.filter((part) => part.type !== "thinking");
  if (visibleParts.length === 0) {
    return undefined;
  }

  const textContent = visibleParts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const finalTextChanged =
    params.finalContent !== params.rawContent ||
    (textContent.length > 0 && textContent !== params.finalContent);

  if (!finalTextChanged) {
    return visibleParts;
  }

  const processParts = visibleParts.filter((part) => part.type !== "text");
  if (processParts.length === 0) {
    return params.finalContent
      ? [{ type: "text", text: params.finalContent }]
      : undefined;
  }

  return params.finalContent
    ? [...processParts, { type: "text", text: params.finalContent }]
    : processParts;
}

export function buildAgentStreamCompletedAssistantMessagePatch(params: {
  finalContent: string;
  parts: Message["contentParts"];
  rawContent: string;
  surfaceThinkingDeltas: boolean;
  thinkingContent?: string;
  usage?: Message["usage"];
}): Pick<Message, "content" | "contentParts" | "isThinking" | "runtimeStatus"> &
  Partial<Pick<Message, "thinkingContent">> &
  Partial<Pick<Message, "usage">> {
  const retainedThinkingContent = params.surfaceThinkingDeltas
    ? params.thinkingContent?.trim() || undefined
    : undefined;

  return {
    isThinking: false,
    content: params.finalContent,
    thinkingContent: retainedThinkingContent,
    contentParts: reconcileAgentStreamFinalContentParts({
      parts: params.parts,
      finalContent: params.finalContent,
      rawContent: params.rawContent,
      surfaceThinkingDeltas: params.surfaceThinkingDeltas,
    }),
    runtimeStatus: undefined,
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };
}

export function buildAgentStreamFinalDonePlan(params: {
  accumulatedContent: string;
  hasMeaningfulCompletionSignal?: boolean;
  queuedTurnId?: string | null;
  toolCallCount: number;
  usage?: Message["usage"];
}): AgentStreamFinalDonePlan {
  if (
    shouldFailAgentStreamMissingFinalReply({
      accumulatedContent: params.accumulatedContent,
      hasMeaningfulCompletionSignal: params.hasMeaningfulCompletionSignal,
    })
  ) {
    return buildAgentStreamMissingFinalReplyFailurePlan({
      errorMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
      queuedTurnId: params.queuedTurnId,
      usage: params.usage,
    });
  }

  return {
    type: "complete",
    finalContent: resolveAgentStreamGracefulCompletionContent({
      accumulatedContent: params.accumulatedContent,
    }),
    queuedTurnIds: resolveQueuedTurnIds(params.queuedTurnId),
    requestLogPayload: {
      eventType: "chat_request_complete",
      status: "success",
      description: `请求完成，工具调用 ${params.toolCallCount} 次`,
    },
  };
}

export function buildAgentStreamEmptyFinalErrorPlan(params: {
  errorMessage: string;
  accumulatedContent: string;
  hasMeaningfulCompletionSignal?: boolean;
  queuedTurnId?: string | null;
}): AgentStreamEmptyFinalErrorPlan {
  if (!params.hasMeaningfulCompletionSignal) {
    return buildAgentStreamMissingFinalReplyFailurePlan({
      errorMessage: params.errorMessage,
      queuedTurnId: params.queuedTurnId,
    });
  }

  return {
    type: "complete",
    finalContent: resolveAgentStreamGracefulCompletionContent({
      accumulatedContent: params.accumulatedContent,
    }),
    queuedTurnIds: resolveQueuedTurnIds(params.queuedTurnId),
    requestLogPayload: {
      eventType: "chat_request_complete",
      status: "success",
      description: "请求完成，模型未补充最终总结，已降级保留当前过程结果",
    },
  };
}
