import type {
  AgentRuntimeIncidentView,
  AgentRuntimeOutcomeView,
  AgentRuntimeRequestView,
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActionRequired, AgentThreadItem, AgentThreadTurn } from "../types";

export type ThreadReliabilityTone =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "paused"
  | "neutral";

export interface ThreadReliabilityRequestDisplay {
  id: string;
  title: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: ThreadReliabilityTone;
  createdAtLabel?: string | null;
  waitingLabel?: string | null;
}

export interface ThreadReliabilityIncidentDisplay {
  id: string;
  incidentType: string;
  title: string;
  detail?: string | null;
  statusLabel: string;
  severityLabel: string;
  tone: ThreadReliabilityTone;
}

export interface ThreadReliabilityOutcomeDisplay {
  label: string;
  summary: string;
  primaryCause?: string | null;
  retryable: boolean;
  endedAtLabel?: string | null;
  tone: ThreadReliabilityTone;
}

export interface ThreadReliabilityQueuedTurnDisplay {
  id: string;
  title: string;
  positionLabel?: string | null;
}

export interface ThreadReliabilityViewModel {
  shouldRender: boolean;
  statusLabel: string;
  statusTone: ThreadReliabilityTone;
  summary: string;
  activeTurnLabel?: string | null;
  updatedAtLabel?: string | null;
  interruptStateLabel?: string | null;
  pendingRequestCount: number;
  activeIncidentCount: number;
  queuedTurnCount: number;
  pendingRequests: ThreadReliabilityRequestDisplay[];
  submittedRequests: ThreadReliabilityRequestDisplay[];
  incidents: ThreadReliabilityIncidentDisplay[];
  outcome: ThreadReliabilityOutcomeDisplay | null;
  nextQueuedTurn: ThreadReliabilityQueuedTurnDisplay | null;
  recommendations: string[];
}

interface BuildThreadReliabilityViewParams {
  threadRead?: AgentRuntimeThreadReadModel | null;
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
}

const NON_BLOCKING_RUNTIME_WARNING_CODES = new Set([
  "artifact_document_repaired",
]);

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function shortenText(value?: string | null, maxLength = 52): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseDateValue(value?: string | number | null): Date | null {
  if (typeof value === "number") {
    const normalizedValue = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatTimeLabel(value?: string | number | null): string | null {
  const date = parseDateValue(value);
  if (!date) {
    return null;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWaitingLabel(value?: string | number | null): string | null {
  const date = parseDateValue(value);
  if (!date) {
    return null;
  }

  const deltaMs = Math.max(0, Date.now() - date.getTime());
  const deltaMinutes = Math.floor(deltaMs / 60_000);
  const deltaHours = Math.floor(deltaMinutes / 60);

  if (deltaMinutes < 1) {
    return "刚刚产生";
  }
  if (deltaMinutes < 60) {
    return `已等待 ${deltaMinutes} 分钟`;
  }
  if (deltaHours < 24) {
    return `已等待 ${deltaHours} 小时`;
  }
  return `已等待 ${Math.floor(deltaHours / 24)} 天`;
}

function resolveRequestTypeLabel(requestType?: string): string {
  const normalized = (requestType || "").toLowerCase();
  if (normalized.includes("tool") || normalized.includes("approval")) {
    return "工具确认";
  }
  if (normalized.includes("elicitation")) {
    return "结构化输入";
  }
  if (normalized.includes("ask") || normalized.includes("user")) {
    return "人工输入";
  }
  return "待处理请求";
}

function resolveRequestStatusMeta(status?: string): {
  label: string;
  tone: ThreadReliabilityTone;
} {
  const normalized = (status || "").toLowerCase();

  if (
    normalized.includes("submitted") ||
    normalized.includes("queued") ||
    normalized.includes("answer")
  ) {
    return { label: "已提交", tone: "waiting" };
  }
  if (
    normalized.includes("resolved") ||
    normalized.includes("completed") ||
    normalized.includes("declined")
  ) {
    return { label: "已处理", tone: "completed" };
  }
  if (normalized.includes("failed") || normalized.includes("error")) {
    return { label: "处理失败", tone: "failed" };
  }

  return { label: "待处理", tone: "waiting" };
}

function isPendingRequest(request: AgentRuntimeRequestView): boolean {
  if (request.resolved_at) {
    return false;
  }
  const normalized = (request.status || "").toLowerCase();
  return !(
    normalized.includes("resolved") ||
    normalized.includes("completed") ||
    normalized.includes("declined") ||
    normalized.includes("cancelled")
  );
}

function requestTitleFromThreadRead(request: AgentRuntimeRequestView): string {
  return (
    shortenText(request.title) ||
    shortenText(
      typeof request.payload === "string" ? request.payload : undefined,
    ) ||
    `${resolveRequestTypeLabel(request.request_type)} #${request.id.slice(0, 8)}`
  );
}

function requestTitleFromAction(action: ActionRequired): string {
  if (action.actionType === "tool_confirmation") {
    return (
      shortenText(action.prompt) ||
      (action.toolName ? `等待确认工具：${action.toolName}` : "等待工具确认")
    );
  }

  if (action.actionType === "elicitation") {
    return shortenText(action.prompt) || "等待结构化输入";
  }

  return shortenText(action.prompt) || "等待人工输入";
}

function mergePendingRequests(
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  pendingActions: ActionRequired[],
  submittedActionsInFlight: ActionRequired[],
): ThreadReliabilityRequestDisplay[] {
  const merged = new Map<string, ThreadReliabilityRequestDisplay>();
  const submittedRequestIds = new Set(
    submittedActionsInFlight.map((item) => item.requestId),
  );

  for (const request of threadRead?.pending_requests ?? []) {
    if (submittedRequestIds.has(request.id)) {
      continue;
    }
    if (!isPendingRequest(request)) {
      continue;
    }
    const statusMeta = resolveRequestStatusMeta(request.status);
    merged.set(request.id, {
      id: request.id,
      title: requestTitleFromThreadRead(request),
      typeLabel: resolveRequestTypeLabel(request.request_type),
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
      createdAtLabel: formatTimeLabel(request.created_at),
      waitingLabel: formatWaitingLabel(request.created_at),
    });
  }

  for (const action of pendingActions) {
    if (merged.has(action.requestId)) {
      continue;
    }
    const statusMeta = resolveRequestStatusMeta(action.status);
    merged.set(action.requestId, {
      id: action.requestId,
      title: requestTitleFromAction(action),
      typeLabel: resolveRequestTypeLabel(action.actionType),
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
    });
  }

  return [...merged.values()];
}

function mergeSubmittedRequests(
  submittedActionsInFlight: ActionRequired[],
): ThreadReliabilityRequestDisplay[] {
  const merged = new Map<string, ThreadReliabilityRequestDisplay>();

  for (const action of submittedActionsInFlight) {
    merged.set(action.requestId, {
      id: action.requestId,
      title: requestTitleFromAction(action),
      typeLabel: resolveRequestTypeLabel(action.actionType),
      statusLabel: "已提交",
      statusTone: "running",
    });
  }

  return [...merged.values()];
}

function resolveLatestTurn(
  turns: AgentThreadTurn[],
  currentTurnId?: string | null,
): AgentThreadTurn | null {
  if (currentTurnId) {
    const currentTurn = turns.find((turn) => turn.id === currentTurnId);
    if (currentTurn) {
      return currentTurn;
    }
  }

  return turns.length > 0 ? turns[turns.length - 1] : null;
}

export function resolveOutcomeTone(outcomeType?: string): ThreadReliabilityTone {
  const normalized = (outcomeType || "").toLowerCase();
  if (normalized.includes("complete")) {
    return "completed";
  }
  if (normalized.includes("interrupt") || normalized.includes("abort")) {
    return "paused";
  }
  if (normalized.includes("wait")) {
    return "waiting";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }
  return "neutral";
}

export function resolveOutcomeLabel(outcomeType?: string): string {
  const normalized = (outcomeType || "").toLowerCase();
  if (normalized.includes("complete")) {
    return "已完成";
  }
  if (normalized.includes("interrupt") || normalized.includes("abort")) {
    return "已中断";
  }
  if (normalized.includes("provider")) {
    return "Provider 失败";
  }
  if (normalized.includes("tool")) {
    return "工具失败";
  }
  if (normalized.includes("wait") && normalized.includes("approval")) {
    return "等待审批";
  }
  if (normalized.includes("wait") && normalized.includes("user")) {
    return "等待输入";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "执行失败";
  }
  return "最近结果";
}

function deriveOutcomeFromTurn(
  latestTurn: AgentThreadTurn | null,
): ThreadReliabilityOutcomeDisplay | null {
  if (!latestTurn) {
    return null;
  }

  if (latestTurn.status === "completed") {
    return {
      label: "已完成",
      summary: "最近一次回合已稳定完成",
      retryable: false,
      endedAtLabel: formatTimeLabel(latestTurn.completed_at),
      tone: "completed",
    };
  }

  if (latestTurn.status === "failed") {
    return {
      label: "执行失败",
      summary: normalizeText(latestTurn.error_message) || "最近一次回合执行失败",
      primaryCause: normalizeText(latestTurn.error_message),
      retryable: true,
      endedAtLabel: formatTimeLabel(latestTurn.completed_at),
      tone: "failed",
    };
  }

  if (latestTurn.status === "aborted") {
    return {
      label: "已中断",
      summary: "最近一次回合已被中断",
      retryable: true,
      endedAtLabel: formatTimeLabel(latestTurn.completed_at),
      tone: "paused",
    };
  }

  return null;
}

function normalizeOutcome(
  outcome: AgentRuntimeOutcomeView | null | undefined,
  latestTurn: AgentThreadTurn | null,
): ThreadReliabilityOutcomeDisplay | null {
  if (!outcome) {
    return deriveOutcomeFromTurn(latestTurn);
  }

  return {
    label: resolveOutcomeLabel(outcome.outcome_type),
    summary:
      shortenText(outcome.summary, 72) ||
      shortenText(outcome.primary_cause, 72) ||
      "最近一次结果已更新",
    primaryCause: shortenText(outcome.primary_cause, 72),
    retryable: Boolean(outcome.retryable),
    endedAtLabel: formatTimeLabel(outcome.ended_at),
    tone: resolveOutcomeTone(outcome.outcome_type),
  };
}

function describeIncidentDetails(details: unknown): string | null {
  if (typeof details === "string") {
    return shortenText(details, 80);
  }
  if (details && typeof details === "object") {
    try {
      return shortenText(JSON.stringify(details), 80);
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveIncidentToneFromSeverity(
  severity?: string,
): ThreadReliabilityTone {
  const normalized = (severity || "").toLowerCase();
  if (normalized.includes("critical") || normalized.includes("high")) {
    return "failed";
  }
  if (normalized.includes("warn") || normalized.includes("medium")) {
    return "waiting";
  }
  return "neutral";
}

function normalizeIncident(
  incident: AgentRuntimeIncidentView,
): ThreadReliabilityIncidentDisplay {
  const severity = (incident.severity || "").toLowerCase();
  const tone = resolveIncidentToneFromSeverity(incident.severity);
  let severityLabel = "低";

  if (severity.includes("critical") || severity.includes("high")) {
    severityLabel = "高";
  } else if (severity.includes("warn") || severity.includes("medium")) {
    severityLabel = "中";
  }

  const statusLabel =
    incident.status && incident.status.toLowerCase().includes("clear")
      ? "已恢复"
      : "进行中";

  return {
    id: incident.id,
    incidentType: incident.incident_type,
    title:
      shortenText(incident.title, 56) ||
      shortenText(incident.incident_type, 56) ||
      "运行事故",
    detail: describeIncidentDetails(incident.details),
    statusLabel,
    severityLabel,
    tone,
  };
}

function resolveIncidentPriority(
  incident: ThreadReliabilityIncidentDisplay,
): number {
  if (incident.tone === "failed") {
    return 0;
  }
  if (incident.tone === "waiting") {
    return 1;
  }
  return 2;
}

function sortIncidentsByPriority(
  incidents: ThreadReliabilityIncidentDisplay[],
): ThreadReliabilityIncidentDisplay[] {
  return [...incidents].sort((left, right) => {
    const priorityDelta =
      resolveIncidentPriority(left) - resolveIncidentPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.title.localeCompare(right.title, "zh-CN");
  });
}

function deriveFallbackIncidents(
  latestTurn: AgentThreadTurn | null,
  threadItems: AgentThreadItem[],
  pendingRequests: ThreadReliabilityRequestDisplay[],
): ThreadReliabilityIncidentDisplay[] {
  if (pendingRequests.length > 0) {
    return [
      {
        id: `pending-request-${pendingRequests[0]?.id || "active"}`,
        incidentType: "waiting_user_input",
        title: "线程正在等待人工处理",
        detail: pendingRequests[0]?.title || null,
        statusLabel: "进行中",
        severityLabel: "中",
        tone: "waiting",
      },
    ];
  }

  if (latestTurn?.status === "failed") {
    return [
      {
        id: `turn-failed-${latestTurn.id}`,
        incidentType: "turn_failed",
        title: "最近一次回合执行失败",
        detail: shortenText(latestTurn.error_message, 80),
        statusLabel: "进行中",
        severityLabel: "高",
        tone: "failed",
      },
    ];
  }

  const issueItem = [...threadItems]
    .reverse()
    .find((item) => {
      if (item.type === "error") {
        return true;
      }
      if (item.type !== "warning") {
        return false;
      }
      const code = normalizeText(item.code);
      return !code || !NON_BLOCKING_RUNTIME_WARNING_CODES.has(code);
    });

  if (!issueItem) {
    return [];
  }

  if (issueItem.type === "error") {
    return [
      {
        id: issueItem.id,
        incidentType: "runtime_error",
        title: "时间线记录到异常项",
        detail: shortenText(issueItem.message, 80),
        statusLabel: "进行中",
        severityLabel: "高",
        tone: "failed",
      },
    ];
  }

  return [
    {
      id: issueItem.id,
      incidentType: "runtime_warning",
      title: "时间线记录到警告项",
      detail: shortenText(issueItem.message, 80),
      statusLabel: "进行中",
      severityLabel: "中",
      tone: "waiting",
    },
  ];
}

function normalizeIncidents(
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  latestTurn: AgentThreadTurn | null,
  threadItems: AgentThreadItem[],
  pendingRequests: ThreadReliabilityRequestDisplay[],
  submittedActionsInFlight: ActionRequired[],
): ThreadReliabilityIncidentDisplay[] {
  const submittedRequestIds = new Set(
    submittedActionsInFlight.map((item) => item.requestId),
  );
  const activeIncidents = (threadRead?.incidents ?? []).filter((incident) => {
    const normalizedStatus = (incident.status || "").toLowerCase();
    if (normalizedStatus.includes("clear") || incident.cleared_at) {
      return false;
    }
    if (submittedRequestIds.has(incident.id.replace(/^incident-/, ""))) {
      return false;
    }
    return true;
  });

  if (activeIncidents.length > 0) {
    return sortIncidentsByPriority(activeIncidents.map(normalizeIncident));
  }

  return sortIncidentsByPriority(
    deriveFallbackIncidents(latestTurn, threadItems, pendingRequests),
  );
}

function normalizeInterruptStateLabel(
  interruptState?: string | null,
): string | null {
  const normalized = (interruptState || "").toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("interrupting")) {
    return "运行时正在处理中断";
  }
  if (normalized.includes("interrupt")) {
    return "运行时已确认中断";
  }
  return shortenText(interruptState, 32);
}

function resolveNextQueuedTurn(
  threadRead: AgentRuntimeThreadReadModel | null | undefined,
  queuedTurns: QueuedTurnSnapshot[],
): ThreadReliabilityQueuedTurnDisplay | null {
  const candidate =
    threadRead?.queued_turns?.[0] ??
    (queuedTurns.length > 0 ? queuedTurns[0] : null);

  if (!candidate) {
    return null;
  }

  return {
    id: candidate.queued_turn_id,
    title:
      shortenText(candidate.message_preview, 48) ||
      shortenText(candidate.message_text, 48) ||
      "继续执行排队回合",
    positionLabel:
      candidate.position > 0 ? `队列第 ${candidate.position} 位` : null,
  };
}

function resolveStatusMeta(status?: string): {
  label: string;
  tone: ThreadReliabilityTone;
} {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("interrupting")) {
    return { label: "中断中", tone: "paused" };
  }
  if (normalized.includes("wait") || normalized.includes("queue")) {
    return { label: "等待处理", tone: "waiting" };
  }
  if (normalized.includes("interrupt") || normalized.includes("abort")) {
    return { label: "已中断", tone: "paused" };
  }
  if (normalized.includes("run") || normalized.includes("active")) {
    return { label: "执行中", tone: "running" };
  }
  if (
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("success")
  ) {
    return { label: "已完成", tone: "completed" };
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return { label: "执行失败", tone: "failed" };
  }
  return { label: "空闲", tone: "neutral" };
}

function deriveStatusFromRuntime(params: {
  threadRead?: AgentRuntimeThreadReadModel | null;
  latestTurn: AgentThreadTurn | null;
  pendingRequests: ThreadReliabilityRequestDisplay[];
  submittedRequests: ThreadReliabilityRequestDisplay[];
  queuedTurnCount: number;
}): { label: string; tone: ThreadReliabilityTone } {
  if (params.submittedRequests.length > 0) {
    return { label: "处理中", tone: "running" };
  }
  if (params.threadRead?.status) {
    return resolveStatusMeta(params.threadRead.status);
  }

  if (params.pendingRequests.length > 0) {
    return { label: "等待处理", tone: "waiting" };
  }

  if (params.latestTurn?.status === "running") {
    return { label: "执行中", tone: "running" };
  }
  if (params.latestTurn?.status === "completed") {
    return { label: "已完成", tone: "completed" };
  }
  if (params.latestTurn?.status === "failed") {
    return { label: "执行失败", tone: "failed" };
  }
  if (params.latestTurn?.status === "aborted") {
    return { label: "已中断", tone: "paused" };
  }
  if (params.queuedTurnCount > 0) {
    return { label: "等待处理", tone: "waiting" };
  }

  return { label: "空闲", tone: "neutral" };
}

function buildSummary(params: {
  statusLabel: string;
  latestTurn: AgentThreadTurn | null;
  pendingRequests: ThreadReliabilityRequestDisplay[];
  submittedRequests: ThreadReliabilityRequestDisplay[];
  incidents: ThreadReliabilityIncidentDisplay[];
  outcome: ThreadReliabilityOutcomeDisplay | null;
  queuedTurnCount: number;
  interruptState?: string | null;
  interruptStateLabel?: string | null;
  nextQueuedTurn: ThreadReliabilityQueuedTurnDisplay | null;
}): string {
  if (params.pendingRequests.length > 0) {
    return `当前线程正在等待人工处理：${params.pendingRequests[0]?.title || "请查看待处理请求"}`;
  }

  if (params.submittedRequests.length > 0) {
    return `已提交响应：${params.submittedRequests[0]?.title || "等待线程继续执行"}，等待运行时回填最新状态`;
  }

  if (params.incidents.length > 0) {
    return params.incidents[0]?.detail
      ? `${params.incidents[0].title}：${params.incidents[0].detail}`
      : params.incidents[0].title;
  }

  if (params.interruptStateLabel) {
    if ((params.interruptState || "").toLowerCase().includes("interrupting")) {
      return `${params.interruptStateLabel}，请等待运行时回填最终状态。`;
    }
    if (params.nextQueuedTurn) {
      return `${params.interruptStateLabel}，可继续 ${params.nextQueuedTurn.title}`;
    }
    return `${params.interruptStateLabel}，如需继续可重新发起下一回合。`;
  }

  if (params.latestTurn?.status === "running") {
    return `当前线程正在执行：${shortenText(params.latestTurn.prompt_text, 52) || "处理中"}`;
  }

  if (params.outcome) {
    return params.outcome.summary;
  }

  if (params.queuedTurnCount > 0) {
    return `当前有 ${params.queuedTurnCount} 个排队回合等待执行`;
  }

  return `当前线程状态：${params.statusLabel}`;
}

function buildRecommendations(params: {
  pendingRequests: ThreadReliabilityRequestDisplay[];
  submittedRequests: ThreadReliabilityRequestDisplay[];
  incidents: ThreadReliabilityIncidentDisplay[];
  outcome: ThreadReliabilityOutcomeDisplay | null;
  nextQueuedTurn: ThreadReliabilityQueuedTurnDisplay | null;
  interruptState?: string | null;
  interruptStateLabel?: string | null;
}): string[] {
  const recommendations = new Set<string>();
  const incidentTypes = new Set(
    params.incidents.map((incident) => incident.incidentType),
  );

  if (params.pendingRequests.length > 0) {
    recommendations.add("优先响应当前待处理请求");
  }
  if (params.submittedRequests.length > 0) {
    recommendations.add("等待运行时回填最新状态");
  }
  if (params.incidents.some((incident) => incident.tone === "failed")) {
    recommendations.add("优先处理高优先级 incident");
  }
  if (incidentTypes.has("approval_timeout")) {
    recommendations.add("审批等待过久，建议尽快处理或停止当前执行");
  }
  if (incidentTypes.has("user_input_timeout")) {
    recommendations.add("人工输入等待过久，建议补充输入后继续线程");
  }
  if (incidentTypes.has("turn_stuck")) {
    recommendations.add("当前回合长时间无进展，建议停止后恢复执行");
  }
  if (incidentTypes.has("provider_error")) {
    recommendations.add("Provider 故障通常可重试，建议稍后恢复或重发回合");
  }
  if (incidentTypes.has("tool_failed")) {
    recommendations.add("请先检查失败工具的参数或环境，再尝试重试");
  }
  if (params.interruptStateLabel) {
    if ((params.interruptState || "").toLowerCase().includes("interrupting")) {
      recommendations.add("正在停止当前执行，请等待运行时回填最终状态");
    } else {
      recommendations.add("当前执行已被运行时确认中断");
    }
  }
  if (params.nextQueuedTurn && !((params.interruptState || "").toLowerCase().includes("interrupting"))) {
    recommendations.add(`可继续排队回合：${params.nextQueuedTurn.title}`);
  }
  if (params.outcome?.retryable) {
    recommendations.add("最近结果支持重试，可恢复或重新发起新回合");
  }
  if (params.outcome?.label.includes("Provider")) {
    recommendations.add("Provider 故障通常可重试，建议稍后恢复或重发回合");
  }
  if (params.outcome?.label.includes("工具")) {
    recommendations.add("请先检查失败工具的参数或环境，再尝试重试");
  }

  return [...recommendations];
}

export function buildThreadReliabilityView(
  params: BuildThreadReliabilityViewParams,
): ThreadReliabilityViewModel {
  const turns = params.turns ?? [];
  const threadItems = params.threadItems ?? [];
  const pendingActions = params.pendingActions ?? [];
  const submittedActionsInFlight = params.submittedActionsInFlight ?? [];
  const latestTurn = resolveLatestTurn(turns, params.currentTurnId);
  const pendingRequests = mergePendingRequests(
    params.threadRead,
    pendingActions,
    submittedActionsInFlight,
  );
  const submittedRequests = mergeSubmittedRequests(submittedActionsInFlight);
  const queuedTurnCount =
    params.threadRead?.queued_turns?.length ?? params.queuedTurns?.length ?? 0;
  const outcome = normalizeOutcome(params.threadRead?.last_outcome, latestTurn);
  const updatedAtLabel = formatTimeLabel(params.threadRead?.updated_at);
  const interruptStateLabel = normalizeInterruptStateLabel(
    params.threadRead?.interrupt_state,
  );
  const nextQueuedTurn = resolveNextQueuedTurn(
    params.threadRead,
    params.queuedTurns ?? [],
  );
  const incidents = normalizeIncidents(
    params.threadRead,
    latestTurn,
    threadItems,
    pendingRequests,
    submittedActionsInFlight,
  );
  const statusMeta = deriveStatusFromRuntime({
    threadRead: params.threadRead,
    latestTurn,
    pendingRequests,
    submittedRequests,
    queuedTurnCount,
  });

  return {
    shouldRender:
      Boolean(params.threadRead) ||
      turns.length > 0 ||
      pendingRequests.length > 0 ||
      submittedRequests.length > 0 ||
      incidents.length > 0 ||
      queuedTurnCount > 0,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    summary: buildSummary({
      statusLabel: statusMeta.label,
      latestTurn,
      pendingRequests,
      submittedRequests,
      incidents,
      outcome,
      queuedTurnCount,
      interruptState: params.threadRead?.interrupt_state,
      interruptStateLabel,
      nextQueuedTurn,
    }),
    activeTurnLabel:
      shortenText(latestTurn?.prompt_text, 56) ||
      params.threadRead?.active_turn_id ||
      latestTurn?.id ||
      null,
    updatedAtLabel,
    interruptStateLabel,
    pendingRequestCount: pendingRequests.length,
    activeIncidentCount: incidents.length,
    queuedTurnCount,
    pendingRequests,
    submittedRequests,
    incidents,
    outcome,
    nextQueuedTurn,
    recommendations: buildRecommendations({
      pendingRequests,
      submittedRequests,
      incidents,
      outcome,
      nextQueuedTurn,
      interruptState: params.threadRead?.interrupt_state,
      interruptStateLabel,
    }),
  };
}
