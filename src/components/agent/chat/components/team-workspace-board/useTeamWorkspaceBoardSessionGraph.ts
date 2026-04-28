import { useMemo } from "react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  applyLiveRuntimeState,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
} from "../../teamWorkspaceRuntime";
import type { ActivityPreviewSession } from "../../team-workspace-runtime/activityPreviewSelectors";
import {
  buildCurrentChildSession,
  buildTeamWorkspaceMemberCanvasSessions,
  buildTeamWorkspaceRailSessions,
  buildVisibleTeamSessionCards,
  buildOrchestratorSession,
  type TeamSessionCard,
} from "../../utils/teamWorkspaceSessions";

type RuntimeStatus = AsterSubagentSessionInfo["runtime_status"];

interface UseTeamWorkspaceBoardSessionGraphParams {
  childSubagentSessions: AsterSubagentSessionInfo[];
  currentSessionId?: string | null;
  currentSessionLatestTurnStatus?: RuntimeStatus;
  currentSessionName?: string | null;
  currentSessionQueuedTurnCount?: number;
  currentSessionRuntimeStatus?: RuntimeStatus;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
  shellVisible?: boolean;
  subagentParentContext?: AsterSubagentParentContext | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}

interface TeamWorkspaceBoardSessionGraphState {
  basePreviewableRailSessions: ActivityPreviewSession[];
  baseRailSessions: TeamSessionCard[];
  canvasStorageScopeId: string;
  currentChildSession: TeamSessionCard | null;
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  isEmptyShellState: boolean;
  memberCanvasSessions: TeamSessionCard[];
  orchestratorSession: TeamSessionCard | null;
  railSessions: TeamSessionCard[];
  siblingCount: number;
  totalTeamSessions: number;
  visibleSessions: TeamSessionCard[];
}

export function useTeamWorkspaceBoardSessionGraph({
  childSubagentSessions,
  currentSessionId,
  currentSessionLatestTurnStatus,
  currentSessionName,
  currentSessionQueuedTurnCount = 0,
  currentSessionRuntimeStatus,
  liveRuntimeBySessionId = {},
  shellVisible = false,
  subagentParentContext = null,
  teamDispatchPreviewState = null,
}: UseTeamWorkspaceBoardSessionGraphParams): TeamWorkspaceBoardSessionGraphState {
  const isChildSession = Boolean(subagentParentContext);
  const canvasStorageScopeId =
    currentSessionId?.trim() ||
    subagentParentContext?.parent_session_id?.trim() ||
    teamDispatchPreviewState?.requestId?.trim() ||
    "team-workspace";
  const baseOrchestratorSession = useMemo(
    () =>
      buildOrchestratorSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
      ),
    [currentSessionId, currentSessionName, currentSessionRuntimeStatus],
  );
  const baseCurrentChildSession = useMemo(
    () =>
      buildCurrentChildSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount,
        subagentParentContext,
      ),
    [
      currentSessionId,
      currentSessionLatestTurnStatus,
      currentSessionName,
      currentSessionQueuedTurnCount,
      currentSessionRuntimeStatus,
      subagentParentContext,
    ],
  );
  const baseVisibleSessions = useMemo<TeamSessionCard[]>(
    () =>
      buildVisibleTeamSessionCards(
        isChildSession
          ? (subagentParentContext?.sibling_subagent_sessions ?? [])
          : childSubagentSessions,
      ),
    [childSubagentSessions, isChildSession, subagentParentContext],
  );
  const baseHasRealTeamGraph = isChildSession || baseVisibleSessions.length > 0;
  const baseRailSessions = useMemo(
    () =>
      buildTeamWorkspaceRailSessions({
        isChildSession,
        hasRealTeamGraph: baseHasRealTeamGraph,
        currentChildSession: baseCurrentChildSession,
        orchestratorSession: baseOrchestratorSession,
        visibleSessions: baseVisibleSessions,
      }),
    [
      baseCurrentChildSession,
      baseHasRealTeamGraph,
      baseOrchestratorSession,
      baseVisibleSessions,
      isChildSession,
    ],
  );
  const orchestratorSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseOrchestratorSession,
        baseOrchestratorSession
          ? liveRuntimeBySessionId[baseOrchestratorSession.id]
          : undefined,
      ),
    [baseOrchestratorSession, liveRuntimeBySessionId],
  );
  const currentChildSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseCurrentChildSession,
        baseCurrentChildSession
          ? liveRuntimeBySessionId[baseCurrentChildSession.id]
          : undefined,
      ),
    [baseCurrentChildSession, liveRuntimeBySessionId],
  );
  const visibleSessions = useMemo(
    () =>
      baseVisibleSessions.map(
        (session) =>
          applyLiveRuntimeState(session, liveRuntimeBySessionId[session.id]) ??
          session,
      ),
    [baseVisibleSessions, liveRuntimeBySessionId],
  );
  const totalTeamSessions = isChildSession
    ? visibleSessions.length + (currentChildSession ? 1 : 0)
    : visibleSessions.length;
  const siblingCount =
    subagentParentContext?.sibling_subagent_sessions?.length ?? 0;
  const hasRealTeamGraph = isChildSession || visibleSessions.length > 0;
  const isEmptyShellState =
    !isChildSession && shellVisible && visibleSessions.length === 0;
  const memberCanvasSessions = useMemo(
    () =>
      buildTeamWorkspaceMemberCanvasSessions({
        isChildSession,
        currentChildSession,
        visibleSessions,
        teamDispatchPreviewState,
      }),
    [
      currentChildSession,
      isChildSession,
      teamDispatchPreviewState,
      visibleSessions,
    ],
  );
  const railSessions = useMemo(
    () =>
      buildTeamWorkspaceRailSessions({
        isChildSession,
        hasRealTeamGraph,
        currentChildSession,
        orchestratorSession,
        visibleSessions,
      }),
    [
      currentChildSession,
      hasRealTeamGraph,
      isChildSession,
      orchestratorSession,
      visibleSessions,
    ],
  );
  const basePreviewableRailSessions = useMemo<ActivityPreviewSession[]>(
    () => baseRailSessions.filter((session) => session.sessionType !== "user"),
    [baseRailSessions],
  );

  return {
    basePreviewableRailSessions,
    baseRailSessions,
    canvasStorageScopeId,
    currentChildSession,
    hasRealTeamGraph,
    isChildSession,
    isEmptyShellState,
    memberCanvasSessions,
    orchestratorSession,
    railSessions,
    siblingCount,
    totalTeamSessions,
    visibleSessions,
  };
}
