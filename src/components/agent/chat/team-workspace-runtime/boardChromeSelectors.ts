import { formatRelativeTime } from "@/lib/api/project";
import type { TeamWorkspaceRuntimeStatus } from "../teamWorkspaceRuntime";
import {
  TEAM_WORKSPACE_SURFACE_TITLE,
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
} from "../utils/teamWorkspaceCopy";

export interface TeamWorkspaceBoardChromeSession {
  name: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  updatedAt?: number;
  isCurrent?: boolean;
}

export interface TeamWorkspaceBoardChromeChip {
  key: string;
  text: string;
  tone: "summary" | "muted" | "status";
  status?: TeamWorkspaceRuntimeStatus;
}

export interface TeamWorkspaceBoardStatusSummaryBadge {
  key: string;
  text: string;
  status?: TeamWorkspaceRuntimeStatus;
}

export interface TeamWorkspaceBoardChromeDisplayState {
  boardHeadline: string;
  boardHint: string;
  compactBoardHeadline: string;
  compactToolbarChips: TeamWorkspaceBoardChromeChip[];
  statusSummaryBadges: TeamWorkspaceBoardStatusSummaryBadge[];
}

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt * 1000);
}

function buildBoardHeadline(params: {
  hasRuntimeSessions: boolean;
  isChildSession: boolean;
  parentSessionName?: string | null;
  statusSummary: Record<string, number>;
  totalTeamSessions: number;
}) {
  const {
    hasRuntimeSessions,
    isChildSession,
    parentSessionName,
    statusSummary,
    totalTeamSessions,
  } = params;
  const runningCount = statusSummary.running ?? 0;
  const queuedCount = statusSummary.queued ?? 0;
  const completedCount = statusSummary.completed ?? 0;
  const retryCount =
    (statusSummary.failed ?? 0) + (statusSummary.aborted ?? 0);

  if (isChildSession) {
    return parentSessionName?.trim() || "主任务总览";
  }
  if (!hasRuntimeSessions) {
    return "需要时会自动拆出任务";
  }
  if (runningCount > 0) {
    if (queuedCount > 0) {
      return `任务进行中 · ${runningCount} 项处理中 / ${queuedCount} 项稍后开始`;
    }
    return totalTeamSessions > 1
      ? `任务进行中 · ${runningCount} 项处理中`
      : "任务进行中";
  }
  if (queuedCount > 0) {
    return totalTeamSessions > 1
      ? `任务准备中 · ${queuedCount} 项稍后开始`
      : "任务准备中";
  }
  if (completedCount > 0 && completedCount === totalTeamSessions) {
    return totalTeamSessions > 1
      ? `${completedCount} 项任务已完成`
      : "任务已完成";
  }
  if (retryCount > 0 && retryCount === totalTeamSessions) {
    return totalTeamSessions > 1
      ? `${retryCount} 项任务需重试`
      : "任务需重试";
  }
  return totalTeamSessions > 0
    ? `${totalTeamSessions} 条当前进展已接入`
    : TEAM_WORKSPACE_SURFACE_TITLE;
}

function buildBoardHint(params: {
  hasRuntimeSessions: boolean;
  isChildSession: boolean;
  siblingCount: number;
}) {
  const { hasRuntimeSessions, isChildSession, siblingCount } = params;

  if (isChildSession) {
    return siblingCount > 0
      ? `当前任务正与 ${siblingCount} 项并行子任务一起推进`
      : "当前正在处理这项子任务，结果会回流到主任务。";
  }
  if (!hasRuntimeSessions) {
    return "系统会在需要时自动拆出任务、安排处理顺序，并把结果回流到当前任务。";
  }
  return "这里只展示当前有哪些分工在处理、状态如何，以及最近更新到了哪里。";
}

export function buildTeamWorkspaceBoardChromeDisplayState(params: {
  hasRuntimeSessions: boolean;
  runtimeFormationTitle?: string | null;
  runtimeFormationHint?: string | null;
  isChildSession: boolean;
  parentSessionName?: string | null;
  totalTeamSessions: number;
  siblingCount: number;
  selectedSession?: TeamWorkspaceBoardChromeSession | null;
  zoom: number;
  canWaitAnyActiveTeamSession: boolean;
  waitableCount: number;
  canCloseCompletedTeamSessions: boolean;
  completedCount: number;
  statusSummary: Record<string, number>;
}): TeamWorkspaceBoardChromeDisplayState {
  const boardHeadline =
    !params.hasRuntimeSessions && params.runtimeFormationTitle
      ? params.runtimeFormationTitle
      : buildBoardHeadline({
          hasRuntimeSessions: params.hasRuntimeSessions,
          isChildSession: params.isChildSession,
          parentSessionName: params.parentSessionName,
          statusSummary: params.statusSummary,
          totalTeamSessions: params.totalTeamSessions,
        });
  const boardHint =
    !params.hasRuntimeSessions && params.runtimeFormationHint
      ? params.runtimeFormationHint
      : buildBoardHint({
          hasRuntimeSessions: params.hasRuntimeSessions,
          isChildSession: params.isChildSession,
          siblingCount: params.siblingCount,
        });
  const compactToolbarChips: TeamWorkspaceBoardChromeChip[] = [
    {
      key: "focus",
      text: params.selectedSession
        ? `当前焦点 ${params.selectedSession.name}`
        : "等待任务接手",
      tone: "summary",
    },
    ...(params.selectedSession?.runtimeStatus
      ? [
          {
            key: "status",
            text: resolveTeamWorkspaceDisplayRuntimeStatusLabel(
              params.selectedSession.runtimeStatus,
            ),
            tone: "status" as const,
            status: params.selectedSession.runtimeStatus,
          },
        ]
      : []),
    ...(params.selectedSession
      ? [
          {
            key: "updated-at",
            text: `更新于 ${formatUpdatedAt(params.selectedSession.updatedAt)}`,
            tone: "muted" as const,
          },
        ]
      : []),
    ...(params.selectedSession?.isCurrent
      ? [
          {
            key: "current",
            text: "当前任务",
            tone: "muted" as const,
          },
        ]
      : []),
    ...(params.canWaitAnyActiveTeamSession
      ? [
          {
            key: "waitable",
            text: `${params.waitableCount} 项处理中`,
            tone: "muted" as const,
          },
        ]
      : []),
    ...(params.canCloseCompletedTeamSessions
      ? [
          {
            key: "completed",
            text: `${params.completedCount} 项已完成`,
            tone: "muted" as const,
          },
        ]
      : []),
  ];

  return {
    boardHeadline,
    boardHint,
    compactBoardHeadline: boardHeadline,
    compactToolbarChips,
    statusSummaryBadges: Object.entries(params.statusSummary)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => {
        const normalizedStatus =
          status === "idle"
            ? undefined
            : (status as TeamWorkspaceRuntimeStatus);

        return {
          key: status,
          text: `${resolveTeamWorkspaceDisplayRuntimeStatusLabel(normalizedStatus)} ${count}`,
          status: normalizedStatus,
        };
      }),
  };
}
