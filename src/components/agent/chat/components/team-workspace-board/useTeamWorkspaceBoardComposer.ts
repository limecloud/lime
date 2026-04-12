import type { AsterSubagentParentContext } from "@/lib/api/agentRuntime";
import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceControlSummary,
  TeamWorkspaceRuntimeFormationState,
  TeamWorkspaceWaitSummary,
} from "../../teamWorkspaceRuntime";
import { useTeamWorkspaceActivityPreviews } from "./useTeamWorkspaceActivityPreviews";
import { useTeamWorkspaceBoardCanvasRuntime } from "./useTeamWorkspaceBoardCanvasRuntime";
import { useTeamWorkspaceBoardFormationState } from "./useTeamWorkspaceBoardFormationState";
import { useTeamWorkspaceBoardPresentation } from "./useTeamWorkspaceBoardPresentation";
import { useTeamWorkspaceBoardRuntimeState } from "./useTeamWorkspaceBoardRuntimeState";
import { useTeamWorkspaceBoardShellProps } from "./useTeamWorkspaceBoardShellProps";
import { useTeamWorkspaceBoardSessionGraph } from "./useTeamWorkspaceBoardSessionGraph";

const DEFAULT_ACTIVITY_TIMELINE_ENTRY_LIMIT = 4;
const DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS = 30_000;

interface UseTeamWorkspaceBoardComposerParams {
  activityRefreshVersionBySessionId?: Record<string, number>;
  canvasViewportFallbackHeight: number;
  className?: string;
  currentSessionId?: string | null;
  detailExpanded: boolean;
  embedded: boolean;
  formationState: ReturnType<typeof useTeamWorkspaceBoardFormationState>;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  onCloseCompletedTeamSessions?: (sessionIds: string[]) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
  onExpandEmptyShell: () => void;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onResumeSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
  onSendSubagentInput?: (
    sessionId: string,
    message: string,
    options?: { interrupt?: boolean },
  ) => void | Promise<void>;
  onWaitActiveTeamSessions?: (
    sessionIds: string[],
    timeoutMs?: number,
  ) => void | Promise<void>;
  onWaitSubagentSession?: (
    sessionId: string,
    timeoutMs?: number,
  ) => void | Promise<void>;
  onToggleDetail: () => void;
  sessionGraphState: ReturnType<typeof useTeamWorkspaceBoardSessionGraph>;
  shellExpanded: boolean;
  subagentParentContext?: AsterSubagentParentContext | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
}

type TeamWorkspaceBoardComposerState = ReturnType<
  typeof useTeamWorkspaceBoardShellProps
>;

export function useTeamWorkspaceBoardComposer({
  activityRefreshVersionBySessionId = {},
  canvasViewportFallbackHeight,
  className,
  currentSessionId,
  detailExpanded,
  embedded,
  formationState,
  liveActivityBySessionId = {},
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onExpandEmptyShell,
  onOpenSubagentSession,
  onResumeSubagentSession,
  onReturnToParentSession,
  onSendSubagentInput,
  onToggleDetail,
  onWaitActiveTeamSessions,
  onWaitSubagentSession,
  sessionGraphState,
  shellExpanded,
  subagentParentContext = null,
  teamControlSummary = null,
  teamDispatchPreviewState = null,
  teamWaitSummary = null,
}: UseTeamWorkspaceBoardComposerParams): TeamWorkspaceBoardComposerState {
  const runtimeState = useTeamWorkspaceBoardRuntimeState({
    baseRailSessions: sessionGraphState.baseRailSessions,
    currentChildSession: sessionGraphState.currentChildSession,
    currentSessionId,
    isChildSession: sessionGraphState.isChildSession,
    memberCanvasSessions: sessionGraphState.memberCanvasSessions,
    onCloseCompletedTeamSessions,
    onCloseSubagentSession,
    onOpenSubagentSession,
    onResumeSubagentSession,
    onSendSubagentInput,
    onWaitActiveTeamSessions,
    onWaitSubagentSession,
    orchestratorSessionId: sessionGraphState.orchestratorSession?.id,
    railSessions: sessionGraphState.railSessions,
    teamControlSummary,
    teamWaitSummary,
    visibleSessions: sessionGraphState.visibleSessions,
    waitTimeoutMs: DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS,
  });
  const { selectedSessionActivityState, sessionActivityPreviewById } =
    useTeamWorkspaceActivityPreviews({
      activityRefreshVersionBySessionId,
      activityTimelineEntryLimit: DEFAULT_ACTIVITY_TIMELINE_ENTRY_LIMIT,
      basePreviewableRailSessions: sessionGraphState.basePreviewableRailSessions,
      liveActivityBySessionId,
      selectedBaseSession: runtimeState.selectedBaseSession,
      selectedSession: runtimeState.selectedSession,
    });
  const canvasRuntimeState = useTeamWorkspaceBoardCanvasRuntime({
    activityTimelineEntryLimit: DEFAULT_ACTIVITY_TIMELINE_ENTRY_LIMIT,
    canvasStorageScopeId: sessionGraphState.canvasStorageScopeId,
    canvasViewportFallbackHeight,
    embedded,
    expandedSessionId: runtimeState.expandedSessionId,
    focusSession: runtimeState.focusSession,
    hasRealTeamGraph: sessionGraphState.hasRealTeamGraph,
    hasRuntimeFormation: formationState.hasRuntimeFormation,
    hasSelectedTeamPlan: formationState.hasSelectedTeamPlan,
    liveActivityBySessionId,
    memberCanvasSessions: sessionGraphState.memberCanvasSessions,
    plannedRoles: formationState.plannedRoles,
    previewBySessionId: sessionActivityPreviewById,
    teamDispatchPreviewState,
  });
  const presentationState = useTeamWorkspaceBoardPresentation({
    canCloseCompletedTeamSessions: runtimeState.canCloseCompletedTeamSessions,
    canWaitAnyActiveTeamSession: runtimeState.canWaitAnyActiveTeamSession,
    className,
    completedCount: runtimeState.completedTeamSessionIds.length,
    detailExpanded,
    dispatchPreviewStatus: teamDispatchPreviewState?.status,
    embedded,
    hasRuntimeFormation: formationState.hasRuntimeFormation,
    isChildSession: sessionGraphState.isChildSession,
    isEmptyShellState: sessionGraphState.isEmptyShellState,
    parentSessionName: subagentParentContext?.parent_session_name,
    runtimeFormationDisplay: formationState.runtimeFormationDisplay,
    selectedSession: runtimeState.selectedSession,
    shellExpanded,
    siblingCount: sessionGraphState.siblingCount,
    statusSummary: runtimeState.statusSummary,
    totalTeamSessions: sessionGraphState.totalTeamSessions,
    visibleSessionsCount: sessionGraphState.visibleSessions.length,
    waitableCount: runtimeState.waitableTeamSessionIds.length,
    zoom: canvasRuntimeState.zoom,
  });
  return useTeamWorkspaceBoardShellProps({
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
    subagentParentContext,
  });
}
