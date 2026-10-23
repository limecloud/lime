import type { AgentEvent, AgentThreadItem } from "@/lib/api/agentProtocol";
import type { Message } from "../types";
import {
  applyAcknowledgedActionRequests,
  removeActionsByRequestIds,
} from "./agentChatActionState";
import { appendTextToParts } from "./agentChatHistory";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  isStreamedReasoningTimelineItem,
  removeStreamedReasoningTimelineItems,
  resetStreamedReasoningSegment,
} from "./agentStreamReasoningTimeline";
import {
  buildAgentStreamTerminalCompletionPlan,
  buildAgentStreamMissingFinalReplyFailurePlan,
  type AgentStreamTerminalCompletionPlan,
  type AgentStreamMissingFinalReplyPlan,
} from "./agentStreamCompletionController";
import { buildAgentStreamTurnStartedPendingItemUpdate } from "./agentStreamThreadItemController";
import { reconcileAgentStreamProjectionItems } from "./agentStreamConversationProjection";
import {
  bindSubmissionMessagesToRuntimeTurn,
  extractVisibleTextFromAgentMessage,
} from "./agentStreamRuntimeHandlerUtils";
import {
  clearActiveTextSegmentState,
  resolveAccumulatedFinalContentForCompletion,
} from "./agentStreamTextDeltaLifecycle";
import { clearAgentStreamTextOverlay } from "./agentStreamTextOverlayStore";
import {
  isAgentMessageFinalAnswerPhase,
  resolveFinalAgentMessageItemIds,
  shouldUseAgentMessageAsFinalText,
} from "../utils/agentMessagePhase";
import { resolveAgentRuntimeErrorPresentation } from "../utils/agentRuntimeErrorPresentation";
import type {
  HandleTurnStreamEventOptions,
  StreamRequestState,
} from "./agentStreamRuntimeHandlerTypes";

type RuntimeHandlerStateSetters = Pick<
  HandleTurnStreamEventOptions,
  | "getThreadItems"
  | "setPendingActions"
  | "setCurrentTurnId"
  | "setMessages"
  | "setThreadItems"
  | "setThreadTurns"
>;

type AgentStreamCompletionCompletePlan = Extract<
  AgentStreamTerminalCompletionPlan,
  { type: "complete" }
>;

type AgentStreamCompletionMessagePlan = Pick<
  AgentStreamCompletionCompletePlan,
  "finalContent" | "requestLogPayload"
> & {
  usage?: Message["usage"];
};

function noteCompletedTextAsAssistantReplyIfNeeded(
  requestState: StreamRequestState,
) {
  if (!requestState.hasFinalAnswerRequiredProcessBoundary) {
    return;
  }
  requestState.hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary = true;
}

function syncFinalAgentMessageSnapshotToRequestState(params: {
  assistantMsgId: string;
  event: Extract<
    AgentEvent,
    { type: "item_started" | "item_completed" | "item_updated" }
  >;
  requestState: StreamRequestState;
  projectedItems?: readonly AgentThreadItem[];
  shouldPreserveAssistantContent?: boolean;
}): void {
  const item = params.event.item;
  const latestProcessSequence =
    params.requestState.maxFinalAnswerRequiredProcessEventSequence ??
    params.requestState.maxProcessEventSequence;
  if (params.shouldPreserveAssistantContent || item.type !== "agent_message") {
    return;
  }
  if (!shouldUseAgentMessageAsFinalText(item.phase)) {
    if (
      params.requestState.activeTextSegmentItemId !== item.id ||
      params.requestState.activeTextSegmentTurnId !== item.turn_id
    ) {
      return;
    }
    // A delta may arrive before its phase. Recover from the same canonical projection.
    const candidates = (params.projectedItems ?? []).filter(
      (
        candidate,
      ): candidate is Extract<AgentThreadItem, { type: "agent_message" }> =>
        candidate.type === "agent_message" &&
        candidate.thread_id === item.thread_id &&
        candidate.turn_id === item.turn_id &&
        candidate.id !== item.id &&
        (!params.requestState.hasFinalAnswerRequiredProcessBoundary ||
          (typeof latestProcessSequence === "number" &&
            candidate.sequence > latestProcessSequence)),
    );
    const selected = resolveFinalAgentMessageItemIds(candidates);
    const previousFinal = candidates
      .filter((candidate) => selected.has(candidate.id))
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    params.requestState.accumulatedContent = "";
    params.requestState.renderedContent = "";
    params.requestState.latestAssistantTextEventSequence = null;
    params.requestState.hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary = false;
    clearActiveTextSegmentState(params.requestState);
    clearAgentStreamTextOverlay(params.assistantMsgId);
    if (previousFinal) {
      syncFinalAgentMessageSnapshotToRequestState({
        ...params,
        event: { ...params.event, item: previousFinal },
      });
    }
    return;
  }
  if (
    (params.requestState.hasFinalAnswerRequiredProcessBoundary &&
      (typeof latestProcessSequence !== "number" ||
        item.sequence <= latestProcessSequence)) ||
    !item.text.trim()
  ) {
    return;
  }

  const existingContent = params.requestState.accumulatedContent;
  const isSameActiveItem =
    params.requestState.activeTextSegmentItemId === item.id;
  const nextContent =
    isSameActiveItem &&
    existingContent.length > item.text.length &&
    existingContent.startsWith(item.text)
      ? existingContent
      : item.text;
  params.requestState.accumulatedContent = nextContent;
  params.requestState.renderedContent = nextContent;
  params.requestState.activeTextSegmentItemId = item.id;
  params.requestState.activeTextSegmentPhase = item.phase ?? null;
  params.requestState.activeTextSegmentSequence = item.sequence;
  params.requestState.activeTextSegmentTurnId = item.turn_id;
  params.requestState.activeTextSegmentStartOffset = 0;
  params.requestState.activeTextSegmentFinalEligibility =
    isAgentMessageFinalAnswerPhase(item.phase)
      ? "explicit_final"
      : "item_scoped_legacy";
  params.requestState.latestAssistantTextEventSequence = Math.max(
    params.requestState.latestAssistantTextEventSequence ??
      Number.NEGATIVE_INFINITY,
    item.sequence,
  );

  if (
    params.requestState.hasFinalAnswerRequiredProcessBoundary &&
    (typeof latestProcessSequence !== "number" ||
      item.sequence > latestProcessSequence)
  ) {
    params.requestState.hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary = true;
  }
}

export function handleAgentStreamMessageSnapshotEvent(params: {
  assistantMsgId: string;
  event: Extract<AgentEvent, { type: "message" }>;
  requestState: StreamRequestState;
  setMessages: RuntimeHandlerStateSetters["setMessages"];
  shouldPreserveAssistantContent: boolean;
  surfaceThinkingDeltas: boolean;
}): void {
  const snapshotText = extractVisibleTextFromAgentMessage(params.event.message);
  const shouldPrefillVisibleText =
    !params.shouldPreserveAssistantContent &&
    params.event.message.role === "assistant" &&
    !params.requestState.renderedContent &&
    !params.requestState.accumulatedContent &&
    snapshotText.trim().length > 0;
  if (!shouldPrefillVisibleText) {
    return;
  }

  params.requestState.accumulatedContent = snapshotText;
  params.requestState.renderedContent = snapshotText;
  params.requestState.prefilledMessageSnapshotReplayOffset = 0;
  params.requestState.prefilledMessageSnapshotText = snapshotText;
  if (!params.requestState.firstTextRenderFlushAt) {
    params.requestState.firstTextRenderFlushAt = Date.now();
  }
  params.setMessages((prev) =>
    prev.map((msg) =>
      msg.id === params.assistantMsgId
        ? {
            ...msg,
            content: snapshotText,
            contentParts: appendTextToParts(
              params.surfaceThinkingDeltas
                ? msg.contentParts || []
                : (msg.contentParts || []).filter(
                    (part) => part.type !== "thinking",
                  ),
              snapshotText,
            ),
          }
        : msg,
    ),
  );
}

export function handleAgentStreamTurnStartedEvent(params: {
  assistantMsgId: string;
  event: Extract<AgentEvent, { type: "turn_started" }>;
  pendingItemKey: string;
  pendingTurnKey: string;
  requestState: StreamRequestState;
  setters: RuntimeHandlerStateSetters;
}): void {
  params.requestState.currentTurnId = params.event.turn.id;
  bindSubmissionMessagesToRuntimeTurn(
    params.setters.setMessages,
    params.assistantMsgId,
    params.pendingTurnKey,
    params.event.turn.id,
  );
  params.setters.setCurrentTurnId(params.event.turn.id);
  params.setters.setThreadTurns((prev) =>
    upsertThreadTurnState(
      removeThreadTurnState(prev, params.pendingTurnKey),
      params.event.turn,
    ),
  );
  params.setters.setThreadItems((prev) => {
    const pendingItem = prev.find((item) => item.id === params.pendingItemKey);
    const updatedPendingItem = buildAgentStreamTurnStartedPendingItemUpdate({
      pendingItem,
      turn: params.event.turn,
    });
    if (!updatedPendingItem) {
      return prev;
    }

    return upsertThreadItemState(
      removeThreadItemState(prev, params.pendingItemKey),
      updatedPendingItem,
    );
  });
}

export function handleAgentStreamThreadItemLifecycleEvent(params: {
  assistantMsgId: string;
  event: Extract<
    AgentEvent,
    { type: "item_started" | "item_completed" | "item_updated" }
  >;
  pendingItemKey: string;
  pendingTurnKey: string;
  projectedItems?: readonly AgentThreadItem[];
  requestState: StreamRequestState;
  shouldPreserveAssistantContent?: boolean;
  setters: RuntimeHandlerStateSetters;
}): void {
  params.requestState.currentTurnId = params.event.item.turn_id;
  bindSubmissionMessagesToRuntimeTurn(
    params.setters.setMessages,
    params.assistantMsgId,
    params.pendingTurnKey,
    params.event.item.turn_id,
  );
  params.setters.setCurrentTurnId(params.event.item.turn_id);
  params.setters.setThreadTurns((prev) => {
    const pendingTurn = prev.find((turn) => turn.id === params.pendingTurnKey);
    if (!pendingTurn || pendingTurn.id === params.event.item.turn_id) {
      return prev;
    }

    const turnsWithoutPending = removeThreadTurnState(
      prev,
      params.pendingTurnKey,
    );
    if (
      turnsWithoutPending.some((turn) => turn.id === params.event.item.turn_id)
    ) {
      return turnsWithoutPending;
    }

    return upsertThreadTurnState(turnsWithoutPending, {
      ...pendingTurn,
      id: params.event.item.turn_id,
      thread_id: params.event.item.thread_id || pendingTurn.thread_id,
      updated_at: params.event.item.updated_at || pendingTurn.updated_at,
    });
  });
  params.setters.setThreadItems((prev) => {
    const currentItems =
      params.event.item.type === "reasoning"
        ? removeStreamedReasoningTimelineItems(
            removeThreadItemState(prev, params.pendingItemKey),
            params.event.item.turn_id,
          )
        : removeThreadItemState(prev, params.pendingItemKey);
    const nextItems = params.projectedItems
      ? reconcileAgentStreamProjectionItems({
          current: currentItems,
          pendingItemKey: params.pendingItemKey,
          projected: params.projectedItems,
        })
      : upsertThreadItemState(currentItems, params.event.item);
    return nextItems;
  });
  syncFinalAgentMessageSnapshotToRequestState(params);
  if (
    params.event.item.type === "approval_request" &&
    (params.event.item.status === "completed" ||
      params.event.item.status === "failed")
  ) {
    const requestIds = new Set([params.event.item.request_id]);
    params.setters.setPendingActions((prev) =>
      removeActionsByRequestIds(prev, requestIds),
    );
    params.setters.setMessages((prev) =>
      applyAcknowledgedActionRequests({
        messages: prev,
        requestIds,
        shouldPersistSubmittedAction: false,
      }),
    );
  }
}

export function handleAgentStreamTurnCompletedEvent(params: {
  assistantFallbackContent?: string | null;
  assistantMsgId: string;
  completeAssistantStreamMessageFromCompletionPlan: (
    plan: AgentStreamCompletionMessagePlan,
  ) => void;
  event: Extract<AgentEvent, { type: "turn_completed" }>;
  finalizeMissingFinalReplyFailure: (
    plan: AgentStreamMissingFinalReplyPlan,
  ) => void;
  pendingTurnKey: string;
  requestState: StreamRequestState;
  shouldPreserveAssistantContent: boolean;
  setters: RuntimeHandlerStateSetters;
  toolCallCount: number;
}): void {
  params.requestState.currentTurnId = params.event.turn.id;
  bindSubmissionMessagesToRuntimeTurn(
    params.setters.setMessages,
    params.assistantMsgId,
    params.pendingTurnKey,
    params.event.turn.id,
  );
  params.setters.setThreadTurns((prev) =>
    upsertThreadTurnState(
      removeThreadTurnState(prev, params.pendingTurnKey),
      params.event.turn,
    ),
  );
  params.setters.setCurrentTurnId(params.event.turn.id);
  const completedAt =
    params.event.turn.completed_at || new Date().toISOString();
  params.setters.setThreadItems((prev) =>
    prev.map((item) =>
      isStreamedReasoningTimelineItem(item, params.event.turn.id) ||
      (item.type === "agent_message" &&
        item.turn_id === params.event.turn.id &&
        !shouldUseAgentMessageAsFinalText(item.phase))
        ? {
            ...item,
            status: "completed",
            completed_at: item.completed_at || completedAt,
            updated_at: completedAt,
          }
        : item,
    ),
  );
  resetStreamedReasoningSegment(params.requestState);
  if (params.event.text?.trim() && !params.shouldPreserveAssistantContent) {
    const completedText = params.event.text;
    const existingContent = params.requestState.accumulatedContent;
    const shouldPreferCompletedText =
      Boolean(params.requestState.hasFinalAnswerRequiredProcessBoundary) &&
      completedText.trim().length > 0;
    const completedTextAdopted =
      shouldPreferCompletedText || !existingContent.trim()
        ? true
        : completedText.startsWith(existingContent) &&
          completedText.length > existingContent.length;
    const nextContent = shouldPreferCompletedText
      ? completedText
      : !existingContent.trim()
        ? completedText
        : completedText.startsWith(existingContent)
          ? completedText
          : existingContent;
    params.requestState.accumulatedContent = nextContent;
    params.requestState.renderedContent = nextContent;
    if (
      completedTextAdopted ||
      params.requestState.hasFinalAnswerRequiredProcessBoundary
    ) {
      noteCompletedTextAsAssistantReplyIfNeeded(params.requestState);
    }
  }
  const finalAccumulatedContent = resolveAccumulatedFinalContentForCompletion(
    params.requestState,
  );
  const turnCompletedPlan = buildAgentStreamTerminalCompletionPlan({
    accumulatedContent: finalAccumulatedContent,
    fallbackContent: params.assistantFallbackContent,
    hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary:
      params.requestState
        .hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary,
    hasFinalAnswerRequiredProcessBoundary:
      params.requestState.hasFinalAnswerRequiredProcessBoundary,
    hasMeaningfulCompletionSignal:
      params.requestState.hasMeaningfulCompletionSignal,
    toolCallCount: params.toolCallCount,
    usage: params.event.usage,
  });
  if (turnCompletedPlan.type === "missing_final_reply_failure") {
    params.finalizeMissingFinalReplyFailure(turnCompletedPlan);
    return;
  }
  params.completeAssistantStreamMessageFromCompletionPlan({
    ...turnCompletedPlan,
    usage: params.event.usage,
  });
}

export function handleAgentStreamTurnCanceledEvent(params: {
  assistantMsgId: string;
  completeInterruptedTurn: (
    turn: Extract<AgentEvent, { type: "turn_canceled" }>["turn"],
  ) => void;
  event: Extract<AgentEvent, { type: "turn_canceled" }>;
  pendingTurnKey: string;
  setters: RuntimeHandlerStateSetters;
}): void {
  bindSubmissionMessagesToRuntimeTurn(
    params.setters.setMessages,
    params.assistantMsgId,
    params.pendingTurnKey,
    params.event.turn.id,
  );
  params.setters.setThreadTurns((prev) =>
    upsertThreadTurnState(
      removeThreadTurnState(prev, params.pendingTurnKey),
      params.event.turn,
    ),
  );
  params.completeInterruptedTurn(params.event.turn);
}

export function handleAgentStreamTurnFailedEvent(params: {
  assistantMsgId: string;
  completeAssistantStreamMessageFromCompletionPlan: (
    plan: AgentStreamCompletionMessagePlan,
  ) => void;
  event: Extract<AgentEvent, { type: "turn_failed" }>;
  finalizeMissingFinalReplyFailure: (
    plan: AgentStreamMissingFinalReplyPlan,
  ) => void;
  pendingTurnKey: string;
  requestState: StreamRequestState;
  setters: RuntimeHandlerStateSetters;
  toolCallCount: number;
}): void {
  bindSubmissionMessagesToRuntimeTurn(
    params.setters.setMessages,
    params.assistantMsgId,
    params.pendingTurnKey,
    params.event.turn.id,
  );
  params.setters.setThreadTurns((prev) =>
    upsertThreadTurnState(
      removeThreadTurnState(prev, params.pendingTurnKey),
      params.event.turn,
    ),
  );
  params.setters.setCurrentTurnId(params.event.turn.id);
  const softCompletionPlan = buildAgentStreamTerminalCompletionPlan({
    accumulatedContent: resolveAccumulatedFinalContentForCompletion(
      params.requestState,
    ),
    hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary:
      params.requestState
        .hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary,
    hasFinalAnswerRequiredProcessBoundary:
      params.requestState.hasFinalAnswerRequiredProcessBoundary,
    hasMeaningfulCompletionSignal:
      params.requestState.hasMeaningfulCompletionSignal,
    toolCallCount: params.toolCallCount,
  });
  if (softCompletionPlan.type === "complete") {
    params.completeAssistantStreamMessageFromCompletionPlan(softCompletionPlan);
    return;
  }

  const errorMessage = params.event.turn.error_message || "当前处理失败";
  params.finalizeMissingFinalReplyFailure(
    buildAgentStreamMissingFinalReplyFailurePlan({
      errorMessage,
      toastMessage:
        resolveAgentRuntimeErrorPresentation(errorMessage).toastMessage,
    }),
  );
}
