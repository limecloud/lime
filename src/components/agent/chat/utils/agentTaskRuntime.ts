import type { AgentTokenUsage } from "@/lib/api/agentProtocol";
import type {
  AsterSubagentSessionInfo,
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActionRequired, AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  summarizeStreamingToolBatch,
  summarizeThreadProcessBatch,
  type ToolBatchSummaryDescriptor,
} from "./toolBatchGrouping";
import { resolveAgentThreadToolProcessPreview } from "./toolProcessSummary";
import { isInternalRoutingTurnSummaryText } from "./turnSummaryPresentation";

export type AgentTaskRuntimeStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "aborted";

export type AgentTaskRuntimePhase =
  | "preparing"
  | "reasoning"
  | "tool_batch"
  | "waiting_input"
  | "completed"
  | "failed"
  | "aborted";

export interface AgentTaskRuntimeSubtaskStats {
  total: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
}

export interface AgentTaskRuntimeCardModel {
  taskId: string;
  title: string;
  summary: string;
  status: AgentTaskRuntimeStatus;
  statusLabel: string;
  phase: AgentTaskRuntimePhase;
  phaseLabel: string;
  detail: string | null;
  supportingLines: string[];
  batchDescriptor: ToolBatchSummaryDescriptor | null;
  queuedTurnCount: number;
  pendingRequestCount: number;
  subtaskStats: AgentTaskRuntimeSubtaskStats | null;
  usage?: AgentTokenUsage;
}

interface BuildAgentTaskRuntimeCardModelParams {
  messages: Message[];
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  childSubagentSessions?: AsterSubagentSessionInfo[];
  isSending?: boolean;
}

function shorten(value: string | null | undefined, maxLength = 120): string {
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function firstMeaningfulLine(value: string | null | undefined): string | null {
  const normalized = (value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return normalized || null;
}

function isProcessItem(item: AgentThreadItem): boolean {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "web_search"
  );
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

function resolveLatestAssistantMessage(messages: Message[]): Message | null {
  return [...messages].reverse().find((message) => message.role === "assistant") || null;
}

function resolveLatestUserMessage(messages: Message[]): Message | null {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "user" &&
          (message.content.trim().length > 0 ||
            (Array.isArray(message.images) && message.images.length > 0)),
      ) || null
  );
}

function resolveLatestUsage(messages: Message[]): AgentTokenUsage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        !message.isThinking &&
        message.usage,
    )?.usage;
}

function resolveTaskStatus(params: {
  latestTurn: AgentThreadTurn | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions: ActionRequired[];
  queuedTurnCount: number;
  isSending: boolean;
}): AgentTaskRuntimeStatus | null {
  const { latestTurn, threadRead, pendingActions, queuedTurnCount, isSending } =
    params;
  if (pendingActions.length > 0 || threadRead?.status === "waiting_request") {
    return "waiting_input";
  }

  if (threadRead?.status === "queued" || queuedTurnCount > 0) {
    return latestTurn ? "queued" : queuedTurnCount > 0 ? "queued" : null;
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

function resolveTaskPhase(params: {
  status: AgentTaskRuntimeStatus;
  latestAssistant: Message | null;
  batchDescriptor: ToolBatchSummaryDescriptor | null;
}): AgentTaskRuntimePhase {
  const { status, latestAssistant, batchDescriptor } = params;
  if (status === "waiting_input") {
    return "waiting_input";
  }
  if (status === "queued") {
    return "preparing";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "aborted") {
    return "aborted";
  }

  if (batchDescriptor) {
    return "tool_batch";
  }

  if (latestAssistant?.runtimeStatus?.phase === "preparing") {
    return "preparing";
  }

  return "reasoning";
}

function resolveStatusLabel(status: AgentTaskRuntimeStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "进行中";
    case "waiting_input":
      return "等待输入";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "aborted":
      return "已中断";
  }
}

function resolvePhaseLabel(phase: AgentTaskRuntimePhase): string {
  switch (phase) {
    case "preparing":
      return "准备中";
    case "reasoning":
      return "分析中";
    case "tool_batch":
      return "工具批次处理中";
    case "waiting_input":
      return "等待确认或补充";
    case "completed":
      return "任务完成";
    case "failed":
      return "任务失败";
    case "aborted":
      return "任务已中断";
  }
}

function resolveBlockingDetail(
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  pendingActions: ActionRequired[],
): string | null {
  const pendingRequestTitle =
    threadRead?.diagnostics?.primary_blocking_summary ||
    threadRead?.pending_requests?.[0]?.title ||
    pendingActions[0]?.prompt ||
    pendingActions[0]?.questions?.[0]?.question;

  return shorten(pendingRequestTitle, 96) || null;
}

function resolveCompletedSummary(
  latestAssistant: Message | null,
  latestTurnItems: AgentThreadItem[],
): string | null {
  const latestTurnSummary = [...latestTurnItems]
    .reverse()
    .find(
      (item) =>
        item.type === "turn_summary" &&
        item.status === "completed" &&
        !isInternalRoutingTurnSummaryText(item.text),
    );
  if (latestTurnSummary?.type === "turn_summary") {
    return shorten(firstMeaningfulLine(latestTurnSummary.text), 96) || null;
  }

  return shorten(firstMeaningfulLine(latestAssistant?.content), 96) || null;
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

export function buildAgentTaskRuntimeCardModel({
  messages,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
  pendingActions = [],
  queuedTurns = [],
  childSubagentSessions = [],
  isSending = false,
}: BuildAgentTaskRuntimeCardModelParams): AgentTaskRuntimeCardModel | null {
  const latestTurn = resolveLatestTurn(turns, currentTurnId);
  const latestAssistant = resolveLatestAssistantMessage(messages);
  const latestUser = resolveLatestUserMessage(messages);
  const latestTurnItems = latestTurn
    ? threadItems.filter((item) => item.turn_id === latestTurn.id)
    : [];
  const latestProcessItems = latestTurnItems.filter(isProcessItem);
  const visibleToolCalls =
    latestAssistant?.toolCalls?.filter((toolCall) => toolCall.status !== "failed") ||
    [];
  const streamingBatchDescriptor = summarizeStreamingToolBatch(visibleToolCalls);
  const persistedBatchDescriptor = summarizeThreadProcessBatch(latestProcessItems);
  const batchDescriptor = streamingBatchDescriptor || persistedBatchDescriptor;
  const status = resolveTaskStatus({
    latestTurn,
    threadRead,
    pendingActions,
    queuedTurnCount: queuedTurns.length,
    isSending,
  });

  if (
    !status &&
    !latestTurn &&
    !latestUser &&
    childSubagentSessions.length === 0 &&
    queuedTurns.length === 0
  ) {
    return null;
  }

  const phase = resolveTaskPhase({
    status: status || "running",
    latestAssistant,
    batchDescriptor,
  });
  const titleSource =
    latestTurn?.prompt_text ||
    latestUser?.content ||
    (childSubagentSessions.length > 0 ? "正在协调子任务" : "当前任务");
  const title = shorten(firstMeaningfulLine(titleSource), 120) || "当前任务";
  const subtaskStats = resolveSubtaskStats(childSubagentSessions);
  const latestPreviewItem = [...latestProcessItems]
    .reverse()
    .find((item) => Boolean(resolveAgentThreadToolProcessPreview(item)));
  const latestPreview =
    (latestPreviewItem && resolveAgentThreadToolProcessPreview(latestPreviewItem)) ||
    shorten(firstMeaningfulLine(latestAssistant?.runtimeStatus?.detail), 96) ||
    null;

  let detail: string | null = null;
  const supportingLines: string[] = [];

  if (status === "waiting_input") {
    detail = resolveBlockingDetail(threadRead, pendingActions);
  } else if (status === "queued") {
    detail =
      queuedTurns.length > 0
        ? `还有 ${queuedTurns.length} 条消息在排队，当前任务会在前一轮结束后继续。`
        : "正在准备本轮执行。";
  } else if (phase === "tool_batch" && batchDescriptor) {
    detail = batchDescriptor.title;
    supportingLines.push(...batchDescriptor.supportingLines);
  } else if (status === "completed" || status === "failed" || status === "aborted") {
    detail = resolveCompletedSummary(latestAssistant, latestTurnItems);
    if (batchDescriptor) {
      supportingLines.push(...batchDescriptor.supportingLines);
    }
  } else {
    detail = latestPreview || "正在处理当前请求。";
  }

  if (
    subtaskStats &&
    subtaskStats.total > 0 &&
    !supportingLines.some((line) => line.includes("子任务"))
  ) {
    if (subtaskStats.active > 0) {
      supportingLines.push(
        `子任务 ${subtaskStats.active}/${subtaskStats.total} 进行中`,
      );
    } else {
      supportingLines.push(`子任务 ${subtaskStats.total} 个已收拢到当前任务`);
    }
  }

  if (
    threadRead?.diagnostics?.primary_blocking_summary &&
    status !== "waiting_input"
  ) {
    supportingLines.push(
      shorten(threadRead.diagnostics.primary_blocking_summary, 96),
    );
  }

  const dedupedSupportingLines = supportingLines.filter(
    (line, index, array) => Boolean(line) && array.indexOf(line) === index,
  );
  const hasProcessTrail =
    Boolean(batchDescriptor) || latestProcessItems.length > 0;
  const hasSubtasks = Boolean(subtaskStats?.total);
  const hasBlockingOrQueue =
    pendingActions.length > 0 ||
    (threadRead?.pending_requests?.length || 0) > 0 ||
    queuedTurns.length > 0;
  const shouldDisplay =
    status === "waiting_input" ||
    status === "queued" ||
    status === "failed" ||
    status === "aborted" ||
    ((status === "running" || !status) &&
      (hasProcessTrail || hasSubtasks || hasBlockingOrQueue));

  if (!shouldDisplay) {
    return null;
  }

  return {
    taskId: latestTurn?.id || currentTurnId || "main-session-task",
    title,
    summary: title,
    status: status || "running",
    statusLabel: resolveStatusLabel(status || "running"),
    phase,
    phaseLabel: resolvePhaseLabel(phase),
    detail,
    supportingLines: dedupedSupportingLines,
    batchDescriptor,
    queuedTurnCount: queuedTurns.length,
    pendingRequestCount:
      pendingActions.length || threadRead?.pending_requests?.length || 0,
    subtaskStats,
    usage: resolveLatestUsage(messages),
  };
}
