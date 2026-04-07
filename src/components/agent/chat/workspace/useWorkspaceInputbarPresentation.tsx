import { useMemo, type ComponentProps, type ReactNode } from "react";
import { GeneralWorkbenchEntryPromptAccessory } from "../components/GeneralWorkbenchEntryPromptAccessory";
import { GeneralWorkbenchDialogSection } from "./WorkspaceHarnessDialogs";
import { WorkspaceInputbar } from "./WorkspaceInputbar";
import {
  buildFloatingTeamWorkspaceDockProps,
  buildWorkspaceInputbarProps,
} from "./inputbarPresentation";
import type { TeamWorkbenchSurfaceProps } from "./teamWorkbenchPresentation";

type WorkspaceInputbarBuilderParams = Parameters<
  typeof buildWorkspaceInputbarProps
>[0];
type FloatingTeamWorkspaceDockParams = Omit<
  Parameters<typeof buildFloatingTeamWorkspaceDockProps>[0],
  "surfaceProps"
>;

interface WorkspaceTeamWorkbenchSurfaceParams {
  shellVisible: TeamWorkbenchSurfaceProps["shellVisible"];
  currentSessionId: TeamWorkbenchSurfaceProps["currentSessionId"];
  currentSessionName: TeamWorkbenchSurfaceProps["currentSessionName"];
  currentSessionRuntimeStatus: TeamWorkbenchSurfaceProps["currentSessionRuntimeStatus"];
  currentSessionLatestTurnStatus: TeamWorkbenchSurfaceProps["currentSessionLatestTurnStatus"];
  currentSessionQueuedTurnCount: TeamWorkbenchSurfaceProps["currentSessionQueuedTurnCount"];
  childSubagentSessions: TeamWorkbenchSurfaceProps["childSubagentSessions"];
  subagentParentContext: TeamWorkbenchSurfaceProps["subagentParentContext"];
  liveRuntimeBySessionId: TeamWorkbenchSurfaceProps["liveRuntimeBySessionId"];
  liveActivityBySessionId: TeamWorkbenchSurfaceProps["liveActivityBySessionId"];
  activityRefreshVersionBySessionId: TeamWorkbenchSurfaceProps["activityRefreshVersionBySessionId"];
  onSendSubagentInput: TeamWorkbenchSurfaceProps["onSendSubagentInput"];
  onWaitSubagentSession: TeamWorkbenchSurfaceProps["onWaitSubagentSession"];
  onWaitActiveTeamSessions: TeamWorkbenchSurfaceProps["onWaitActiveTeamSessions"];
  onCloseCompletedTeamSessions: TeamWorkbenchSurfaceProps["onCloseCompletedTeamSessions"];
  onCloseSubagentSession: TeamWorkbenchSurfaceProps["onCloseSubagentSession"];
  onResumeSubagentSession: TeamWorkbenchSurfaceProps["onResumeSubagentSession"];
  onOpenSubagentSession: TeamWorkbenchSurfaceProps["onOpenSubagentSession"];
  onReturnToParentSession: TeamWorkbenchSurfaceProps["onReturnToParentSession"];
  teamWaitSummary: TeamWorkbenchSurfaceProps["teamWaitSummary"];
  teamControlSummary: TeamWorkbenchSurfaceProps["teamControlSummary"];
  selectedTeamLabel: TeamWorkbenchSurfaceProps["selectedTeamLabel"];
  selectedTeamSummary: TeamWorkbenchSurfaceProps["selectedTeamSummary"];
  selectedTeamRoles: TeamWorkbenchSurfaceProps["selectedTeamRoles"];
  teamDispatchPreviewState: TeamWorkbenchSurfaceProps["teamDispatchPreviewState"];
}

interface UseWorkspaceInputbarPresentationParams {
  teamWorkbench: WorkspaceTeamWorkbenchSurfaceParams;
  inputbar: WorkspaceInputbarBuilderParams;
  floatingTeamWorkspaceDock: FloatingTeamWorkspaceDockParams;
  generalWorkbenchEntryPrompt:
    | ComponentProps<typeof GeneralWorkbenchEntryPromptAccessory>["prompt"]
    | null;
  onRestartGeneralWorkbenchEntryPrompt: () => void;
  onContinueGeneralWorkbenchEntryPrompt: () => Promise<void> | void;
  generalWorkbenchDialog: ComponentProps<typeof GeneralWorkbenchDialogSection>;
}

interface WorkspaceInputbarPresentationResult {
  teamWorkbenchSurfaceProps: TeamWorkbenchSurfaceProps;
  inputbarNode: ReactNode;
  generalWorkbenchDialog: ReactNode;
}

export function useWorkspaceInputbarPresentation({
  teamWorkbench,
  inputbar,
  floatingTeamWorkspaceDock,
  generalWorkbenchEntryPrompt,
  onRestartGeneralWorkbenchEntryPrompt,
  onContinueGeneralWorkbenchEntryPrompt,
  generalWorkbenchDialog,
}: UseWorkspaceInputbarPresentationParams): WorkspaceInputbarPresentationResult {
  const teamWorkbenchSurfaceProps = useMemo<TeamWorkbenchSurfaceProps>(
    () => ({
      shellVisible: teamWorkbench.shellVisible,
      currentSessionId: teamWorkbench.currentSessionId,
      currentSessionName: teamWorkbench.currentSessionName,
      currentSessionRuntimeStatus: teamWorkbench.currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus:
        teamWorkbench.currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount:
        teamWorkbench.currentSessionQueuedTurnCount,
      childSubagentSessions: teamWorkbench.childSubagentSessions,
      subagentParentContext: teamWorkbench.subagentParentContext,
      liveRuntimeBySessionId: teamWorkbench.liveRuntimeBySessionId,
      liveActivityBySessionId: teamWorkbench.liveActivityBySessionId,
      activityRefreshVersionBySessionId:
        teamWorkbench.activityRefreshVersionBySessionId,
      onSendSubagentInput: teamWorkbench.onSendSubagentInput,
      onWaitSubagentSession: teamWorkbench.onWaitSubagentSession,
      onWaitActiveTeamSessions: teamWorkbench.onWaitActiveTeamSessions,
      onCloseCompletedTeamSessions: teamWorkbench.onCloseCompletedTeamSessions,
      onCloseSubagentSession: teamWorkbench.onCloseSubagentSession,
      onResumeSubagentSession: teamWorkbench.onResumeSubagentSession,
      onOpenSubagentSession: teamWorkbench.onOpenSubagentSession,
      onReturnToParentSession: teamWorkbench.onReturnToParentSession,
      teamWaitSummary: teamWorkbench.teamWaitSummary,
      teamControlSummary: teamWorkbench.teamControlSummary,
      selectedTeamLabel: teamWorkbench.selectedTeamLabel,
      selectedTeamSummary: teamWorkbench.selectedTeamSummary,
      selectedTeamRoles: teamWorkbench.selectedTeamRoles,
      teamDispatchPreviewState: teamWorkbench.teamDispatchPreviewState,
    }),
    [
      teamWorkbench.activityRefreshVersionBySessionId,
      teamWorkbench.childSubagentSessions,
      teamWorkbench.currentSessionId,
      teamWorkbench.currentSessionLatestTurnStatus,
      teamWorkbench.currentSessionName,
      teamWorkbench.currentSessionQueuedTurnCount,
      teamWorkbench.currentSessionRuntimeStatus,
      teamWorkbench.liveActivityBySessionId,
      teamWorkbench.liveRuntimeBySessionId,
      teamWorkbench.onCloseCompletedTeamSessions,
      teamWorkbench.onCloseSubagentSession,
      teamWorkbench.onOpenSubagentSession,
      teamWorkbench.onResumeSubagentSession,
      teamWorkbench.onReturnToParentSession,
      teamWorkbench.onSendSubagentInput,
      teamWorkbench.onWaitActiveTeamSessions,
      teamWorkbench.onWaitSubagentSession,
      teamWorkbench.teamDispatchPreviewState,
      teamWorkbench.selectedTeamLabel,
      teamWorkbench.selectedTeamRoles,
      teamWorkbench.selectedTeamSummary,
      teamWorkbench.shellVisible,
      teamWorkbench.subagentParentContext,
      teamWorkbench.teamControlSummary,
      teamWorkbench.teamWaitSummary,
    ],
  );

  const generalWorkbenchEntryPromptAccessory = useMemo(
    () =>
      generalWorkbenchEntryPrompt ? (
        <GeneralWorkbenchEntryPromptAccessory
          prompt={generalWorkbenchEntryPrompt}
          onRestart={onRestartGeneralWorkbenchEntryPrompt}
          onContinue={onContinueGeneralWorkbenchEntryPrompt}
        />
      ) : null,
    [
      generalWorkbenchEntryPrompt,
      onContinueGeneralWorkbenchEntryPrompt,
      onRestartGeneralWorkbenchEntryPrompt,
    ],
  );

  const workspaceInputbarProps = buildWorkspaceInputbarProps(inputbar);
  const floatingTeamWorkspaceDockProps = buildFloatingTeamWorkspaceDockProps({
    ...floatingTeamWorkspaceDock,
    surfaceProps: teamWorkbenchSurfaceProps,
  });

  return {
    teamWorkbenchSurfaceProps,
    inputbarNode: (
      <WorkspaceInputbar
        inputbarProps={workspaceInputbarProps}
        accessory={generalWorkbenchEntryPromptAccessory}
        teamWorkspaceDockProps={floatingTeamWorkspaceDockProps}
      />
    ),
    generalWorkbenchDialog: (
      <GeneralWorkbenchDialogSection {...generalWorkbenchDialog} />
    ),
  };
}
