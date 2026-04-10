import { formatRelativeTime } from "@/lib/api/project";
import type { TeamWorkspaceRuntimeStatus } from "../teamWorkspaceRuntime";
import { resolveTeamWorkspaceDisplayRuntimeStatusLabel } from "../utils/teamWorkspaceCopy";

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
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  parentSessionName?: string | null;
  totalTeamSessions: number;
}) {
  const {
    hasRealTeamGraph,
    isChildSession,
    parentSessionName,
    totalTeamSessions,
  } = params;

  if (isChildSession) {
    return parentSessionName?.trim() || "主助手协作区";
  }
  if (!hasRealTeamGraph) {
    return "需要时会自动加入协作成员";
  }
  return totalTeamSessions > 0
    ? `${totalTeamSessions} 位成员协作中`
    : "创作协作";
}

function buildBoardHint(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  siblingCount: number;
}) {
  const { hasRealTeamGraph, isChildSession, siblingCount } = params;

  if (isChildSession) {
    return siblingCount > 0
      ? `当前正与 ${siblingCount} 位协作成员并行推进`
      : "当前由你和这位协作成员一起推进";
  }
  if (!hasRealTeamGraph) {
    return "系统会在需要时自动邀请协作成员加入，不需要你理解内部分工方式。";
  }
  return "这里只展示谁在帮你处理什么、处理到哪一步，以及接下来会给你什么结果。";
}

export function buildTeamWorkspaceBoardChromeDisplayState(params: {
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
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
    !params.hasRealTeamGraph && params.runtimeFormationTitle
      ? params.runtimeFormationTitle
      : buildBoardHeadline({
          hasRealTeamGraph: params.hasRealTeamGraph,
          isChildSession: params.isChildSession,
          parentSessionName: params.parentSessionName,
          totalTeamSessions: params.totalTeamSessions,
        });
  const boardHint =
    !params.hasRealTeamGraph &&
    params.hasRuntimeFormation &&
    params.runtimeFormationHint
      ? params.runtimeFormationHint
      : buildBoardHint({
          hasRealTeamGraph: params.hasRealTeamGraph,
          isChildSession: params.isChildSession,
          siblingCount: params.siblingCount,
        });
  const compactBoardHeadline =
    params.hasRealTeamGraph &&
    !params.isChildSession &&
    params.totalTeamSessions > 0
      ? `${params.totalTeamSessions} 位成员协作中`
      : boardHeadline;
  const compactToolbarChips: TeamWorkspaceBoardChromeChip[] = [
    {
      key: "focus",
      text: params.selectedSession
        ? `焦点 ${params.selectedSession.name}`
        : "等待成员接入",
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
            text: "当前对话",
            tone: "muted" as const,
          },
        ]
      : []),
    {
      key: "zoom",
      text: `缩放 ${Math.round(params.zoom * 100)}%`,
      tone: "muted",
    },
    ...(params.canWaitAnyActiveTeamSession
      ? [
          {
            key: "waitable",
            text: `${params.waitableCount} 位处理中`,
            tone: "muted" as const,
          },
        ]
      : []),
    ...(params.canCloseCompletedTeamSessions
      ? [
          {
            key: "completed",
            text: `${params.completedCount} 位已完成`,
            tone: "muted" as const,
          },
        ]
      : []),
  ];

  return {
    boardHeadline,
    boardHint,
    compactBoardHeadline,
    compactToolbarChips,
    statusSummaryBadges: Object.entries(params.statusSummary)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => {
        const normalizedStatus =
          status === "idle" ? undefined : (status as TeamWorkspaceRuntimeStatus);

        return {
          key: status,
          text: `${resolveTeamWorkspaceDisplayRuntimeStatusLabel(normalizedStatus)} ${count}`,
          status: normalizedStatus,
        };
      }),
  };
}
