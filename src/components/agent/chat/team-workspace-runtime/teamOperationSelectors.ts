import { formatRelativeTime } from "@/lib/api/project";
import {
  normalizeTeamWorkspaceRuntimeStatus,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import { resolveTeamWorkspaceRuntimeStatusLabel } from "../teamWorkspaceRuntime";

export interface TeamOperationDisplayEntry {
  id: string;
  title: string;
  detail: string;
  badgeClassName: string;
  updatedAt: number;
  targetSessionId?: string;
}

export interface TeamWorkspaceOperationSessionSnapshot {
  id: string;
  name: string;
}

export interface TeamWorkspaceVisibleOperationState {
  visibleTeamWaitSummary: TeamWorkspaceWaitSummary | null;
  visibleTeamControlSummary: TeamWorkspaceControlSummary | null;
  entries: TeamOperationDisplayEntry[];
}

const STATUS_BADGE_CLASS_NAME = {
  idle: "border border-slate-200 bg-white text-slate-600",
  queued: "border border-amber-200 bg-amber-50 text-amber-700",
  running: "border border-sky-200 bg-sky-50 text-sky-700",
  completed: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border border-rose-200 bg-rose-50 text-rose-700",
  aborted: "border border-rose-200 bg-rose-50 text-rose-700",
  closed: "border border-slate-200 bg-slate-100 text-slate-600",
} as const;

function resolveStatusBadgeClassName(
  status?: keyof typeof STATUS_BADGE_CLASS_NAME,
) {
  return STATUS_BADGE_CLASS_NAME[status ?? "idle"];
}

export function formatOperationUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt);
}

function buildTeamWaitSummaryDisplay(params: {
  summary: TeamWorkspaceWaitSummary;
  sessionNameById: Map<string, string>;
}) {
  if (params.summary.timedOut) {
    return {
      text: `刚才等待结果时超时了，还有 ${params.summary.awaitedSessionIds.length} 位协作成员仍在处理中。`,
      badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  const resolvedName = params.summary.resolvedSessionId
    ? (params.sessionNameById.get(params.summary.resolvedSessionId) ??
      params.summary.resolvedSessionId)
    : "成员";
  const normalizedStatus = params.summary.resolvedStatus
    ? normalizeTeamWorkspaceRuntimeStatus(params.summary.resolvedStatus)
    : undefined;

  return {
    text: `刚才等到 ${resolvedName} 返回了新结果，当前状态为${resolveTeamWorkspaceRuntimeStatusLabel(params.summary.resolvedStatus)}。`,
    badgeClassName: resolveStatusBadgeClassName(normalizedStatus),
  };
}

function buildTeamControlSummaryDisplay(params: {
  summary: TeamWorkspaceControlSummary;
  sessionNameById: Map<string, string>;
}) {
  const affectedCount = params.summary.affectedSessionIds.length;
  const firstAffectedId = params.summary.affectedSessionIds[0];
  const firstAffectedName = firstAffectedId
    ? (params.sessionNameById.get(firstAffectedId) ?? firstAffectedId)
    : "成员";

  switch (params.summary.action) {
    case "resume":
      return {
        text:
          affectedCount > 1
            ? `刚才已继续 ${affectedCount} 位协作成员的处理。`
            : `刚才已继续 ${firstAffectedName} 的处理。`,
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "close_completed":
      return {
        text: `刚才已收起 ${affectedCount} 位已完成成员。`,
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    case "close":
    default:
      return {
        text:
          affectedCount > 1
            ? `刚才已暂停 ${affectedCount} 位协作成员的处理。`
            : `刚才已暂停 ${firstAffectedName} 的处理。`,
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-700",
      };
  }
}

export function buildTeamOperationDisplayEntries(params: {
  sessionNameById: Map<string, string>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
}): TeamOperationDisplayEntry[] {
  const entries: TeamOperationDisplayEntry[] = [];

  if (params.teamWaitSummary) {
    const display = buildTeamWaitSummaryDisplay({
      summary: params.teamWaitSummary,
      sessionNameById: params.sessionNameById,
    });
    entries.push({
      id: `wait-${params.teamWaitSummary.updatedAt}`,
      title: params.teamWaitSummary.timedOut ? "等待超时" : "收到结果",
      detail: display.text,
      badgeClassName: display.badgeClassName,
      updatedAt: params.teamWaitSummary.updatedAt,
      targetSessionId:
        params.teamWaitSummary.resolvedSessionId ??
        params.teamWaitSummary.awaitedSessionIds[0],
    });
  }

  if (params.teamControlSummary) {
    const display = buildTeamControlSummaryDisplay({
      summary: params.teamControlSummary,
      sessionNameById: params.sessionNameById,
    });
    const title = (() => {
      switch (params.teamControlSummary.action) {
        case "resume":
          return "继续处理";
        case "close_completed":
          return "收起完成项";
        case "close":
        default:
          return "暂停处理";
      }
    })();

    entries.push({
      id: `control-${params.teamControlSummary.action}-${params.teamControlSummary.updatedAt}`,
      title,
      detail: display.text,
      badgeClassName: display.badgeClassName,
      updatedAt: params.teamControlSummary.updatedAt,
      targetSessionId:
        params.teamControlSummary.affectedSessionIds[0] ??
        params.teamControlSummary.requestedSessionIds[0],
    });
  }

  return entries.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function buildVisibleTeamOperationState(params: {
  railSessions: TeamWorkspaceOperationSessionSnapshot[];
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
}): TeamWorkspaceVisibleOperationState {
  const sessionNameById = new Map(
    params.railSessions.map((session) => [session.id, session.name]),
  );
  const visibleSessionIds = new Set(
    params.railSessions.map((session) => session.id),
  );

  const visibleTeamWaitSummary =
    params.teamWaitSummary &&
    params.teamWaitSummary.awaitedSessionIds.some((sessionId) =>
      sessionNameById.has(sessionId),
    )
      ? params.teamWaitSummary
      : null;

  const visibleTeamControlSummary =
    params.teamControlSummary &&
    [
      ...params.teamControlSummary.requestedSessionIds,
      ...params.teamControlSummary.affectedSessionIds,
    ].some((sessionId) => sessionNameById.has(sessionId))
      ? params.teamControlSummary
      : null;

  return {
    visibleTeamWaitSummary,
    visibleTeamControlSummary,
    entries: buildTeamOperationDisplayEntries({
      sessionNameById,
      teamWaitSummary: visibleTeamWaitSummary,
      teamControlSummary: visibleTeamControlSummary,
    }).filter(
      (entry) =>
        !entry.targetSessionId || visibleSessionIds.has(entry.targetSessionId),
    ),
  };
}
