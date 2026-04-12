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
  boardHeaderClassName: TeamWorkspaceBoardShellProps["boardHeaderClassName"];
  boardShellClassName: TeamWorkspaceBoardShellProps["boardShellClassName"];
  canvasSectionProps: TeamWorkspaceBoardShellProps["canvasSectionProps"];
  embedded: boolean;
  headerProps: TeamWorkspaceBoardShellProps["headerProps"];
}

interface BuildTeamWorkspaceBoardHeaderPropsParams {
  boardChromeDisplay: TeamWorkspaceBoardHeaderProps["boardChromeDisplay"];
  createdFromTurnId?: TeamWorkspaceBoardHeaderProps["createdFromTurnId"];
  detailToggleLabel: TeamWorkspaceBoardHeaderProps["detailToggleLabel"];
  detailVisible: TeamWorkspaceBoardHeaderProps["detailVisible"];
  isChildSession: TeamWorkspaceBoardHeaderProps["isChildSession"];
  isEmptyShellState: TeamWorkspaceBoardHeaderProps["isEmptyShellState"];
  onReturnToParentSession?: TeamWorkspaceBoardHeaderProps["onReturnToParentSession"];
  onToggleDetail: TeamWorkspaceBoardHeaderProps["onToggleDetail"];
  resolveStatusMeta: TeamWorkspaceBoardHeaderProps["resolveStatusMeta"];
  runtimeFormationStatusLabel?: TeamWorkspaceBoardHeaderProps["runtimeFormationStatusLabel"];
  totalTeamSessions: TeamWorkspaceBoardHeaderProps["totalTeamSessions"];
  useCompactCanvasChrome: TeamWorkspaceBoardHeaderProps["useCompactCanvasChrome"];
}

interface BuildTeamWorkspaceBoardCanvasSectionPropsParams {
  boardChromeDisplay: TeamWorkspaceBoardOverviewChromeProps["boardChromeDisplay"];
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
  detailCardClassName: TeamWorkspaceBoardFallbackDetailProps["detailCardClassName"];
  detailVisible: TeamWorkspaceBoardHeaderProps["detailVisible"];
  expandedSessionId?: TeamWorkspaceBoardCanvasStageProps["expandedSessionId"];
  formatUpdatedAt: TeamWorkspaceBoardOverviewChromeProps["formatUpdatedAt"];
  hasRuntimeSessions: boolean;
  isCanvasPanModifierActive:
    TeamWorkspaceBoardCanvasStageProps["isCanvasPanModifierActive"];
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
  onWaitAnyActiveTeamSessions:
    TeamWorkspaceBoardOverviewChromeProps["onWaitAnyActiveTeamSessions"];
  onZoomIn: TeamWorkspaceBoardCanvasToolbarProps["onZoomIn"];
  onZoomOut: TeamWorkspaceBoardCanvasToolbarProps["onZoomOut"];
  pendingTeamAction: TeamWorkspaceBoardOverviewChromeProps["pendingTeamAction"];
  railCardClassName: TeamWorkspaceBoardCanvasSectionProps["railCardClassName"];
  resolveStatusMeta: TeamWorkspaceBoardOverviewChromeProps["resolveStatusMeta"];
  runtimeFormationDisplay:
    TeamWorkspaceBoardFallbackDetailProps["runtimeFormationDisplay"];
  selectedInlineDetail?: TeamWorkspaceBoardCanvasStageProps["selectedInlineDetail"];
  selectedSession: TeamWorkspaceBoardOverviewChromeProps["selectedSession"];
  selectedSessionId?: TeamWorkspaceBoardCanvasStageProps["selectedSessionId"];
  selectedTeamPlanDisplay:
    TeamWorkspaceBoardFallbackDetailProps["selectedTeamPlanDisplay"];
  teamOperationEntries:
    TeamWorkspaceBoardOverviewChromeProps["teamOperationEntries"];
  useCompactCanvasChrome: TeamWorkspaceBoardCanvasSectionProps["useCompactCanvasChrome"];
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

export function buildTeamWorkspaceBoardHeaderProps({
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
}: BuildTeamWorkspaceBoardHeaderPropsParams): TeamWorkspaceBoardHeaderProps {
  return {
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
  };
}

export function buildTeamWorkspaceBoardCanvasSectionProps({
  boardChromeDisplay,
  canCloseCompletedTeamSessions,
  canWaitAnyActiveTeamSession,
  completedCount,
  detailCardClassName,
  detailVisible,
  expandedSessionId,
  formatUpdatedAt,
  hasRuntimeSessions,
  canvasBoundsHeight,
  canvasBoundsWidth,
  canvasStageHeight,
  canvasStageHint,
  canvasViewportRef,
  canvasZoom,
  isCanvasPanModifierActive,
  laneLayouts,
  lanes,
  memberCanvasSubtitle,
  memberCanvasTitle,
  onAutoArrangeCanvas,
  onCanvasWheel,
  onCloseCompletedTeamSessions,
  onFitCanvasView,
  onResetCanvasView,
  onSelectCanvasLane,
  onSelectTeamOperationEntry,
  onStartCanvasLaneDrag,
  onStartCanvasLaneResize,
  onStartCanvasPan,
  onWaitAnyActiveTeamSessions,
  onZoomIn,
  onZoomOut,
  pendingTeamAction,
  railCardClassName,
  resolveStatusMeta,
  runtimeFormationDisplay,
  selectedInlineDetail,
  selectedSession,
  selectedSessionId,
  selectedTeamPlanDisplay,
  teamOperationEntries,
  useCompactCanvasChrome,
  viewport,
  waitableCount,
}: BuildTeamWorkspaceBoardCanvasSectionPropsParams): TeamWorkspaceBoardCanvasSectionProps {
  return {
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
    fallbackDetailProps: hasRuntimeSessions
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
  };
}

export function buildTeamWorkspaceBoardShellProps({
  boardBodyClassName,
  boardHeaderClassName,
  boardShellClassName,
  canvasSectionProps,
  embedded,
  headerProps,
}: BuildTeamWorkspaceBoardShellPropsParams): TeamWorkspaceBoardShellProps {
  return {
    boardBodyClassName,
    boardHeaderClassName,
    boardShellClassName,
    canvasSectionProps,
    embedded,
    headerProps,
    style: embedded ? { maxHeight: "inherit" } : undefined,
  };
}
