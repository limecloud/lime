import { useMemo } from "react";
import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceRuntimeFormationState,
} from "../../teamWorkspaceRuntime";
import type { SessionActivityPreviewState } from "../../team-workspace-runtime/activityPreviewSelectors";
import {
  buildTeamWorkspaceCanvasLanes,
  type TeamWorkspaceCanvasLane,
} from "../../team-workspace-runtime/canvasLaneSelectors";
import type { TeamRoleDefinition } from "../../utils/teamDefinitions";
import { buildCanvasStageHint } from "../../utils/teamWorkspaceCanvas";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";
import { useTeamWorkspaceCanvasController } from "./useTeamWorkspaceCanvasController";

interface UseTeamWorkspaceBoardCanvasRuntimeParams {
  activityTimelineEntryLimit: number;
  canvasStorageScopeId: string;
  canvasViewportFallbackHeight: number;
  embedded: boolean;
  expandedSessionId?: string | null;
  focusSession: (sessionId: string) => void;
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
  hasSelectedTeamPlan: boolean;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  memberCanvasSessions: TeamSessionCard[];
  plannedRoles: TeamRoleDefinition[];
  previewBySessionId: Record<string, SessionActivityPreviewState>;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}

interface TeamWorkspaceBoardCanvasRuntimeState
  extends ReturnType<typeof useTeamWorkspaceCanvasController> {
  canvasLanes: TeamWorkspaceCanvasLane[];
  canvasStageHint: string;
}

export function useTeamWorkspaceBoardCanvasRuntime({
  activityTimelineEntryLimit,
  canvasStorageScopeId,
  canvasViewportFallbackHeight,
  embedded,
  expandedSessionId = null,
  focusSession,
  hasRealTeamGraph,
  hasRuntimeFormation,
  hasSelectedTeamPlan,
  liveActivityBySessionId = {},
  memberCanvasSessions,
  plannedRoles,
  previewBySessionId,
  teamDispatchPreviewState = null,
}: UseTeamWorkspaceBoardCanvasRuntimeParams): TeamWorkspaceBoardCanvasRuntimeState {
  const canvasLanes = useMemo<TeamWorkspaceCanvasLane[]>(
    () =>
      buildTeamWorkspaceCanvasLanes({
        hasRealTeamGraph,
        sessions: memberCanvasSessions,
        runtimeMembers: teamDispatchPreviewState?.members ?? [],
        plannedRoles,
        liveActivityBySessionId,
        previewBySessionId,
        activityTimelineEntryLimit,
      }),
    [
      activityTimelineEntryLimit,
      hasRealTeamGraph,
      liveActivityBySessionId,
      memberCanvasSessions,
      plannedRoles,
      previewBySessionId,
      teamDispatchPreviewState?.members,
    ],
  );
  const canvasControllerState = useTeamWorkspaceCanvasController({
    canvasLanes,
    canvasStorageScopeId,
    canvasViewportFallbackHeight,
    embedded,
    expandedSessionId,
    onSelectSession: focusSession,
  });
  const canvasStageHint = buildCanvasStageHint({
    hasRealTeamGraph,
    hasRuntimeFormation,
    hasSelectedTeamPlan,
    teamDispatchPreviewState,
  });

  return {
    ...canvasControllerState,
    canvasLanes,
    canvasStageHint,
  };
}
