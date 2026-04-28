import { useMemo } from "react";
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
import {
  buildTeamWorkspaceBoardSurfaceClassNames,
  resolveTeamWorkspaceBoardCopyState,
} from "./teamWorkspaceBoardPresentationSelectors";

interface UseTeamWorkspaceBoardPresentationParams {
  canCloseCompletedTeamSessions: boolean;
  canWaitAnyActiveTeamSession: boolean;
  className?: string;
  completedCount: number;
  detailExpanded: boolean;
  dispatchPreviewStatus?: TeamWorkspaceRuntimeFormationStatus | null;
  embedded: boolean;
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
  boardChromeDisplay: ReturnType<
    typeof buildTeamWorkspaceBoardChromeDisplayState
  >;
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
  const hasRuntimeSessions = isChildSession || totalTeamSessions > 0;
  const useCompactCanvasChrome = hasRuntimeSessions;
  const {
    detailToggleLabel,
    detailVisible,
    memberCanvasSubtitle,
    memberCanvasTitle,
  } = resolveTeamWorkspaceBoardCopyState({
    detailExpanded,
    dispatchPreviewStatus,
    hasRuntimeSessions,
    isChildSession,
    isEmptyShellState,
    shellExpanded,
    visibleSessionsCount,
  });

  const boardChromeDisplay = useMemo(
    () =>
      buildTeamWorkspaceBoardChromeDisplayState({
        hasRuntimeSessions,
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
      hasRuntimeSessions,
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
      hasRuntimeSessions,
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
  const {
    boardBodyClassName,
    boardHeaderClassName,
    boardShellClassName,
    canvasStageHeight,
    detailCardClassName,
    inlineDetailSectionClassName,
    inlineTimelineEntryClassName,
    inlineTimelineFeedClassName,
    railCardClassName,
  } = buildTeamWorkspaceBoardSurfaceClassNames({
    className,
    detailVisible,
    embedded,
    selectedSessionStatusCardClassName: selectedStatusMeta.cardClassName,
    selectedSessionVisible: Boolean(selectedSession),
    useCompactCanvasChrome,
  });

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
    inlineDetailSectionClassName,
    inlineTimelineEntryClassName,
    inlineTimelineFeedClassName,
    memberCanvasSubtitle,
    memberCanvasTitle,
    railCardClassName,
    selectedSessionDetailDisplay,
    useCompactCanvasChrome,
  };
}
