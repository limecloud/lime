import {
  type AgentRuntimeStatusPayload,
  type AgentToolExecutionResult as ToolExecutionResult,
  type AgentEvent,
} from "@/lib/api/agentProtocol";
import {
  buildStatusEventActivityEntry,
  buildTeamWorkspaceActivityEntryFromThreadItem,
  buildTeamWorkspaceSessionFingerprint,
  normalizeTeamWorkspaceRuntimeStatus,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeSessionSnapshot,
  type TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";
import { resolveUserFacingToolDisplayLabel } from "../utils/toolDisplayInfo";
import { resolveTeamWorkspaceDisplayRuntimeStatusLabel } from "../utils/teamWorkspaceCopy";
import {
  buildRuntimeStatusPresentationText,
  isInternalRoutingRuntimeStatus,
} from "../utils/turnSummaryPresentation";

const LIVE_ACTIVITY_ENTRY_LIMIT = 3;
const LIVE_ACTIVITY_DETAIL_MAX_LENGTH = 220;

const IN_PROGRESS_BADGE_CLASS_NAME =
  "border border-sky-200 bg-sky-50 text-sky-700";
const QUEUED_BADGE_CLASS_NAME =
  "border border-amber-200 bg-amber-50 text-amber-700";
const COMPLETED_BADGE_CLASS_NAME =
  "border border-emerald-200 bg-emerald-50 text-emerald-700";
const FAILED_BADGE_CLASS_NAME =
  "border border-rose-200 bg-rose-50 text-rose-700";

const LIVE_RUNTIME_PATCH_KEYS = [
  "runtimeStatus",
  "latestTurnStatus",
  "queuedTurnCount",
  "teamPhase",
  "teamParallelBudget",
  "teamActiveCount",
  "teamQueuedCount",
  "providerConcurrencyGroup",
  "providerParallelBudget",
  "queueReason",
  "retryableOverload",
] as const;

type LiveRuntimePatchKey = (typeof LIVE_RUNTIME_PATCH_KEYS)[number];

export interface SessionLiveStreamState {
  textDraft?: string;
  thinkingDraft?: string;
}

export type TeamWorkspaceLiveRuntimePatch = Partial<
  Pick<TeamWorkspaceLiveRuntimeState, LiveRuntimePatchKey>
>;

export interface TeamWorkspaceRuntimeStreamProjection {
  entry?: TeamWorkspaceActivityEntry | null;
  clearEntryIds?: string[];
  nextTextDraft?: string;
  clearTextDraft?: boolean;
  nextThinkingDraft?: string;
  clearThinkingDraft?: boolean;
  rememberTool?: { toolId: string; toolName: string };
  forgetToolId?: string;
  liveRuntimePatch?: TeamWorkspaceLiveRuntimePatch;
  refreshPreview?: boolean;
}

export interface TeamWorkspaceStatusChangedProjection {
  entry: TeamWorkspaceActivityEntry;
  liveRuntimePatch: TeamWorkspaceLiveRuntimePatch;
}

function normalizeLiveActivityText(
  value?: string | null,
  maxLength = LIVE_ACTIVITY_DETAIL_MAX_LENGTH,
) {
  const normalized = value
    ?.replace(/\r\n/g, "\n")
    .split("\0")
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `...${normalized.slice(-maxLength).trimStart()}`;
}

function appendLiveActivityDraft(previous: string | undefined, chunk: string) {
  const base = previous ?? "";
  if (!base) {
    return normalizeLiveActivityText(chunk) ?? undefined;
  }

  if (!chunk) {
    return normalizeLiveActivityText(base) ?? undefined;
  }

  if (chunk.startsWith(base)) {
    return normalizeLiveActivityText(chunk) ?? undefined;
  }

  if (base.endsWith(chunk)) {
    return normalizeLiveActivityText(base) ?? undefined;
  }

  const maxOverlap = Math.min(base.length, chunk.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.slice(-overlap) === chunk.slice(0, overlap)) {
      return normalizeLiveActivityText(`${base}${chunk.slice(overlap)}`) ?? undefined;
    }
  }

  return normalizeLiveActivityText(`${base}${chunk}`) ?? undefined;
}

function buildActivityEntry(params: {
  id: string;
  title: string;
  detail?: string | null;
  statusLabel: string;
  badgeClassName: string;
}): TeamWorkspaceActivityEntry | null {
  const detail = normalizeLiveActivityText(params.detail);
  if (!detail) {
    return null;
  }

  return {
    id: params.id,
    title: params.title,
    detail,
    statusLabel: params.statusLabel,
    badgeClassName: params.badgeClassName,
  };
}

function buildTextDraftEntry(sessionId: string, draft?: string) {
  return buildActivityEntry({
    id: `stream-text:${sessionId}`,
    title: "内容生成中",
    detail: draft,
    statusLabel: "处理中",
    badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildThinkingDraftEntry(sessionId: string, draft?: string) {
  return buildActivityEntry({
    id: `stream-thinking:${sessionId}`,
    title: "整理思路中",
    detail: draft,
    statusLabel: "处理中",
    badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildRuntimeStatusEntry(
  sessionId: string,
  status: AgentRuntimeStatusPayload,
) {
  if (isInternalRoutingRuntimeStatus(status)) {
    return null;
  }

  const waiting =
    status.metadata?.team_phase === "queued" ||
    status.metadata?.concurrency_phase === "queued";
  const detail = buildRuntimeStatusPresentationText({
    detail: status.detail,
    checkpoints: (status.checkpoints ?? []).map((item) => `• ${item}`),
  });
  return buildActivityEntry({
    id: `runtime-status:${sessionId}`,
    title: status.title.trim() || "当前进展",
    detail,
    statusLabel: waiting ? "稍后开始" : "处理中",
    badgeClassName: waiting
      ? QUEUED_BADGE_CLASS_NAME
      : IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function compactLiveRuntimePatch(
  patch: TeamWorkspaceLiveRuntimePatch,
): TeamWorkspaceLiveRuntimePatch | undefined {
  const nextPatch: TeamWorkspaceLiveRuntimePatch = {};

  for (const key of LIVE_RUNTIME_PATCH_KEYS) {
    const value = patch[key];
    if (value !== undefined) {
      assignLiveRuntimePatchValue(nextPatch, key, value);
    }
  }

  return LIVE_RUNTIME_PATCH_KEYS.some((key) => nextPatch[key] !== undefined)
    ? nextPatch
    : undefined;
}

function assignLiveRuntimePatchValue<K extends LiveRuntimePatchKey>(
  patch: TeamWorkspaceLiveRuntimePatch,
  key: K,
  value: TeamWorkspaceLiveRuntimePatch[K],
) {
  patch[key] = value;
}

function buildRuntimeStatusMetadataPatch(
  status: AgentRuntimeStatusPayload,
): TeamWorkspaceLiveRuntimePatch | undefined {
  return compactLiveRuntimePatch({
    teamPhase: status.metadata?.team_phase,
    teamParallelBudget: status.metadata?.team_parallel_budget,
    teamActiveCount: status.metadata?.team_active_count,
    teamQueuedCount: status.metadata?.team_queued_count,
    providerConcurrencyGroup: status.metadata?.provider_concurrency_group,
    providerParallelBudget: status.metadata?.provider_parallel_budget,
    queueReason: status.metadata?.queue_reason,
    retryableOverload: status.metadata?.retryable_overload,
  });
}

function buildToolActivityEntry(params: {
  sessionId: string;
  toolId: string;
  toolName?: string;
  result?: ToolExecutionResult;
}) {
  const { sessionId, toolId, toolName, result } = params;
  const displayToolName = toolName?.trim()
    ? resolveUserFacingToolDisplayLabel(toolName)
    : null;
  const title = displayToolName ? `处理中 · ${displayToolName}` : "处理中";
  const detail = result
    ? result.error || result.output || displayToolName || "当前步骤已完成。"
    : `正在处理 ${displayToolName || "当前步骤"}。`;
  const success = result ? result.success !== false : true;

  return buildActivityEntry({
    id: `tool:${sessionId}:${toolId}`,
    title,
    detail,
    statusLabel: result ? (success ? "完成" : "需重试") : "处理中",
    badgeClassName: result
      ? success
        ? COMPLETED_BADGE_CLASS_NAME
        : FAILED_BADGE_CLASS_NAME
      : IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildLifecycleActivityEntry(params: {
  sessionId: string;
  key: string;
  title: string;
  detail: string;
  statusLabel: string;
  badgeClassName: string;
}) {
  return buildActivityEntry({
    id: `lifecycle:${params.sessionId}:${params.key}`,
    title: params.title,
    detail: params.detail,
    statusLabel: params.statusLabel,
    badgeClassName: params.badgeClassName,
  });
}

function buildWarningActivityEntry(
  sessionId: string,
  message: string,
  code?: string,
) {
  return buildActivityEntry({
    id: `warning:${sessionId}:${code ?? ""}:${message}`,
    title: "警告",
    detail: message,
    statusLabel: "警告",
    badgeClassName: QUEUED_BADGE_CLASS_NAME,
  });
}

function buildErrorActivityEntry(sessionId: string, message: string) {
  return buildActivityEntry({
    id: `error:${sessionId}:${message}`,
    title: "错误",
    detail: message,
    statusLabel: "需重试",
    badgeClassName: FAILED_BADGE_CLASS_NAME,
  });
}

export function areActivityEntriesEqual(
  left: TeamWorkspaceActivityEntry,
  right: TeamWorkspaceActivityEntry,
) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.detail === right.detail &&
    left.statusLabel === right.statusLabel &&
    left.badgeClassName === right.badgeClassName
  );
}

export function upsertLiveActivityEntries(
  entries: TeamWorkspaceActivityEntry[],
  entry: TeamWorkspaceActivityEntry,
) {
  if (entries[0] && areActivityEntriesEqual(entries[0], entry)) {
    return entries;
  }

  const filtered = entries.filter((item) => item.id !== entry.id);
  const next = [entry, ...filtered].slice(0, LIVE_ACTIVITY_ENTRY_LIMIT);

  if (
    next.length === entries.length &&
    next.every((item, index) => areActivityEntriesEqual(item, entries[index]!))
  ) {
    return entries;
  }

  return next;
}

export function removeLiveActivityEntries(
  entries: TeamWorkspaceActivityEntry[],
  entryIds: string[],
) {
  if (entryIds.length === 0) {
    return entries;
  }

  const removeSet = new Set(entryIds);
  const next = entries.filter((entry) => !removeSet.has(entry.id));
  if (next.length === entries.length) {
    return entries;
  }
  return next;
}

export function buildLiveRuntimeState(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  baseFingerprint: string,
  current: TeamWorkspaceLiveRuntimeState | undefined,
  patch: TeamWorkspaceLiveRuntimePatch,
): TeamWorkspaceLiveRuntimeState {
  return {
    runtimeStatus:
      patch.runtimeStatus ??
      current?.runtimeStatus ??
      session.runtimeStatus ??
      session.latestTurnStatus,
    latestTurnStatus:
      patch.latestTurnStatus ??
      current?.latestTurnStatus ??
      session.latestTurnStatus ??
      session.runtimeStatus,
    queuedTurnCount:
      patch.queuedTurnCount ??
      current?.queuedTurnCount ??
      session.queuedTurnCount,
    teamPhase: patch.teamPhase ?? current?.teamPhase ?? session.teamPhase,
    teamParallelBudget:
      patch.teamParallelBudget ??
      current?.teamParallelBudget ??
      session.teamParallelBudget,
    teamActiveCount:
      patch.teamActiveCount ??
      current?.teamActiveCount ??
      session.teamActiveCount,
    teamQueuedCount:
      patch.teamQueuedCount ??
      current?.teamQueuedCount ??
      session.teamQueuedCount,
    providerConcurrencyGroup:
      patch.providerConcurrencyGroup ??
      current?.providerConcurrencyGroup ??
      session.providerConcurrencyGroup,
    providerParallelBudget:
      patch.providerParallelBudget ??
      current?.providerParallelBudget ??
      session.providerParallelBudget,
    queueReason:
      patch.queueReason ?? current?.queueReason ?? session.queueReason,
    retryableOverload:
      patch.retryableOverload ??
      current?.retryableOverload ??
      session.retryableOverload,
    baseFingerprint,
  };
}

export function areLiveRuntimeStatesEqual(
  left: TeamWorkspaceLiveRuntimeState | undefined,
  right: TeamWorkspaceLiveRuntimeState,
) {
  return !!left &&
    left.runtimeStatus === right.runtimeStatus &&
    left.latestTurnStatus === right.latestTurnStatus &&
    left.queuedTurnCount === right.queuedTurnCount &&
    left.teamPhase === right.teamPhase &&
    left.teamParallelBudget === right.teamParallelBudget &&
    left.teamActiveCount === right.teamActiveCount &&
    left.teamQueuedCount === right.teamQueuedCount &&
    left.providerConcurrencyGroup === right.providerConcurrencyGroup &&
    left.providerParallelBudget === right.providerParallelBudget &&
    left.queueReason === right.queueReason &&
    left.retryableOverload === right.retryableOverload &&
    left.baseFingerprint === right.baseFingerprint;
}

function getQueuedTurnCount(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  current?: TeamWorkspaceLiveRuntimeState,
): number {
  return current?.queuedTurnCount ?? session.queuedTurnCount ?? 0;
}

function resolveQueueDrainedRuntimeStatus(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  current?: TeamWorkspaceLiveRuntimeState,
): TeamWorkspaceRuntimeStatus {
  const candidate = [
    current?.latestTurnStatus,
    session.latestTurnStatus,
    current?.runtimeStatus,
    session.runtimeStatus,
  ].find((status) => status && status !== "queued" && status !== "running");

  return candidate ?? "idle";
}

function resolveFinalRuntimeStatus(params: {
  session: TeamWorkspaceRuntimeSessionSnapshot;
  current?: TeamWorkspaceLiveRuntimeState;
  terminalStatus?: Extract<TeamWorkspaceRuntimeStatus, "completed" | "failed">;
  queuedTurnCount?: number;
}): TeamWorkspaceRuntimeStatus {
  const queuedTurnCount =
    params.queuedTurnCount ??
    getQueuedTurnCount(params.session, params.current);
  if (queuedTurnCount > 0) {
    return "queued";
  }

  if (params.terminalStatus) {
    return params.terminalStatus;
  }

  const candidate = [
    params.current?.latestTurnStatus,
    params.session.latestTurnStatus,
    params.current?.runtimeStatus,
    params.session.runtimeStatus,
  ].find((status) => status && status !== "queued" && status !== "running");

  return candidate ?? "completed";
}

export function buildStatusChangedProjection(params: {
  sessionId: string;
  status: TeamWorkspaceRuntimeStatus | "not_found";
  session: TeamWorkspaceRuntimeSessionSnapshot;
  currentRuntime?: TeamWorkspaceLiveRuntimeState;
}): TeamWorkspaceStatusChangedProjection {
  const normalizedStatus = normalizeTeamWorkspaceRuntimeStatus(params.status);
  const nextQueuedTurnCount =
    normalizedStatus === "completed" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "aborted" ||
    normalizedStatus === "closed" ||
    normalizedStatus === "idle"
      ? 0
      : (params.currentRuntime?.queuedTurnCount ?? params.session.queuedTurnCount);

  return {
    entry: buildStatusEventActivityEntry(params.sessionId, params.status),
    liveRuntimePatch: {
      runtimeStatus: normalizedStatus,
      latestTurnStatus: normalizedStatus,
      queuedTurnCount: nextQueuedTurnCount,
    },
  };
}

export function projectRuntimeStreamEvent(params: {
  sessionId: string;
  session: TeamWorkspaceRuntimeSessionSnapshot;
  event: AgentEvent;
  currentRuntime?: TeamWorkspaceLiveRuntimeState;
  streamState?: SessionLiveStreamState;
  toolNameById?: Record<string, string>;
}): TeamWorkspaceRuntimeStreamProjection | null {
  const {
    sessionId,
    session,
    event,
    currentRuntime,
    streamState,
    toolNameById,
  } = params;

  switch (event.type) {
    case "item_started":
    case "item_updated":
    case "item_completed": {
      const entry = buildTeamWorkspaceActivityEntryFromThreadItem(event.item);
      const clearEntryIds: string[] = [];

      if (
        event.type === "item_completed" &&
        (event.item.type === "agent_message" ||
          event.item.type === "turn_summary")
      ) {
        clearEntryIds.push(
          `stream-text:${sessionId}`,
          `runtime-status:${sessionId}`,
        );
      }

      if (event.type === "item_completed" && event.item.type === "reasoning") {
        clearEntryIds.push(`stream-thinking:${sessionId}`);
      }

      return {
        entry,
        clearEntryIds,
        clearTextDraft:
          event.type === "item_completed" &&
          (event.item.type === "agent_message" ||
            event.item.type === "turn_summary"),
        clearThinkingDraft:
          event.type === "item_completed" && event.item.type === "reasoning",
        refreshPreview: event.type === "item_completed",
      };
    }
    case "text_delta": {
      const nextTextDraft = appendLiveActivityDraft(
        streamState?.textDraft,
        event.text,
      );
      return {
        entry: buildTextDraftEntry(sessionId, nextTextDraft),
        nextTextDraft: nextTextDraft ?? undefined,
      };
    }
    case "thinking_delta": {
      const nextThinkingDraft = appendLiveActivityDraft(
        streamState?.thinkingDraft,
        event.text,
      );
      return {
        entry: buildThinkingDraftEntry(sessionId, nextThinkingDraft),
        nextThinkingDraft: nextThinkingDraft ?? undefined,
      };
    }
    case "tool_start":
      return {
        entry: buildToolActivityEntry({
          sessionId,
          toolId: event.tool_id,
          toolName: event.tool_name,
        }),
        rememberTool: {
          toolId: event.tool_id,
          toolName: event.tool_name,
        },
      };
    case "tool_end":
      return {
        entry: buildToolActivityEntry({
          sessionId,
          toolId: event.tool_id,
          toolName: toolNameById?.[event.tool_id],
          result: event.result,
        }),
        forgetToolId: event.tool_id,
        refreshPreview: true,
      };
    case "runtime_status": {
      const liveRuntimePatch = compactLiveRuntimePatch({
        ...buildRuntimeStatusMetadataPatch(event.status),
        runtimeStatus:
          event.status.metadata?.team_phase === "queued" ||
          event.status.metadata?.concurrency_phase === "queued"
            ? "queued"
            : event.status.metadata?.team_phase === "running" ||
                event.status.metadata?.concurrency_phase === "running"
              ? "running"
              : undefined,
      });
      return {
        entry: buildRuntimeStatusEntry(sessionId, event.status),
        liveRuntimePatch,
      };
    }
    case "queue_added":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "queue",
          title: "稍后开始",
          detail: "新的说明已经收到，这项子任务会在前一项完成后继续处理。",
          statusLabel: resolveTeamWorkspaceDisplayRuntimeStatusLabel("queued"),
          badgeClassName: QUEUED_BADGE_CLASS_NAME,
        }),
        liveRuntimePatch: {
          runtimeStatus: "queued",
          latestTurnStatus: "queued",
          queuedTurnCount: getQueuedTurnCount(session, currentRuntime) + 1,
        },
      };
    case "queue_started":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "queue",
          title: "开始处理",
          detail: "这项子任务已经开始处理当前任务。",
          statusLabel: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
          badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
        }),
        liveRuntimePatch: {
          runtimeStatus: "running",
          latestTurnStatus: "running",
          queuedTurnCount: Math.max(
            getQueuedTurnCount(session, currentRuntime) - 1,
            0,
          ),
        },
      };
    case "queue_removed": {
      const queuedTurnCount = Math.max(
        getQueuedTurnCount(session, currentRuntime) - 1,
        0,
      );
      return {
        liveRuntimePatch: compactLiveRuntimePatch({
          queuedTurnCount,
          runtimeStatus:
            queuedTurnCount === 0 && currentRuntime?.runtimeStatus === "queued"
              ? resolveQueueDrainedRuntimeStatus(session, currentRuntime)
              : undefined,
        }),
        refreshPreview: true,
      };
    }
    case "queue_cleared":
      return {
        liveRuntimePatch: compactLiveRuntimePatch({
          queuedTurnCount: 0,
          runtimeStatus:
            currentRuntime?.runtimeStatus === "queued"
              ? resolveQueueDrainedRuntimeStatus(session, currentRuntime)
              : undefined,
        }),
        refreshPreview: true,
      };
    case "turn_started":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "turn",
          title: "继续处理",
          detail: "这项子任务正在推进当前内容。",
          statusLabel: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
          badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
        }),
        liveRuntimePatch: {
          runtimeStatus: "running",
          latestTurnStatus: "running",
        },
      };
    case "turn_completed": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "turn",
          title: "阶段完成",
          detail: "这一步已经完成，正在同步最新结果。",
          statusLabel: "完成",
          badgeClassName: COMPLETED_BADGE_CLASS_NAME,
        }),
        liveRuntimePatch: {
          runtimeStatus: resolveFinalRuntimeStatus({
            session,
            current: currentRuntime,
            terminalStatus: "completed",
            queuedTurnCount,
          }),
          latestTurnStatus: "completed",
          queuedTurnCount,
        },
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    case "turn_failed": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "turn",
          title: "处理失败",
          detail:
            event.turn.error_message?.trim() ||
            "这一步处理失败，请查看错误详情。",
          statusLabel: "需重试",
          badgeClassName: FAILED_BADGE_CLASS_NAME,
        }),
        liveRuntimePatch: {
          runtimeStatus: resolveFinalRuntimeStatus({
            session,
            current: currentRuntime,
            terminalStatus: "failed",
            queuedTurnCount,
          }),
          latestTurnStatus: "failed",
          queuedTurnCount,
        },
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    case "warning":
      return {
        entry: buildWarningActivityEntry(sessionId, event.message, event.code),
        refreshPreview: true,
      };
    case "error": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        entry: buildErrorActivityEntry(sessionId, event.message),
        liveRuntimePatch: {
          runtimeStatus: resolveFinalRuntimeStatus({
            session,
            current: currentRuntime,
            terminalStatus: "failed",
            queuedTurnCount,
          }),
          latestTurnStatus: "failed",
          queuedTurnCount,
        },
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    case "done":
      return null;
    case "final_done": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        liveRuntimePatch: {
          runtimeStatus: resolveFinalRuntimeStatus({
            session,
            current: currentRuntime,
            queuedTurnCount,
          }),
          queuedTurnCount,
        },
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    default:
      return null;
  }
}

export function buildLiveRuntimeBaseFingerprint(
  session: TeamWorkspaceRuntimeSessionSnapshot,
) {
  return buildTeamWorkspaceSessionFingerprint(session);
}
