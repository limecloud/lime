import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  buildTeamDefinitionSummary,
  type TeamDefinition,
  type TeamRoleDefinition,
} from "./utils/teamDefinitions";
import {
  resolveTeamWorkspaceDisplayFormationMeta,
  resolveTeamWorkspaceDisplayMemberStatusLabel,
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
} from "./utils/teamWorkspaceCopy";
import { resolveToolDisplayLabel } from "./utils/toolDisplayInfo";

export type TeamWorkspaceRuntimeStatus =
  AsterSubagentSessionInfo["runtime_status"];
export type TeamWorkspaceResolvedRuntimeStatus =
  | TeamWorkspaceRuntimeStatus
  | "not_found";

export interface TeamWorkspaceActivityEntry {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  badgeClassName: string;
}

export interface TeamWorkspaceLiveRuntimeState {
  runtimeStatus: TeamWorkspaceRuntimeStatus;
  latestTurnStatus: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamPhase?: string;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  retryableOverload?: boolean;
  baseFingerprint: string;
}

export interface TeamWorkspaceRuntimeSessionSnapshot {
  id: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamPhase?: string;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  retryableOverload?: boolean;
  updatedAt?: number;
}

export interface TeamWorkspaceRuntimeCard {
  id: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamPhase?: string;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  retryableOverload?: boolean;
}

export interface TeamWorkspaceExecutionSummary {
  totalSessionCount: number;
  runningSessionCount: number;
  queuedSessionCount: number;
  activeSessionCount: number;
  hasActiveRuntime: boolean;
  statusTitle: string | null;
}

export interface TeamWorkspaceWaitSummary {
  awaitedSessionIds: string[];
  timedOut: boolean;
  resolvedSessionId?: string;
  resolvedStatus?: TeamWorkspaceResolvedRuntimeStatus;
  updatedAt: number;
}

export interface TeamWorkspaceControlSummary {
  action: "close" | "resume" | "close_completed";
  requestedSessionIds: string[];
  cascadeSessionIds: string[];
  affectedSessionIds: string[];
  updatedAt: number;
}

export type TeamWorkspaceRuntimeFormationStatus =
  | "forming"
  | "formed"
  | "failed";

export type TeamWorkspaceRuntimeMemberStatus =
  | "planned"
  | "spawning"
  | "running"
  | "waiting"
  | "completed"
  | "failed";

export interface TeamWorkspaceBlueprintSnapshot {
  label?: string | null;
  summary?: string | null;
  roles: TeamRoleDefinition[];
}

export interface TeamWorkspaceRuntimeMember {
  id: string;
  label: string;
  summary: string;
  profileId?: string;
  roleKey?: string;
  skillIds: string[];
  status: TeamWorkspaceRuntimeMemberStatus;
  sessionId?: string;
  latestSnippet?: string | null;
}

export interface TeamWorkspaceRuntimeFormationState {
  requestId: string;
  status: TeamWorkspaceRuntimeFormationStatus;
  label?: string | null;
  summary?: string | null;
  members: TeamWorkspaceRuntimeMember[];
  blueprint?: TeamWorkspaceBlueprintSnapshot | null;
  errorMessage?: string | null;
  updatedAt: number;
}

const FORMATION_STATUS_META = {
  forming: {
    label: resolveTeamWorkspaceDisplayFormationMeta("forming").label,
    title: resolveTeamWorkspaceDisplayFormationMeta("forming").title,
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
  },
  formed: {
    label: resolveTeamWorkspaceDisplayFormationMeta("formed").label,
    title: resolveTeamWorkspaceDisplayFormationMeta("formed").title,
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayFormationMeta("failed").label,
    title: resolveTeamWorkspaceDisplayFormationMeta("failed").title,
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
  },
} satisfies Record<
  TeamWorkspaceRuntimeFormationStatus,
  {
    label: string;
    title: string;
    badgeClassName: string;
  }
>;

const MEMBER_STATUS_META = {
  planned: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("planned"),
    badgeClassName: "border border-slate-200 bg-slate-50 text-slate-600",
  },
  spawning: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("spawning"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
  },
  running: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("running"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
  },
  waiting: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("waiting"),
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
  },
  completed: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("completed"),
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayMemberStatusLabel("failed"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
  },
} satisfies Record<
  TeamWorkspaceRuntimeMemberStatus,
  {
    label: string;
    badgeClassName: string;
  }
>;

const STATUS_META = {
  idle: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel(undefined),
    badgeClassName: "border border-slate-200 bg-white text-slate-600",
  },
  queued: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("queued"),
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
  },
  running: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
  },
  completed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("completed"),
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("failed"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
  },
  aborted: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("aborted"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
  },
  closed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("closed"),
    badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
  },
} satisfies Record<
  NonNullable<TeamWorkspaceRuntimeStatus> | "idle",
  { label: string; badgeClassName: string }
>;

const ACTIVITY_DETAIL_MAX_LENGTH = 220;

function resolveStatusMeta(status?: TeamWorkspaceRuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

function normalizeActivityText(
  value?: string | null,
  maxLength = ACTIVITY_DETAIL_MAX_LENGTH,
): string | null {
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

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function resolveActivityEntryStatusMeta(
  item: AgentThreadItem,
  status?: AgentThreadItem["status"],
) {
  if (item.type === "error") {
    return {
      label: "错误",
      badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (item.type === "warning") {
    return {
      label: "警告",
      badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  switch (status) {
    case "in_progress":
      return {
        label: "进行中",
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "failed":
      return {
        label: "失败",
        badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "completed":
      return {
        label: "完成",
        badgeClassName:
          "border border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    default:
      return {
        label: "消息",
        badgeClassName: "border border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}

function resolveItemActivityDescriptor(item: AgentThreadItem): {
  title: string;
  detail: string | null;
} | null {
  switch (item.type) {
    case "agent_message":
      return {
        title: "回复",
        detail: normalizeActivityText(item.text),
      };
    case "turn_summary":
      return {
        title: "总结",
        detail: normalizeActivityText(item.text),
      };
    case "reasoning":
      return {
        title: "推理",
        detail: normalizeActivityText(item.text),
      };
    case "plan":
      return {
        title: "计划",
        detail: normalizeActivityText(item.text),
      };
    case "tool_call": {
      const displayToolName = item.tool_name
        ? resolveToolDisplayLabel(item.tool_name)
        : null;
      return {
        title: displayToolName ? `工具 ${displayToolName}` : "工具输出",
        detail:
          normalizeActivityText(item.error || item.output) ||
          normalizeActivityText(displayToolName || item.tool_name),
      };
    }
    case "command_execution":
      return {
        title: item.error || item.aggregated_output ? "命令输出" : "命令",
        detail:
          normalizeActivityText(item.error || item.aggregated_output) ||
          normalizeActivityText(item.command),
      };
    case "web_search":
      return {
        title: item.output ? "检索结果" : "检索查询",
        detail:
          normalizeActivityText(item.output) ||
          normalizeActivityText(item.query),
      };
    case "warning":
      return {
        title: "警告",
        detail: normalizeActivityText(item.message),
      };
    case "error":
      return {
        title: "错误",
        detail: normalizeActivityText(item.message),
      };
    case "subagent_activity":
      return {
        title: "任务进展",
        detail: normalizeActivityText(
          item.summary || item.title || item.status_label,
        ),
      };
    default:
      return null;
  }
}

export function resolveTeamWorkspaceRuntimeStatusLabel(
  status?: TeamWorkspaceResolvedRuntimeStatus,
): string {
  return resolveTeamWorkspaceDisplayRuntimeStatusLabel(
    status === "idle" ? undefined : status,
  );
}

export function isTeamWorkspaceTerminalStatus(
  status?: TeamWorkspaceResolvedRuntimeStatus,
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "aborted" ||
    status === "closed" ||
    status === "not_found"
  );
}

export function normalizeTeamWorkspaceRuntimeStatus(
  status: TeamWorkspaceResolvedRuntimeStatus,
): TeamWorkspaceRuntimeStatus {
  return status === "not_found" ? "closed" : status;
}

export function isTeamWorkspaceActiveStatus(
  status?: TeamWorkspaceResolvedRuntimeStatus,
): boolean {
  return status === "running" || status === "queued";
}

function resolveExecutionSummaryStatusTitle(params: {
  totalSessionCount: number;
  runningSessionCount: number;
  queuedSessionCount: number;
}) {
  const { totalSessionCount, runningSessionCount, queuedSessionCount } = params;
  if (runningSessionCount > 0) {
    if (queuedSessionCount > 0) {
      return totalSessionCount > 1
        ? `任务进行中 · ${runningSessionCount} 项处理中 / ${queuedSessionCount} 项稍后开始`
        : "任务进行中";
    }
    return totalSessionCount > 1
      ? `任务进行中 · ${runningSessionCount}/${totalSessionCount}`
      : "任务进行中";
  }

  if (queuedSessionCount > 0) {
    return totalSessionCount > 1
      ? `任务准备中 · ${queuedSessionCount}/${totalSessionCount}`
      : "任务准备中";
  }

  return null;
}

function buildExecutionSummarySnapshots(params: {
  currentSessionId?: string | null;
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionLatestTurnStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
}) {
  const snapshots = new Map<string, TeamWorkspaceRuntimeSessionSnapshot>();
  const currentSessionId = params.currentSessionId?.trim();

  if (params.subagentParentContext && currentSessionId) {
    snapshots.set(currentSessionId, {
      id: currentSessionId,
      runtimeStatus: params.currentSessionRuntimeStatus,
      latestTurnStatus: params.currentSessionLatestTurnStatus,
      queuedTurnCount: params.currentSessionQueuedTurnCount,
    });
  }

  const relatedSessions = params.subagentParentContext
    ? (params.subagentParentContext.sibling_subagent_sessions ?? [])
    : (params.childSubagentSessions ?? []);

  relatedSessions.forEach((session) => {
    if (snapshots.has(session.id)) {
      return;
    }
    snapshots.set(session.id, {
      id: session.id,
      runtimeStatus: session.runtime_status,
      latestTurnStatus: session.latest_turn_status,
      queuedTurnCount: session.queued_turn_count,
      updatedAt: session.updated_at,
    });
  });

  return Array.from(snapshots.values());
}

function resolveExecutionSummarySessionStatus(params: {
  session: TeamWorkspaceRuntimeSessionSnapshot;
  liveState?: TeamWorkspaceLiveRuntimeState;
}): TeamWorkspaceRuntimeStatus | undefined {
  if (params.liveState?.runtimeStatus) {
    return params.liveState.runtimeStatus;
  }

  if (params.session.runtimeStatus) {
    return params.session.runtimeStatus;
  }

  if (params.session.latestTurnStatus) {
    return params.session.latestTurnStatus;
  }

  if ((params.session.queuedTurnCount ?? 0) > 0) {
    return "queued";
  }

  return undefined;
}

export function summarizeTeamWorkspaceExecution(params: {
  currentSessionId?: string | null;
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionLatestTurnStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
}): TeamWorkspaceExecutionSummary {
  const snapshots = buildExecutionSummarySnapshots(params);
  let runningSessionCount = 0;
  let queuedSessionCount = 0;

  snapshots.forEach((session) => {
    const status = resolveExecutionSummarySessionStatus({
      session,
      liveState: params.liveRuntimeBySessionId?.[session.id],
    });

    if (status === "running") {
      runningSessionCount += 1;
      return;
    }

    if (status === "queued") {
      queuedSessionCount += 1;
    }
  });

  const activeSessionCount = runningSessionCount + queuedSessionCount;
  const totalSessionCount = snapshots.length;

  return {
    totalSessionCount,
    runningSessionCount,
    queuedSessionCount,
    activeSessionCount,
    hasActiveRuntime: activeSessionCount > 0,
    statusTitle: resolveExecutionSummaryStatusTitle({
      totalSessionCount,
      runningSessionCount,
      queuedSessionCount,
    }),
  };
}

export function buildTeamWorkspaceSessionFingerprint(
  session?: TeamWorkspaceRuntimeSessionSnapshot | null,
) {
  if (!session) {
    return "";
  }

  return [
    session.id,
    session.updatedAt ?? 0,
    session.runtimeStatus ?? "idle",
    session.latestTurnStatus ?? "idle",
    session.queuedTurnCount ?? 0,
  ].join(":");
}

export function buildStatusEventActivityEntry(
  sessionId: string,
  status: TeamWorkspaceRuntimeStatus | "not_found",
): TeamWorkspaceActivityEntry {
  const normalizedStatus = normalizeTeamWorkspaceRuntimeStatus(status);
  const statusMeta = resolveStatusMeta(normalizedStatus);
  return {
    id: `status-${sessionId}-${normalizedStatus}-${Date.now()}`,
    title: "状态切换",
    detail: `收到任务状态事件，已切换为${statusMeta.label}。`,
    statusLabel: statusMeta.label,
    badgeClassName: statusMeta.badgeClassName,
  };
}

export function buildTeamWorkspaceActivityEntryFromThreadItem(
  item: AgentThreadItem,
): TeamWorkspaceActivityEntry | null {
  const descriptor = resolveItemActivityDescriptor(item);
  if (!descriptor?.detail) {
    return null;
  }

  const statusMeta = resolveActivityEntryStatusMeta(item, item.status);
  return {
    id: item.id,
    title: descriptor.title,
    detail: descriptor.detail,
    statusLabel: statusMeta.label,
    badgeClassName: statusMeta.badgeClassName,
  };
}

export function mergeSessionActivityEntries(
  liveEntries?: TeamWorkspaceActivityEntry[],
  storedEntries?: TeamWorkspaceActivityEntry[],
  limit = 4,
) {
  const merged: TeamWorkspaceActivityEntry[] = [];
  const seen = new Set<string>();

  for (const entry of [...(liveEntries ?? []), ...(storedEntries ?? [])]) {
    const dedupeKey = `${entry.title}:${entry.detail}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(entry);
    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

export function applyLiveRuntimeState<T extends TeamWorkspaceRuntimeCard>(
  session: T | null,
  liveState?: TeamWorkspaceLiveRuntimeState,
): T | null {
  if (!session || !liveState) {
    return session;
  }

  return {
    ...session,
    runtimeStatus: liveState.runtimeStatus,
    latestTurnStatus: liveState.latestTurnStatus,
    queuedTurnCount: liveState.queuedTurnCount ?? session.queuedTurnCount,
    teamPhase: liveState.teamPhase ?? session.teamPhase,
    teamParallelBudget:
      liveState.teamParallelBudget ?? session.teamParallelBudget,
    teamActiveCount: liveState.teamActiveCount ?? session.teamActiveCount,
    teamQueuedCount: liveState.teamQueuedCount ?? session.teamQueuedCount,
    providerConcurrencyGroup:
      liveState.providerConcurrencyGroup ?? session.providerConcurrencyGroup,
    providerParallelBudget:
      liveState.providerParallelBudget ?? session.providerParallelBudget,
    queueReason: liveState.queueReason ?? session.queueReason,
    retryableOverload: liveState.retryableOverload ?? session.retryableOverload,
  };
}

export function createTeamWorkspaceBlueprintSnapshot(
  team?: TeamDefinition | null,
): TeamWorkspaceBlueprintSnapshot | null {
  if (!team) {
    return null;
  }

  return {
    label: team.label?.trim() || null,
    summary: buildTeamDefinitionSummary(team) || null,
    roles: team.roles.map((role) => ({
      ...role,
      skillIds: role.skillIds ? [...role.skillIds] : [],
    })),
  };
}

export function createRuntimeFormationStateFromTeam(params: {
  requestId: string;
  status: TeamWorkspaceRuntimeFormationStatus;
  runtimeTeam?: TeamDefinition | null;
  blueprintTeam?: TeamDefinition | null;
  errorMessage?: string | null;
  updatedAt?: number;
}): TeamWorkspaceRuntimeFormationState {
  const runtimeTeam = params.runtimeTeam || null;

  return {
    requestId: params.requestId,
    status: params.status,
    label: runtimeTeam?.label?.trim() || null,
    summary: runtimeTeam
      ? buildTeamDefinitionSummary(runtimeTeam) || null
      : null,
    members: (runtimeTeam?.roles ?? []).map((role, index) => ({
      id: role.id?.trim() || `runtime-member-${index + 1}`,
      label: role.label?.trim() || `角色 ${index + 1}`,
      summary:
        role.summary?.trim() ||
        `${role.label || `角色 ${index + 1}`}负责当前子任务。`,
      profileId: role.profileId?.trim() || undefined,
      roleKey: role.roleKey?.trim() || undefined,
      skillIds: role.skillIds ? [...role.skillIds] : [],
      status: "planned",
      sessionId: undefined,
      latestSnippet: null,
    })),
    blueprint: createTeamWorkspaceBlueprintSnapshot(params.blueprintTeam),
    errorMessage: params.errorMessage?.trim() || null,
    updatedAt: params.updatedAt ?? Date.now(),
  };
}

export function resolveRuntimeFormationStatusMeta(
  status: TeamWorkspaceRuntimeFormationStatus,
) {
  return FORMATION_STATUS_META[status];
}

export function resolveRuntimeMemberStatusMeta(
  status: TeamWorkspaceRuntimeMemberStatus,
) {
  return MEMBER_STATUS_META[status];
}
