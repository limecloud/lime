import type { ComponentProps } from "react";
import { TeamWorkspaceBoardShell } from "./TeamWorkspaceBoardShell";
import { TeamWorkspaceEmptyShellState } from "./TeamWorkspaceEmptyShellState";

type TeamWorkspaceEmptyShellProps = ComponentProps<
  typeof TeamWorkspaceEmptyShellState
>;
type TeamWorkspaceBoardShellProps = ComponentProps<typeof TeamWorkspaceBoardShell>;
type TeamWorkspaceBoardHeaderProps = TeamWorkspaceBoardShellProps["headerProps"];
type TeamWorkspaceBoardCanvasSectionProps =
  TeamWorkspaceBoardShellProps["canvasSectionProps"];
type TeamWorkspaceBoardCanvasStageProps =
  TeamWorkspaceBoardCanvasSectionProps["canvasStageProps"];
type TeamWorkspaceBoardCanvasToolbarProps =
  TeamWorkspaceBoardCanvasSectionProps["canvasToolbarProps"];
type TeamWorkspaceBoardOverviewChromeProps =
  TeamWorkspaceBoardCanvasSectionProps["overviewChromeProps"];
type TeamWorkspaceBoardFallbackDetailProps = NonNullable<
  TeamWorkspaceBoardCanvasSectionProps["fallbackDetailProps"]
>;

interface BuildTeamWorkspaceBoardEmptyShellPropsParams {
  className?: string;
  embedded: boolean;
  hasRuntimeFormation: boolean;
  onExpand: NonNullable<TeamWorkspaceEmptyShellProps["onExpand"]>;
  runtimeFormationDisplay: TeamWorkspaceEmptyShellProps["runtimeFormationDisplay"];
  selectedTeamPlanDisplay: TeamWorkspaceEmptyShellProps["selectedTeamPlanDisplay"];
}

interface BuildTeamWorkspaceBoardShellPropsParams {
  boardBodyClassName: TeamWorkspaceBoardShellProps["boardBodyClassName"];
  boardChromeDisplay: TeamWorkspaceBoardHeaderProps["boardChromeDisplay"];
  boardHeaderClassName: TeamWorkspaceBoardShellProps["boardHeaderClassName"];
  boardShellClassName: TeamWorkspaceBoardShellProps["boardShellClassName"];
  canvasBoundsHeight: TeamWorkspaceBoardCanvasStageProps["canvasBoundsHeight"];
  canvasBoundsWidth: TeamWorkspaceBoardCanvasStageProps["canvasBoundsWidth"];
  canvasStageHeight: TeamWorkspaceBoardCanvasStageProps["canvasStageHeight"];
  canvasStageHint: TeamWorkspaceBoardCanvasStageProps["canvasStageHint"];
  canvasViewportRef: TeamWorkspaceBoardCanvasStageProps["viewportRef"];
  canvasZoom: TeamWorkspaceBoardCanvasToolbarProps["zoom"];
  canCloseCompletedTeamSessions:
    TeamWorkspaceBoardOverviewChromeProps["canCloseCompletedTeamSessions"];
  canWaitAnyActiveTeamSession:
    TeamWorkspaceBoardOverviewChromeProps["canWaitAnyActiveTeamSession"];
  completedCount: TeamWorkspaceBoardOverviewChromeProps["completedCount"];
  createdFromTurnId?: TeamWorkspaceBoardHeaderProps["createdFromTurnId"];
  detailCardClassName: TeamWorkspaceBoardFallbackDetailProps["detailCardClassName"];
  detailToggleLabel: TeamWorkspaceBoardHeaderProps["detailToggleLabel"];
  detailVisible: TeamWorkspaceBoardHeaderProps["detailVisible"];
  embedded: boolean;
  expandedSessionId?: TeamWorkspaceBoardCanvasStageProps["expandedSessionId"];
  formatUpdatedAt: TeamWorkspaceBoardOverviewChromeProps["formatUpdatedAt"];
  hasRealTeamGraph: boolean;
  isCanvasPanModifierActive:
    TeamWorkspaceBoardCanvasStageProps["isCanvasPanModifierActive"];
  isChildSession: TeamWorkspaceBoardHeaderProps["isChildSession"];
  isEmptyShellState: TeamWorkspaceBoardHeaderProps["isEmptyShellState"];
  laneLayouts: TeamWorkspaceBoardCanvasStageProps["laneLayouts"];
  lanes: TeamWorkspaceBoardCanvasStageProps["lanes"];
  memberCanvasSubtitle: TeamWorkspaceBoardOverviewChromeProps["memberCanvasSubtitle"];
  memberCanvasTitle: TeamWorkspaceBoardOverviewChromeProps["memberCanvasTitle"];
  onAutoArrangeCanvas:
    TeamWorkspaceBoardCanvasToolbarProps["onAutoArrangeCanvas"];
  onCanvasWheel: TeamWorkspaceBoardCanvasStageProps["onCanvasWheel"];
  onCloseCompletedTeamSessions:
    TeamWorkspaceBoardOverviewChromeProps["onCloseCompletedTeamSessions"];
  onFitCanvasView: TeamWorkspaceBoardCanvasToolbarProps["onFitCanvasView"];
  onReturnToParentSession?: TeamWorkspaceBoardHeaderProps["onReturnToParentSession"];
  onResetCanvasView: TeamWorkspaceBoardCanvasToolbarProps["onResetCanvasView"];
  onSelectCanvasLane: TeamWorkspaceBoardCanvasStageProps["onSelectLane"];
  onSelectTeamOperationEntry:
    TeamWorkspaceBoardOverviewChromeProps["onSelectTeamOperationEntry"];
  onStartCanvasLaneDrag: (
    persistKey: string,
    event: Parameters<TeamWorkspaceBoardCanvasStageProps["onStartCanvasLaneDrag"]>[1],
  ) => void;
  onStartCanvasLaneResize: (
    persistKey: string,
    direction: Parameters<
      TeamWorkspaceBoardCanvasStageProps["onStartCanvasLaneResize"]
    >[1],
    event: Parameters<
      TeamWorkspaceBoardCanvasStageProps["onStartCanvasLaneResize"]
    >[2],
  ) => void;
  onStartCanvasPan: TeamWorkspaceBoardCanvasStageProps["onStartCanvasPan"];
  onToggleDetail: TeamWorkspaceBoardHeaderProps["onToggleDetail"];
  onWaitAnyActiveTeamSessions:
    TeamWorkspaceBoardOverviewChromeProps["onWaitAnyActiveTeamSessions"];
  onZoomIn: TeamWorkspaceBoardCanvasToolbarProps["onZoomIn"];
  onZoomOut: TeamWorkspaceBoardCanvasToolbarProps["onZoomOut"];
  pendingTeamAction: TeamWorkspaceBoardOverviewChromeProps["pendingTeamAction"];
  railCardClassName: TeamWorkspaceBoardCanvasSectionProps["railCardClassName"];
  resolveStatusMeta: TeamWorkspaceBoardHeaderProps["resolveStatusMeta"];
  runtimeFormationStatusLabel?: TeamWorkspaceBoardHeaderProps["runtimeFormationStatusLabel"];
  runtimeFormationDisplay:
    TeamWorkspaceBoardFallbackDetailProps["runtimeFormationDisplay"];
  selectedInlineDetail?: TeamWorkspaceBoardCanvasStageProps["selectedInlineDetail"];
  selectedSession: TeamWorkspaceBoardOverviewChromeProps["selectedSession"];
  selectedSessionId?: TeamWorkspaceBoardCanvasStageProps["selectedSessionId"];
  selectedTeamPlanDisplay:
    TeamWorkspaceBoardFallbackDetailProps["selectedTeamPlanDisplay"];
  teamOperationEntries:
    TeamWorkspaceBoardOverviewChromeProps["teamOperationEntries"];
  totalTeamSessions: TeamWorkspaceBoardHeaderProps["totalTeamSessions"];
  useCompactCanvasChrome: TeamWorkspaceBoardHeaderProps["useCompactCanvasChrome"];
  viewport: TeamWorkspaceBoardCanvasStageProps["viewport"];
  waitableCount: TeamWorkspaceBoardOverviewChromeProps["waitableCount"];
}

export function buildTeamWorkspaceBoardEmptyShellProps({
  className,
  embedded,
  hasRuntimeFormation,
  onExpand,
  runtimeFormationDisplay,
  selectedTeamPlanDisplay,
}: BuildTeamWorkspaceBoardEmptyShellPropsParams): TeamWorkspaceEmptyShellProps {
  return {
    className,
    embedded,
    hasRuntimeFormation,
    onExpand,
    runtimeFormationDisplay,
    selectedTeamPlanDisplay,
  };
}

export function buildTeamWorkspaceBoardShellProps({
  boardBodyClassName,
  boardChromeDisplay,
  boardHeaderClassName,
  boardShellClassName,
  canvasBoundsHeight,
  canvasBoundsWidth,
  canvasStageHeight,
  canvasStageHint,
  canvasViewportRef,
  canvasZoom,
  canCloseCompletedTeamSessions,
  canWaitAnyActiveTeamSession,
  completedCount,
  createdFromTurnId,
  detailCardClassName,
  detailToggleLabel,
  detailVisible,
  embedded,
  expandedSessionId,
  formatUpdatedAt,
  hasRealTeamGraph,
  isCanvasPanModifierActive,
  isChildSession,
  isEmptyShellState,
  laneLayouts,
  lanes,
  memberCanvasSubtitle,
  memberCanvasTitle,
  onAutoArrangeCanvas,
  onCanvasWheel,
  onCloseCompletedTeamSessions,
  onFitCanvasView,
  onReturnToParentSession,
  onResetCanvasView,
  onSelectCanvasLane,
  onSelectTeamOperationEntry,
  onStartCanvasLaneDrag,
  onStartCanvasLaneResize,
  onStartCanvasPan,
  onToggleDetail,
  onWaitAnyActiveTeamSessions,
  onZoomIn,
  onZoomOut,
  pendingTeamAction,
  railCardClassName,
  resolveStatusMeta,
  runtimeFormationStatusLabel,
  runtimeFormationDisplay,
  selectedInlineDetail,
  selectedSession,
  selectedSessionId,
  selectedTeamPlanDisplay,
  teamOperationEntries,
  totalTeamSessions,
  useCompactCanvasChrome,
  viewport,
  waitableCount,
}: BuildTeamWorkspaceBoardShellPropsParams): TeamWorkspaceBoardShellProps {
  return {
    boardBodyClassName,
    boardHeaderClassName,
    boardShellClassName,
    canvasSectionProps: {
      canvasStageProps: {
        canvasBoundsHeight,
        canvasBoundsWidth,
        canvasStageHeight,
        canvasStageHint,
        expandedSessionId,
        isCanvasPanModifierActive,
        laneLayouts,
        lanes,
        onCanvasWheel,
        onSelectLane: onSelectCanvasLane,
        onStartCanvasLaneDrag: (lane, event) =>
          onStartCanvasLaneDrag(lane.persistKey, event),
        onStartCanvasLaneResize: (lane, direction, event) =>
          onStartCanvasLaneResize(lane.persistKey, direction, event),
        onStartCanvasPan,
        selectedInlineDetail,
        selectedSessionId,
        viewport,
        viewportRef: canvasViewportRef,
      },
      canvasToolbarProps: {
        laneCount: lanes.length,
        onAutoArrangeCanvas,
        onFitCanvasView,
        onResetCanvasView,
        onZoomIn,
        onZoomOut,
        zoom: canvasZoom,
      },
      fallbackDetailProps: hasRealTeamGraph
        ? null
        : {
            detailCardClassName,
            detailVisible,
            runtimeFormationDisplay,
            selectedTeamPlanDisplay,
          },
      overviewChromeProps: {
        boardChromeDisplay,
        canCloseCompletedTeamSessions,
        canWaitAnyActiveTeamSession,
        completedCount,
        formatUpdatedAt,
        memberCanvasSubtitle,
        memberCanvasTitle,
        onAutoArrangeCanvas,
        onCloseCompletedTeamSessions,
        onFitCanvasView,
        onSelectTeamOperationEntry,
        onWaitAnyActiveTeamSessions,
        onZoomIn,
        onZoomOut,
        pendingTeamAction,
        resolveStatusMeta,
        selectedSession,
        teamOperationEntries,
        waitableCount,
      },
      railCardClassName,
      useCompactCanvasChrome,
    },
    embedded,
    headerProps: {
      boardChromeDisplay,
      createdFromTurnId,
      detailToggleLabel,
      detailVisible,
      isChildSession,
      isEmptyShellState,
      onReturnToParentSession,
      onToggleDetail,
      resolveStatusMeta,
      runtimeFormationStatusLabel,
      totalTeamSessions,
      useCompactCanvasChrome,
    },
    style: embedded ? { maxHeight: "inherit" } : undefined,
  };
}
