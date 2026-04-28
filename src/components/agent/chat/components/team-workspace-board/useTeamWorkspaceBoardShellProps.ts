import type { AsterSubagentParentContext } from "@/lib/api/agentRuntime";
import type { SelectedSessionActivityState } from "../../team-workspace-runtime/activityPreviewSelectors";
import {
  formatUpdatedAt,
  resolveStatusMeta,
} from "../../utils/teamWorkspaceSessions";
import {
  buildTeamWorkspaceBoardCanvasSectionProps,
  buildTeamWorkspaceBoardEmptyShellProps,
  buildTeamWorkspaceBoardHeaderProps,
  buildTeamWorkspaceBoardShellProps,
} from "./teamWorkspaceBoardPropBuilders";
import { useTeamWorkspaceBoardSelectedInlineDetail } from "./useTeamWorkspaceBoardSelectedInlineDetail";

type TeamWorkspaceBoardCanvasRuntimeState = ReturnType<
  (typeof import("./useTeamWorkspaceBoardCanvasRuntime"))["useTeamWorkspaceBoardCanvasRuntime"]
>;
type TeamWorkspaceBoardFormationState = ReturnType<
  (typeof import("./useTeamWorkspaceBoardFormationState"))["useTeamWorkspaceBoardFormationState"]
>;
type TeamWorkspaceBoardPresentationState = ReturnType<
  (typeof import("./useTeamWorkspaceBoardPresentation"))["useTeamWorkspaceBoardPresentation"]
>;
type TeamWorkspaceBoardRuntimeState = ReturnType<
  (typeof import("./useTeamWorkspaceBoardRuntimeState"))["useTeamWorkspaceBoardRuntimeState"]
>;
type TeamWorkspaceBoardSessionGraphState = ReturnType<
  (typeof import("./useTeamWorkspaceBoardSessionGraph"))["useTeamWorkspaceBoardSessionGraph"]
>;
type TeamWorkspaceBoardEmptyShellProps = ReturnType<
  typeof buildTeamWorkspaceBoardEmptyShellProps
>;
type TeamWorkspaceBoardShellProps = ReturnType<
  typeof buildTeamWorkspaceBoardShellProps
>;

interface UseTeamWorkspaceBoardShellPropsParams {
  className?: string;
  embedded: boolean;
  canvasRuntimeState: TeamWorkspaceBoardCanvasRuntimeState;
  formationState: TeamWorkspaceBoardFormationState;
  onExpandEmptyShell: () => void;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
  onToggleDetail: () => void;
  presentationState: TeamWorkspaceBoardPresentationState;
  runtimeState: TeamWorkspaceBoardRuntimeState;
  selectedSessionActivityState: SelectedSessionActivityState;
  sessionGraphState: TeamWorkspaceBoardSessionGraphState;
  subagentParentContext?: AsterSubagentParentContext | null;
}

interface TeamWorkspaceBoardShellState {
  emptyShellProps: TeamWorkspaceBoardEmptyShellProps;
  shellProps: TeamWorkspaceBoardShellProps;
}

export function useTeamWorkspaceBoardShellProps({
  className,
  embedded,
  canvasRuntimeState,
  formationState,
  onExpandEmptyShell,
  onOpenSubagentSession,
  onReturnToParentSession,
  onToggleDetail,
  presentationState,
  runtimeState,
  selectedSessionActivityState,
  sessionGraphState,
  subagentParentContext = null,
}: UseTeamWorkspaceBoardShellPropsParams): TeamWorkspaceBoardShellState {
  const {
    hasRuntimeFormation,
    runtimeFormationDisplay,
    selectedTeamPlanDisplay,
  } = formationState;
  const {
    boardBodyClassName,
    boardChromeDisplay,
    boardHeaderClassName,
    boardShellClassName,
    canvasStageHeight,
    detailCardClassName,
    detailSummary,
    detailToggleLabel,
    detailVisible,
    inlineDetailSectionClassName,
    inlineTimelineEntryClassName,
    inlineTimelineFeedClassName,
    memberCanvasSubtitle,
    memberCanvasTitle,
    railCardClassName,
    selectedSessionDetailDisplay,
    useCompactCanvasChrome,
  } = presentationState;
  const {
    canCloseCompletedTeamSessions,
    canOpenSelectedSession,
    canResumeSelectedSession,
    canSendSelectedSessionInput,
    canStopSelectedSession,
    canWaitAnyActiveTeamSession,
    canWaitSelectedSession,
    completedTeamSessionIds,
    expandedSessionId,
    handleCloseCompletedTeamSessions,
    handleSelectTeamOperationEntry,
    handleSelectedSessionAction,
    handleSelectedSessionInputDraftChange,
    handleSelectedSessionSendInput,
    handleWaitAnyActiveTeamSessions,
    pendingSessionAction,
    pendingTeamAction,
    selectedActionPending,
    selectedSession,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
    teamOperationEntries,
    waitableTeamSessionIds,
  } = runtimeState;
  const {
    canvasBounds,
    canvasLaneLayouts,
    canvasViewportRef,
    canvasLanes,
    canvasStageHint,
    handleAutoArrangeCanvas,
    handleCanvasWheel,
    handleFitCanvasView,
    handleResetCanvasView,
    handleSelectCanvasLane,
    handleStartCanvasLaneDrag,
    handleStartCanvasLaneResize,
    handleStartCanvasPan,
    handleZoomIn,
    handleZoomOut,
    isCanvasPanModifierActive,
    viewport: canvasViewport,
    zoom: canvasZoom,
  } = canvasRuntimeState;
  const { isChildSession, isEmptyShellState, totalTeamSessions } =
    sessionGraphState;
  const hasRuntimeSessions = isChildSession || totalTeamSessions > 0;

  const selectedInlineDetail = useTeamWorkspaceBoardSelectedInlineDetail({
    canOpenSelectedSession,
    canResumeSelectedSession,
    canSendSelectedSessionInput,
    canStopSelectedSession,
    canWaitSelectedSession,
    detailDisplay: selectedSessionDetailDisplay,
    detailSummary,
    formatUpdatedAt,
    inlineDetailSectionClassName,
    inlineTimelineEntryClassName,
    inlineTimelineFeedClassName,
    isChildSession,
    onOpenSubagentSession,
    onSelectedSessionAction: handleSelectedSessionAction,
    onSelectedSessionInputDraftChange: handleSelectedSessionInputDraftChange,
    onSelectedSessionSendInput: handleSelectedSessionSendInput,
    pendingSessionAction,
    selectedActionPending,
    selectedSession,
    selectedSessionActivityState,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
  });

  const emptyShellProps = buildTeamWorkspaceBoardEmptyShellProps({
    className,
    embedded,
    hasRuntimeFormation,
    onExpand: onExpandEmptyShell,
    runtimeFormationDisplay,
    selectedTeamPlanDisplay,
  });
  const headerProps = buildTeamWorkspaceBoardHeaderProps({
    boardChromeDisplay,
    createdFromTurnId: subagentParentContext?.created_from_turn_id,
    detailToggleLabel,
    detailVisible,
    isChildSession,
    isEmptyShellState,
    onReturnToParentSession,
    onToggleDetail,
    resolveStatusMeta,
    runtimeFormationStatusLabel: runtimeFormationDisplay.panelStatusLabel,
    totalTeamSessions,
    useCompactCanvasChrome,
  });
  const canvasSectionProps = buildTeamWorkspaceBoardCanvasSectionProps({
    boardChromeDisplay,
    canvasBoundsHeight: canvasBounds.height,
    canvasBoundsWidth: canvasBounds.width,
    canvasStageHeight,
    canvasStageHint,
    canvasViewportRef,
    canvasZoom,
    canCloseCompletedTeamSessions,
    canWaitAnyActiveTeamSession,
    completedCount: completedTeamSessionIds.length,
    detailCardClassName,
    detailVisible,
    expandedSessionId,
    formatUpdatedAt,
    hasRuntimeSessions,
    isCanvasPanModifierActive,
    laneLayouts: canvasLaneLayouts,
    lanes: canvasLanes,
    memberCanvasSubtitle,
    memberCanvasTitle,
    onAutoArrangeCanvas: handleAutoArrangeCanvas,
    onCanvasWheel: handleCanvasWheel,
    onCloseCompletedTeamSessions: handleCloseCompletedTeamSessions,
    onFitCanvasView: handleFitCanvasView,
    onResetCanvasView: handleResetCanvasView,
    onSelectCanvasLane: handleSelectCanvasLane,
    onSelectTeamOperationEntry: handleSelectTeamOperationEntry,
    onStartCanvasLaneDrag: handleStartCanvasLaneDrag,
    onStartCanvasLaneResize: handleStartCanvasLaneResize,
    onStartCanvasPan: handleStartCanvasPan,
    onWaitAnyActiveTeamSessions: handleWaitAnyActiveTeamSessions,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    pendingTeamAction,
    railCardClassName,
    resolveStatusMeta,
    runtimeFormationDisplay,
    selectedInlineDetail,
    selectedSession,
    selectedSessionId: selectedSession?.id ?? null,
    selectedTeamPlanDisplay,
    teamOperationEntries,
    useCompactCanvasChrome,
    viewport: canvasViewport,
    waitableCount: waitableTeamSessionIds.length,
  });
  const shellProps = buildTeamWorkspaceBoardShellProps({
    boardBodyClassName,
    boardHeaderClassName,
    boardShellClassName,
    canvasSectionProps,
    embedded,
    headerProps,
  });

  return {
    emptyShellProps,
    shellProps,
  };
}
