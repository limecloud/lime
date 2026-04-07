import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { CanvasWorkbenchTeamView } from "../components/CanvasWorkbenchLayout";
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
      subtitle: "主对话保留调度记录，画布按角色分别展示执行过程与结果。",
      autoFocusToken,
      preferFixedPanel: true,
      triggerState,
      renderPreview: (options?: { stackedWorkbenchTrigger?: ReactNode }) =>
        renderTeamWorkbenchPreview(options?.stackedWorkbenchTrigger),
      renderPanel: () => teamWorkbenchSummaryPanel,
    };
  }, [
    autoFocusToken,
    enabled,
    renderTeamWorkbenchPreview,
    dispatchPreviewState,
    surfaceProps.selectedTeamLabel,
    teamWorkbenchSummaryPanel,
    triggerState,
  ]);

  return {
    renderTeamWorkbenchPreview,
    teamWorkbenchView,
  };
}
