import { useState } from "react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import {
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import { TeamWorkspaceBoardShell } from "./team-workspace-board/TeamWorkspaceBoardShell";
import { TeamWorkspaceEmptyShellState } from "./team-workspace-board/TeamWorkspaceEmptyShellState";
import { useTeamWorkspaceBoardComposer } from "./team-workspace-board/useTeamWorkspaceBoardComposer";
import { useTeamWorkspaceBoardFormationState } from "./team-workspace-board/useTeamWorkspaceBoardFormationState";
import { useTeamWorkspaceBoardSessionGraph } from "./team-workspace-board/useTeamWorkspaceBoardSessionGraph";

type RuntimeStatus = AsterSubagentSessionInfo["runtime_status"];

interface TeamWorkspaceBoardProps {
  className?: string;
  embedded?: boolean;
  shellVisible?: boolean;
  defaultShellExpanded?: boolean;
  currentSessionId?: string | null;
  currentSessionName?: string | null;
  currentSessionRuntimeStatus?: RuntimeStatus;
  currentSessionLatestTurnStatus?: RuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  activityRefreshVersionBySessionId?: Record<string, number>;
  onSendSubagentInput?: (
    sessionId: string,
    message: string,
    options?: { interrupt?: boolean },
  ) => void | Promise<void>;
  onWaitSubagentSession?: (
    sessionId: string,
    timeoutMs?: number,
  ) => void | Promise<void>;
  onWaitActiveTeamSessions?: (
    sessionIds: string[],
    timeoutMs?: number,
  ) => void | Promise<void>;
  onCloseCompletedTeamSessions?: (sessionIds: string[]) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
  onResumeSubagentSession?: (sessionId: string) => void | Promise<void>;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}
export function TeamWorkspaceBoard({
  className,
  embedded = false,
  shellVisible = false,
  defaultShellExpanded = false,
  currentSessionId,
  currentSessionName,
  currentSessionRuntimeStatus,
  currentSessionLatestTurnStatus,
  currentSessionQueuedTurnCount = 0,
  childSubagentSessions = [],
  subagentParentContext = null,
  liveRuntimeBySessionId = {},
  liveActivityBySessionId = {},
  activityRefreshVersionBySessionId = {},
  onSendSubagentInput,
  onWaitSubagentSession,
  onWaitActiveTeamSessions,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onResumeSubagentSession,
  onOpenSubagentSession,
  onReturnToParentSession,
  teamWaitSummary = null,
  teamControlSummary = null,
  selectedTeamLabel = null,
  selectedTeamSummary = null,
  selectedTeamRoles = [],
  teamDispatchPreviewState = null,
}: TeamWorkspaceBoardProps) {
  const [shellExpanded, setShellExpanded] = useState(defaultShellExpanded);
  const detailExpanded = !embedded;
  const canvasViewportFallbackHeight = embedded && !detailExpanded ? 720 : 560;
  const sessionGraphState = useTeamWorkspaceBoardSessionGraph({
    childSubagentSessions,
    currentSessionId,
    currentSessionLatestTurnStatus,
    currentSessionName,
    currentSessionQueuedTurnCount,
    currentSessionRuntimeStatus,
    liveRuntimeBySessionId,
    shellVisible,
    subagentParentContext,
    teamDispatchPreviewState,
  });
  const formationState = useTeamWorkspaceBoardFormationState({
    selectedTeamLabel,
    selectedTeamRoles,
    selectedTeamSummary,
    teamDispatchPreviewState,
  });
  const { isEmptyShellState } = sessionGraphState;
  const { emptyShellProps, shellProps } = useTeamWorkspaceBoardComposer({
    activityRefreshVersionBySessionId,
    canvasViewportFallbackHeight,
    className,
    currentSessionId,
    detailExpanded,
    embedded,
    formationState,
    liveActivityBySessionId,
    onCloseCompletedTeamSessions,
    onCloseSubagentSession,
    onExpandEmptyShell: () => {
      setShellExpanded(true);
    },
    onOpenSubagentSession,
    onResumeSubagentSession,
    onReturnToParentSession,
    onSendSubagentInput,
    onToggleDetail: () => {
      setShellExpanded((previous) => !previous);
    },
    onWaitActiveTeamSessions,
    onWaitSubagentSession,
    sessionGraphState,
    shellExpanded,
    subagentParentContext,
    teamControlSummary,
    teamDispatchPreviewState,
    teamWaitSummary,
  });

  if (
    !subagentParentContext &&
    childSubagentSessions.length === 0 &&
    !shellVisible
  ) {
    return null;
  }

  if (isEmptyShellState && !shellExpanded) {
    return <TeamWorkspaceEmptyShellState {...emptyShellProps} />;
  }
  return <TeamWorkspaceBoardShell {...shellProps} />;
}
