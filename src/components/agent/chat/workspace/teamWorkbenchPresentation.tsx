import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import type {
  CanvasWorkbenchHeaderBadge,
  CanvasWorkbenchSummaryStat,
  CanvasWorkbenchTeamView,
} from "../components/CanvasWorkbenchLayout";
import { TeamWorkbenchSummaryPanel } from "../components/TeamWorkbenchSummaryPanel";
import { TeamWorkspaceBoard } from "../components/TeamWorkspaceBoard";
import {
  summarizeTeamWorkspaceExecution,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import { wrapPreviewWithWorkbenchTrigger } from "./workbenchPreviewHelpers";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";

export type TeamWorkbenchSurfaceProps = Omit<
  ComponentProps<typeof TeamWorkspaceBoard>,
  "className" | "embedded" | "defaultShellExpanded"
>;

interface UseTeamWorkbenchPresentationParams {
  enabled: boolean;
  surfaceProps: TeamWorkbenchSurfaceProps;
  hasRealTeamGraph: boolean;
  autoFocusToken?: string | number | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  teamMemorySnapshot?: TeamMemorySnapshot | null;
}

function resolveTeamWorkbenchTriggerState(params: {
  enabled: boolean;
  hasRealTeamGraph: boolean;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  executionSummary: ReturnType<typeof summarizeTeamWorkspaceExecution>;
}): CanvasWorkbenchTeamView["triggerState"] {
  const dispatchPreviewState = params.teamDispatchPreviewState;
  if (!params.enabled) {
    return null;
  }

  if (dispatchPreviewState?.status === "failed") {
    return { tone: "error", label: "失败" };
  }

  if (dispatchPreviewState?.status === "forming") {
    return { tone: "active", label: "组建中" };
  }

  if (params.executionSummary.runningSessionCount > 0) {
    return {
      tone: "active",
      label:
        params.executionSummary.runningSessionCount > 1
          ? `${params.executionSummary.runningSessionCount} 处理中`
          : "处理中",
    };
  }

  if (params.executionSummary.queuedSessionCount > 0) {
    return {
      tone: "active",
      label:
        params.executionSummary.queuedSessionCount > 1
          ? `${params.executionSummary.queuedSessionCount} 稍后开始`
          : "稍后开始",
    };
  }

  if (dispatchPreviewState?.status === "formed" && !params.hasRealTeamGraph) {
    return { tone: "active", label: "已就绪" };
  }

  if (
    Object.values(params.liveActivityBySessionId ?? {}).some(
      (entries) => (entries?.length ?? 0) > 0,
    ) ||
    Boolean(params.teamWaitSummary) ||
    Boolean(params.teamControlSummary)
  ) {
    return { tone: "active", label: "有更新" };
  }

  return { tone: "idle", label: null };
}

export function useTeamWorkbenchPresentation({
  enabled,
  surfaceProps,
  hasRealTeamGraph,
  autoFocusToken,
  teamDispatchPreviewState = null,
  liveActivityBySessionId = {},
  teamWaitSummary = null,
  teamControlSummary = null,
  teamMemorySnapshot = null,
}: UseTeamWorkbenchPresentationParams) {
  const dispatchPreviewState = teamDispatchPreviewState;
  const boardProps = useMemo<ComponentProps<typeof TeamWorkspaceBoard>>(
    () => ({
      ...surfaceProps,
      embedded: true,
      defaultShellExpanded: true,
    }),
    [surfaceProps],
  );

  const renderTeamWorkbenchPreview = useCallback(
    (stackedWorkbenchTrigger?: ReactNode) =>
      wrapPreviewWithWorkbenchTrigger(
        <div className="flex h-full min-h-0 flex-col overflow-hidden pt-4">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <TeamWorkspaceBoard {...boardProps} />
          </div>
        </div>,
        stackedWorkbenchTrigger,
      ),
    [boardProps],
  );

  const summaryPanelProps = useMemo<
    ComponentProps<typeof TeamWorkbenchSummaryPanel>
  >(
    () => ({
      currentSessionId: surfaceProps.currentSessionId,
      currentSessionRuntimeStatus: surfaceProps.currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus:
        surfaceProps.currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount: surfaceProps.currentSessionQueuedTurnCount,
      childSubagentSessions: surfaceProps.childSubagentSessions,
      subagentParentContext: surfaceProps.subagentParentContext,
      liveRuntimeBySessionId: surfaceProps.liveRuntimeBySessionId,
      liveActivityBySessionId,
      teamWaitSummary,
      teamControlSummary,
      selectedTeamLabel: surfaceProps.selectedTeamLabel,
      selectedTeamSummary: surfaceProps.selectedTeamSummary,
      selectedTeamRoles: surfaceProps.selectedTeamRoles,
      teamDispatchPreviewState: surfaceProps.teamDispatchPreviewState,
      teamMemorySnapshot,
    }),
    [
      liveActivityBySessionId,
      surfaceProps,
      teamControlSummary,
      teamMemorySnapshot,
      teamWaitSummary,
    ],
  );

  const teamWorkbenchSummaryPanel = useMemo(
    () => <TeamWorkbenchSummaryPanel {...summaryPanelProps} />,
    [summaryPanelProps],
  );

  const executionSummary = useMemo(
    () =>
      summarizeTeamWorkspaceExecution({
        currentSessionId: surfaceProps.currentSessionId,
        currentSessionRuntimeStatus: surfaceProps.currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus:
          surfaceProps.currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount:
          surfaceProps.currentSessionQueuedTurnCount,
        childSubagentSessions: surfaceProps.childSubagentSessions,
        subagentParentContext: surfaceProps.subagentParentContext,
        liveRuntimeBySessionId: surfaceProps.liveRuntimeBySessionId as
          | Record<string, TeamWorkspaceLiveRuntimeState>
          | undefined,
      }),
    [surfaceProps],
  );

  const triggerState = useMemo(
    () =>
      resolveTeamWorkbenchTriggerState({
        enabled,
        hasRealTeamGraph,
        teamDispatchPreviewState,
        liveActivityBySessionId,
        teamWaitSummary,
        teamControlSummary,
        executionSummary,
      }),
    [
      enabled,
      executionSummary,
      hasRealTeamGraph,
      liveActivityBySessionId,
      teamDispatchPreviewState,
      teamControlSummary,
      teamWaitSummary,
    ],
  );

  const headerBadges = useMemo<CanvasWorkbenchHeaderBadge[]>(() => {
    const badges: CanvasWorkbenchHeaderBadge[] = [
      {
        key: "team-runtime",
        label: "Team Workbench",
        tone: "accent",
      },
    ];

    if (triggerState?.label?.trim()) {
      badges.push({
        key: "team-trigger-state",
        label: triggerState.label.trim(),
        tone: triggerState.tone === "active" ? "accent" : "default",
      });
    }

    if (teamWaitSummary?.awaitedSessionIds?.length) {
      badges.push({
        key: "team-awaiting",
        label: `等待 ${teamWaitSummary.awaitedSessionIds.length}`,
        tone: "default",
      });
    }

    return badges;
  }, [teamWaitSummary?.awaitedSessionIds, triggerState]);

  const summaryStats = useMemo<CanvasWorkbenchSummaryStat[]>(() => {
    const leadStatus =
      triggerState?.label?.trim() || executionSummary.statusTitle || "待机";
    const leadDetail =
      executionSummary.statusTitle || "当前没有活跃的协作执行。";

    const stats: CanvasWorkbenchSummaryStat[] = [
      {
        key: "team-status",
        label: "协作状态",
        value: leadStatus,
        detail: leadDetail,
        tone: triggerState?.tone === "active" ? "accent" : "default",
      },
      {
        key: "team-members",
        label: "活跃成员",
        value:
          executionSummary.totalSessionCount > 0
            ? `${executionSummary.activeSessionCount}/${executionSummary.totalSessionCount}`
            : "0",
        detail:
          executionSummary.totalSessionCount > 0
            ? `${executionSummary.runningSessionCount} 位处理中，${executionSummary.queuedSessionCount} 位排队中。`
            : "当前还没有可展示的协作成员。",
        tone: executionSummary.activeSessionCount > 0 ? "accent" : "default",
      },
    ];

    if (teamWaitSummary?.awaitedSessionIds?.length) {
      stats.push({
        key: "team-awaiting",
        label: "等待确认",
        value: `${teamWaitSummary.awaitedSessionIds.length} 项`,
        detail: teamWaitSummary.timedOut
          ? "等待结果超时，建议重新检查成员状态。"
          : "正在等待成员完成或返回结果。",
        tone: "default",
      });
    } else if (teamControlSummary?.affectedSessionIds?.length) {
      stats.push({
        key: "team-control",
        label: "最近控制",
        value:
          teamControlSummary.action === "resume"
            ? "恢复执行"
            : teamControlSummary.action === "close_completed"
              ? "清理已完成"
              : "关闭协作",
        detail: `影响 ${teamControlSummary.affectedSessionIds.length} 个会话。`,
        tone: "default",
      });
    }

    return stats;
  }, [executionSummary, teamControlSummary, teamWaitSummary, triggerState]);

  const teamWorkbenchView = useMemo<CanvasWorkbenchTeamView | null>(() => {
    if (!enabled) {
      return null;
    }

    return {
      enabled: true,
      title:
        dispatchPreviewState?.label?.trim() ||
        dispatchPreviewState?.blueprint?.label?.trim() ||
        surfaceProps.selectedTeamLabel ||
        "团队工作台",
      tabLabel: surfaceProps.selectedTeamLabel?.trim() || undefined,
      tabBadge: triggerState?.label?.trim() || undefined,
      tabBadgeTone:
        triggerState?.tone === "error"
          ? "rose"
          : triggerState?.tone === "active"
            ? "sky"
            : "slate",
      subtitle: "主对话保留调度记录，画布按角色分别展示执行过程与结果。",
      autoFocusToken,
      preferFixedPanel: true,
      triggerState,
      badges: headerBadges,
      summaryStats,
      panelCopy: {
        emptyText: "当前没有可展示的 Team Workbench。",
      },
      renderPreview: (options?: { stackedWorkbenchTrigger?: ReactNode }) =>
        renderTeamWorkbenchPreview(options?.stackedWorkbenchTrigger),
      renderPanel: () => teamWorkbenchSummaryPanel,
    };
  }, [
    autoFocusToken,
    enabled,
    renderTeamWorkbenchPreview,
    dispatchPreviewState,
    headerBadges,
    summaryStats,
    surfaceProps.selectedTeamLabel,
    teamWorkbenchSummaryPanel,
    triggerState,
  ]);

  return {
    renderTeamWorkbenchPreview,
    teamWorkbenchView,
  };
}
