import type { AgentTokenUsage } from "@/lib/api/agentProtocol";
import type {
  AgentRuntimeThreadReadModel,
  AsterSubagentSessionInfo,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  Message,
} from "../types";
import {
  buildAgentTaskRuntimeCardModel,
  type AgentTaskRuntimeStatus,
  type AgentTaskRuntimeSubtaskStats,
} from "./agentTaskRuntime";
import {
  isPendingRuntimeActionConfirmation,
  isPendingRuntimeActionConfirmationThreadItem,
  isRuntimeActionConfirmationRequestId,
  isRuntimePermissionConfirmationWaitMessage,
  isSubmittedRuntimeActionConfirmation,
  isSubmittedRuntimeActionConfirmationThreadItem,
} from "./runtimeActionConfirmation";
import {
  summarizeThreadProcessBatch,
  type ToolBatchSummaryDescriptor,
} from "./toolBatchGrouping";

type DateLike = string | number | null;

export interface InputbarRuntimeStatusLineModel {
  status: AgentTaskRuntimeStatus;
  detail: string | null;
  batchDescriptor: ToolBatchSummaryDescriptor | null;
  queuedTurnCount: number;
  pendingRequestCount: number;
  subtaskStats: AgentTaskRuntimeSubtaskStats | null;
  usage?: AgentTokenUsage;
  startedAt: DateLike;
  completedAt: DateLike;
}

interface BuildInputbarRuntimeStatusLineModelParams {
  messages: Message[];
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  childSubagentSessions?: AsterSubagentSessionInfo[];
  isSending?: boolean;
}

function resolveVisiblePendingRequestCount(
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  submittedActionsInFlight: ActionRequired[],
): number {
  const submittedRequestIds = new Set(
    submittedActionsInFlight.map((item) => item.requestId),
  );
  let count = 0;
  for (const request of threadRead?.pending_requests ?? []) {
    if (submittedRequestIds.has(request.id)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function resolveVisiblePendingActions(
  pendingActions: ActionRequired[],
): ActionRequired[] {
  return pendingActions.filter((action) => action.status !== "submitted");
}

function resolveLatestTurn(
  turns: AgentThreadTurn[],
  currentTurnId?: string | null,
): AgentThreadTurn | null {
  if (currentTurnId) {
    const matched = turns.find((turn) => turn.id === currentTurnId);
    if (matched) {
      return matched;
    }
  }
  return turns[turns.length - 1] || null;
}

function resolveLatestTurnItems(
  latestTurn: AgentThreadTurn | null,
  threadItems: AgentThreadItem[],
): AgentThreadItem[] {
  if (!latestTurn) {
    return [];
  }

  return threadItems.filter((item) => item.turn_id === latestTurn.id);
}

function resolveLatestAssistantMessage(messages: Message[]): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

function resolveFallbackStatus(params: {
  latestTurn: AgentThreadTurn | null;
  latestTurnItems: AgentThreadItem[];
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions: ActionRequired[];
  submittedActionsInFlight: ActionRequired[];
  queuedTurnCount: number;
  isSending: boolean;
}): AgentTaskRuntimeStatus | null {
  const {
    latestTurn,
    latestTurnItems,
    threadRead,
    pendingActions,
    submittedActionsInFlight,
    queuedTurnCount,
    isSending,
  } = params;
  const visiblePendingActions = resolveVisiblePendingActions(pendingActions);
  const visiblePendingRequestCount = resolveVisiblePendingRequestCount(
    threadRead,
    submittedActionsInFlight,
  );

  if (visiblePendingActions.length > 0 || visiblePendingRequestCount > 0) {
    return "waiting_input";
  }

  if (
    latestTurn?.status === "failed" &&
    isRuntimePermissionConfirmationWaitMessage(latestTurn.error_message)
  ) {
    const hasSubmittedRuntimeConfirmation =
      pendingActions.some(isSubmittedRuntimeActionConfirmation) ||
      submittedActionsInFlight.some(isSubmittedRuntimeActionConfirmation) ||
      latestTurnItems.some(isSubmittedRuntimeActionConfirmationThreadItem);

    if (hasSubmittedRuntimeConfirmation) {
      return null;
    }

    const submittedRequestIds = new Set(
      submittedActionsInFlight.map((item) => item.requestId),
    );
    const hasPendingRuntimeConfirmation =
      pendingActions.some(isPendingRuntimeActionConfirmation) ||
      latestTurnItems.some(isPendingRuntimeActionConfirmationThreadItem) ||
      (threadRead?.pending_requests ?? []).some(
        (request) =>
          !submittedRequestIds.has(request.id) &&
          isRuntimeActionConfirmationRequestId(request.id),
      );

    return hasPendingRuntimeConfirmation ? "waiting_input" : null;
  }

  if (threadRead?.status === "queued" || queuedTurnCount > 0) {
    return "queued";
  }

  if (
    isSending ||
    threadRead?.status === "running" ||
    threadRead?.status === "interrupting"
  ) {
    return "running";
  }

  switch (latestTurn?.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "running":
      return "running";
    default:
      return null;
  }
}

function resolveSubtaskStats(
  childSubagentSessions: AsterSubagentSessionInfo[],
): AgentTaskRuntimeSubtaskStats | null {
  if (childSubagentSessions.length === 0) {
    return null;
  }

  return childSubagentSessions.reduce<AgentTaskRuntimeSubtaskStats>(
    (stats, session) => {
      const status = session.runtime_status || "idle";
      stats.total += 1;
      if (status === "running") {
        stats.active += 1;
      } else if (status === "queued") {
        stats.active += 1;
        stats.queued += 1;
      } else if (status === "completed" || status === "closed") {
        stats.completed += 1;
      } else if (status === "failed" || status === "aborted") {
        stats.failed += 1;
      }
      return stats;
    },
    { total: 0, active: 0, queued: 0, completed: 0, failed: 0 },
  );
}

function resolveLatestTurnTimestamp(
  latestTurn: AgentThreadTurn | null,
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  key: "startedAt" | "completedAt",
): DateLike {
  if (key === "startedAt") {
    return (
      latestTurn?.started_at ||
      threadRead?.diagnostics?.latest_turn_started_at ||
      null
    );
  }

  return (
    latestTurn?.completed_at ||
    threadRead?.diagnostics?.latest_turn_completed_at ||
    null
  );
}

function isProcessThreadItem(item: AgentThreadItem): boolean {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "web_search"
  );
}

function resolveLatestTurnBatchDescriptor(
  latestTurn: AgentThreadTurn | null,
  threadItems: AgentThreadItem[],
): ToolBatchSummaryDescriptor | null {
  if (!latestTurn) {
    return null;
  }

  const latestProcessItems: AgentThreadItem[] = [];
  for (const item of threadItems) {
    if (item.turn_id === latestTurn.id && isProcessThreadItem(item)) {
      latestProcessItems.push(item);
    }
  }
  return summarizeThreadProcessBatch(latestProcessItems);
}

function resolveVisibleUsage(
  status: AgentTaskRuntimeStatus,
  latestAssistant: Message | null,
): AgentTokenUsage | undefined {
  if (
    status === "running" ||
    status === "queued" ||
    status === "waiting_input"
  ) {
    return undefined;
  }

  return latestAssistant?.usage;
}

function resolveFallbackDetail(params: {
  status: AgentTaskRuntimeStatus;
  latestTurn: AgentThreadTurn | null;
  latestAssistant: Message | null;
  pendingActions: ActionRequired[];
  submittedActionsInFlight: ActionRequired[];
  threadRead?: AgentRuntimeThreadReadModel | null;
}): string | null {
  const {
    status,
    latestTurn,
    latestAssistant,
    pendingActions,
    submittedActionsInFlight,
    threadRead,
  } = params;

  if (status === "waiting_input") {
    const visiblePendingActions = resolveVisiblePendingActions(pendingActions);
    const submittedRequestIds = new Set(
      submittedActionsInFlight.map((item) => item.requestId),
    );
    const visiblePendingRequest = (threadRead?.pending_requests ?? []).find(
      (request) => !submittedRequestIds.has(request.id),
    );
    return (
      threadRead?.diagnostics?.primary_blocking_summary ||
      visiblePendingRequest?.title ||
      visiblePendingActions[0]?.prompt ||
      visiblePendingActions[0]?.questions?.[0]?.question ||
      null
    );
  }

  if (status === "failed") {
    return (
      latestTurn?.error_message ||
      latestAssistant?.runtimeStatus?.detail ||
      null
    );
  }

  if (status === "aborted") {
    return latestAssistant?.runtimeStatus?.detail || "本轮已中断";
  }

  return null;
}

export function buildInputbarRuntimeStatusLineModel({
  messages,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
  pendingActions = [],
  submittedActionsInFlight = [],
  queuedTurns = [],
  childSubagentSessions = [],
  isSending = false,
}: BuildInputbarRuntimeStatusLineModelParams): InputbarRuntimeStatusLineModel | null {
  const latestTurn = resolveLatestTurn(turns, currentTurnId);
  const latestTurnItems = resolveLatestTurnItems(latestTurn, threadItems);
  const latestAssistant = resolveLatestAssistantMessage(messages);
  const fallbackBatchDescriptor = resolveLatestTurnBatchDescriptor(
    latestTurn,
    threadItems,
  );
  const startedAt = resolveLatestTurnTimestamp(
    latestTurn,
    threadRead,
    "startedAt",
  );
  const completedAt = resolveLatestTurnTimestamp(
    latestTurn,
    threadRead,
    "completedAt",
  );
  const builtTask = buildAgentTaskRuntimeCardModel({
    messages,
    turns,
    threadItems,
    currentTurnId,
    threadRead,
    pendingActions,
    submittedActionsInFlight,
    queuedTurns,
    childSubagentSessions,
    isSending,
  });

  if (builtTask) {
    return {
      status: builtTask.status,
      detail:
        builtTask.status === "waiting_input" ||
        builtTask.status === "failed" ||
        builtTask.status === "aborted"
          ? builtTask.detail
          : null,
      batchDescriptor: builtTask.batchDescriptor,
      queuedTurnCount: builtTask.queuedTurnCount,
      pendingRequestCount: builtTask.pendingRequestCount,
      subtaskStats: builtTask.subtaskStats,
      usage: resolveVisibleUsage(builtTask.status, latestAssistant),
      startedAt,
      completedAt,
    };
  }

  const status = resolveFallbackStatus({
    latestTurn,
    latestTurnItems,
    threadRead,
    pendingActions,
    submittedActionsInFlight,
    queuedTurnCount: queuedTurns.length,
    isSending,
  });
  if (!status) {
    return null;
  }

  const usage = resolveVisibleUsage(status, latestAssistant);
  if (
    status === "completed" &&
    !usage &&
    !startedAt &&
    childSubagentSessions.length === 0
  ) {
    return null;
  }

  return {
    status,
    detail: resolveFallbackDetail({
      status,
      latestTurn,
      latestAssistant,
      pendingActions,
      submittedActionsInFlight,
      threadRead,
    }),
    batchDescriptor: fallbackBatchDescriptor,
    queuedTurnCount: queuedTurns.length,
    pendingRequestCount:
      resolveVisiblePendingActions(pendingActions).length ||
      resolveVisiblePendingRequestCount(
        threadRead,
        submittedActionsInFlight,
      ),
    subtaskStats: resolveSubtaskStats(childSubagentSessions),
    usage,
    startedAt,
    completedAt,
  };
}
