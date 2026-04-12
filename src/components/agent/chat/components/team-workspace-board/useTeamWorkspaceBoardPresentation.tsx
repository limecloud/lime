import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { buildTeamWorkspaceBoardChromeDisplayState } from "../../team-workspace-runtime/boardChromeSelectors";
import {
  buildSelectedSessionDetailDisplayState,
  type SelectedSessionDetailDisplayState,
} from "../../team-workspace-runtime/selectedSessionDetailSelectors";
import type { TeamWorkspaceRuntimeFormationDisplayState } from "../../team-workspace-runtime/formationDisplaySelectors";
import type { TeamWorkspaceRuntimeFormationStatus } from "../../teamWorkspaceRuntime";
import {
  buildFallbackSummary,
  resolveStatusMeta,
  type TeamSessionCard,
} from "../../utils/teamWorkspaceSessions";
import { TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT } from "../../utils/teamWorkspaceCanvas";

interface UseTeamWorkspaceBoardPresentationParams {
  canCloseCompletedTeamSessions: boolean;
  canWaitAnyActiveTeamSession: boolean;
  className?: string;
  completedCount: number;
  detailExpanded: boolean;
  dispatchPreviewStatus?: TeamWorkspaceRuntimeFormationStatus | null;
  embedded: boolean;
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
  isChildSession: boolean;
  isEmptyShellState: boolean;
  parentSessionName?: string | null;
  selectedSession: TeamSessionCard | null;
  shellExpanded: boolean;
  siblingCount: number;
  statusSummary: Record<string, number>;
  totalTeamSessions: number;
  visibleSessionsCount: number;
  waitableCount: number;
  zoom: number;
  runtimeFormationDisplay: TeamWorkspaceRuntimeFormationDisplayState;
}

interface TeamWorkspaceBoardPresentationState {
  boardBodyClassName: string;
  boardChromeDisplay: ReturnType<typeof buildTeamWorkspaceBoardChromeDisplayState>;
  boardHeaderClassName: string;
  boardShellClassName: string;
  canvasStageHeight: string;
  detailCardClassName: string;
  detailSummary: string;
  detailToggleLabel: string;
  detailVisible: boolean;
  inlineDetailSectionClassName: string;
  inlineTimelineEntryClassName: string;
  inlineTimelineFeedClassName: string;
  memberCanvasSubtitle: string;
  memberCanvasTitle: string;
  railCardClassName: string;
  selectedSessionDetailDisplay: SelectedSessionDetailDisplayState;
  useCompactCanvasChrome: boolean;
}

export function useTeamWorkspaceBoardPresentation({
  canCloseCompletedTeamSessions,
  canWaitAnyActiveTeamSession,
  className,
  completedCount,
  detailExpanded,
  dispatchPreviewStatus = null,
  embedded,
  hasRealTeamGraph,
  hasRuntimeFormation,
  isChildSession,
  isEmptyShellState,
  parentSessionName,
  selectedSession,
  shellExpanded,
  siblingCount,
  statusSummary,
  totalTeamSessions,
  visibleSessionsCount,
  waitableCount,
  zoom,
  runtimeFormationDisplay,
}: UseTeamWorkspaceBoardPresentationParams): TeamWorkspaceBoardPresentationState {
  const useCompactCanvasChrome = hasRealTeamGraph;
  const detailVisible =
    isEmptyShellState || !hasRealTeamGraph
      ? detailExpanded || shellExpanded
      : false;
  const detailToggleLabel = detailVisible ? "收起细节" : "查看细节";
  const memberCanvasTitle = "协作进展画布";
  const memberCanvasSubtitle = hasRealTeamGraph
    ? isChildSession
      ? "当前协作成员会在各自面板里持续更新进展和结果，主对话只保留必要摘要。"
      : `${visibleSessionsCount} 位协作成员已加入，每位成员都会在自己的面板里持续更新进展和结果。`
    : dispatchPreviewStatus === "forming"
      ? "正在准备当前任务分工，成员接入后会在这里独立更新进展。"
      : dispatchPreviewStatus === "formed"
        ? "当前任务分工已经就绪，成员接入后会在各自面板里开始处理。"
        : dispatchPreviewStatus === "failed"
          ? "这次任务分工准备失败，暂时无法生成成员面板。"
          : "成员加入后，这里会展开为独立的任务进行时面板。";

  const boardChromeDisplay = useMemo(
    () =>
      buildTeamWorkspaceBoardChromeDisplayState({
        hasRealTeamGraph,
        hasRuntimeFormation,
        runtimeFormationTitle: hasRuntimeFormation
          ? runtimeFormationDisplay.panelHeadline
          : null,
        runtimeFormationHint: runtimeFormationDisplay.hint,
        isChildSession,
        parentSessionName,
        totalTeamSessions,
        siblingCount,
        selectedSession,
        zoom,
        canWaitAnyActiveTeamSession,
        waitableCount,
        canCloseCompletedTeamSessions,
        completedCount,
        statusSummary,
      }),
    [
      canCloseCompletedTeamSessions,
      canWaitAnyActiveTeamSession,
      completedCount,
      hasRealTeamGraph,
      hasRuntimeFormation,
      isChildSession,
      parentSessionName,
      runtimeFormationDisplay.hint,
      runtimeFormationDisplay.panelHeadline,
      selectedSession,
      siblingCount,
      statusSummary,
      totalTeamSessions,
      waitableCount,
      zoom,
    ],
  );

  const detailSummary =
    selectedSession?.taskSummary ||
    buildFallbackSummary({
      hasRealTeamGraph,
      isChildSession,
      selectedSession,
    });
  const selectedSessionDetailDisplay = useMemo(
    () =>
      buildSelectedSessionDetailDisplayState({
        selectedSession,
        isChildSession,
        parentSessionName,
      }),
    [isChildSession, parentSessionName, selectedSession],
  );
  const selectedStatusMeta = resolveStatusMeta(selectedSession?.runtimeStatus);
  const boardShellClassName = cn(
    embedded
      ? "pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none"
      : "overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-42px_rgba(15,23,42,0.24)]",
    embedded ? "mx-0 mt-0" : "mx-3 mt-2",
    className,
  );
  const boardHeaderClassName = cn(
    "flex flex-wrap items-start justify-between gap-3",
    useCompactCanvasChrome ? "px-4 py-2.5 sm:px-4" : "px-4 py-3.5 sm:px-5",
    embedded
      ? cn(
          "sticky top-0 z-20 border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        )
      : cn(
          "border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        ),
  );
  const boardBodyClassName = embedded
    ? cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        useCompactCanvasChrome
          ? "space-y-2.5 p-3 sm:p-3.5"
          : "space-y-3 p-3 sm:p-4",
      )
    : cn(useCompactCanvasChrome ? "p-3 sm:p-3.5" : "p-3 sm:p-4");
  const canvasStageHeight =
    embedded && !detailVisible
      ? "clamp(560px, 76vh, 980px)"
      : TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT;
  const railCardClassName = embedded
    ? cn(
        "pointer-events-auto",
        useCompactCanvasChrome ? "space-y-3" : "space-y-4",
      )
    : "rounded-[22px] border border-slate-200 bg-slate-50 p-3.5 shadow-sm shadow-slate-950/5";
  const detailCardClassName = cn(
    embedded
      ? "rounded-[20px] border border-slate-200 bg-white p-4"
      : "rounded-[22px] border p-4 shadow-sm shadow-slate-950/5",
    !embedded &&
      (selectedSession
        ? selectedStatusMeta.cardClassName
        : "border-slate-200 bg-white"),
  );

  return {
    boardBodyClassName,
    boardChromeDisplay,
    boardHeaderClassName,
    boardShellClassName,
    canvasStageHeight,
    detailCardClassName,
    detailSummary,
    detailToggleLabel,
    detailVisible,
    inlineDetailSectionClassName:
      "mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3",
    inlineTimelineEntryClassName:
      "rounded-[14px] border border-slate-200 bg-white p-3",
    inlineTimelineFeedClassName:
      "mt-3 rounded-[16px] border border-slate-200 bg-white p-3",
    memberCanvasSubtitle,
    memberCanvasTitle,
    railCardClassName,
    selectedSessionDetailDisplay,
    useCompactCanvasChrome,
  };
}
