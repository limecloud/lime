import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import { useWorkspaceHarnessInventoryRuntime } from "./useWorkspaceHarnessInventoryRuntime";
import { useWorkspaceInputbarScenePresentation } from "./useWorkspaceInputbarScenePresentation";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import { useWorkspaceShellChromeRuntime } from "./useWorkspaceShellChromeRuntime";
import { useWorkspaceTeamSessionControlRuntime } from "./useWorkspaceTeamSessionControlRuntime";
import { useWorkspaceTeamSessionRuntime } from "./useWorkspaceTeamSessionRuntime";
import { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./useWorkspaceGeneralWorkbenchSidebarRuntime";
import type { Message } from "../types";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  DEFAULT_CHAT_TOOL_PREFERENCES,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";

type InputbarScenePresentationParams = Parameters<
  typeof useWorkspaceInputbarScenePresentation
>[0];
type InputbarPresentationParams =
  InputbarScenePresentationParams["inputbarPresentation"];
type TeamWorkbenchParams = InputbarPresentationParams["teamWorkbench"];
type InputbarParams = InputbarPresentationParams["inputbar"];
type FloatingTeamWorkspaceDockParams =
  InputbarPresentationParams["floatingTeamWorkspaceDock"];
type GeneralWorkbenchDialogParams =
  InputbarPresentationParams["generalWorkbenchDialog"];
type NavigationActions = ReturnType<typeof useWorkspaceNavigationActions>;
type ContextHarnessRuntime = ReturnType<
  typeof useWorkspaceContextHarnessRuntime
>;
type HarnessInventoryRuntime = ReturnType<
  typeof useWorkspaceHarnessInventoryRuntime
>;
type ShellChromeRuntime = ReturnType<typeof useWorkspaceShellChromeRuntime>;
type TeamSessionRuntime = ReturnType<typeof useWorkspaceTeamSessionRuntime>;
type TeamSessionControlRuntime = ReturnType<
  typeof useWorkspaceTeamSessionControlRuntime
>;
type GeneralWorkbenchSidebarRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchSidebarRuntime
>;

interface UseWorkspaceInputbarSceneRuntimeParams {
  contextVariant?: "default" | "task-center";
  setMentionedCharacters: InputbarScenePresentationParams["setMentionedCharacters"];
  taskFiles: InputbarScenePresentationParams["taskFiles"];
  taskFilesExpanded: InputbarScenePresentationParams["taskFilesExpanded"];
  setTaskFilesExpanded: InputbarScenePresentationParams["setTaskFilesExpanded"];
  selectedFileId: InputbarScenePresentationParams["selectedFileId"];
  isThemeWorkbench: InputbarScenePresentationParams["isThemeWorkbench"];
  sessionId: TeamWorkbenchParams["currentSessionId"];
  childSubagentSessions: TeamWorkbenchParams["childSubagentSessions"];
  subagentParentContext: TeamWorkbenchParams["subagentParentContext"];
  selectedTeamLabel: TeamWorkbenchParams["selectedTeamLabel"];
  selectedTeamSummary: TeamWorkbenchParams["selectedTeamSummary"];
  teamDispatchPreviewState: TeamWorkbenchParams["teamDispatchPreviewState"];
  teamMemorySnapshot: GeneralWorkbenchDialogParams["teamMemorySnapshot"];
  teamSessionRuntime: TeamSessionRuntime;
  teamSessionControlRuntime: TeamSessionControlRuntime;
  handleOpenSubagentSession: TeamWorkbenchParams["onOpenSubagentSession"];
  handleReturnToParentSession: TeamWorkbenchParams["onReturnToParentSession"];
  input: InputbarParams["input"];
  setInput: InputbarParams["setInput"];
  currentGate: InputbarParams["workflowGate"];
  generalWorkbenchSidebarRuntime: GeneralWorkbenchSidebarRuntime;
  steps: InputbarParams["workflowSteps"];
  workflowRunState: InputbarParams["workflowRunState"];
  handleSend: InputbarParams["onSend"];
  isPreparingSend: boolean;
  isSending: boolean;
  providerType: InputbarParams["providerType"];
  setProviderType: InputbarParams["setProviderType"];
  model: InputbarParams["model"];
  setModel: InputbarParams["setModel"];
  sessionExecutionRuntime: InputbarParams["executionRuntime"];
  projectId: string | null | undefined;
  projectRootPath: string | null | undefined;
  executionStrategy: InputbarParams["executionStrategy"];
  setExecutionStrategy: InputbarParams["setExecutionStrategy"];
  accessMode: InputbarParams["accessMode"];
  setAccessMode: InputbarParams["setAccessMode"];
  activeTheme: InputbarParams["activeTheme"];
  navigationActions: Pick<
    NavigationActions,
    "handleManageProviders" | "handleOpenRuntimeMemoryWorkbench"
  >;
  selectedTeam: InputbarParams["selectedTeam"];
  handleSelectTeam: InputbarParams["onSelectTeam"];
  handleEnableSuggestedTeam: InputbarParams["onEnableSuggestedTeam"];
  layoutMode: LayoutMode;
  handleTaskFileClick: InputbarParams["onTaskFileClick"];
  characters: InputbarParams["characters"];
  skills: InputbarParams["skills"];
  serviceSkills: InputbarParams["serviceSkills"];
  serviceSkillGroups: InputbarParams["serviceSkillGroups"];
  skillsLoading: InputbarParams["isSkillsLoading"];
  onSelectServiceSkill: InputbarParams["onSelectServiceSkill"];
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  handleNavigateToSkillSettings: InputbarParams["onNavigateToSettings"];
  handleRefreshSkills: InputbarParams["onRefreshSkills"];
  turns: GeneralWorkbenchDialogParams["turns"];
  threadItems: GeneralWorkbenchDialogParams["threadItems"];
  currentTurnId: GeneralWorkbenchDialogParams["currentTurnId"];
  threadRead: GeneralWorkbenchDialogParams["threadRead"];
  activeExecutionRuntime: GeneralWorkbenchDialogParams["executionRuntime"];
  pendingActions: GeneralWorkbenchDialogParams["pendingActions"];
  submittedActionsInFlight: GeneralWorkbenchDialogParams["submittedActionsInFlight"];
  messages: Message[];
  queuedTurns: InputbarParams["queuedTurns"];
  resumeThread: GeneralWorkbenchDialogParams["onResumeThread"];
  replayPendingAction?: (
    requestId: string,
    assistantMessageId: string,
  ) => boolean | Promise<boolean>;
  promoteQueuedTurn?: (queuedTurnId: string) => boolean | Promise<boolean>;
  removeQueuedTurn: InputbarParams["onRemoveQueuedTurn"];
  latestAssistantMessageId: string | null;
  sessionIdForDiagnostics: string | null;
  generalWorkbenchEntryPrompt: InputbarPresentationParams["generalWorkbenchEntryPrompt"];
  handleRestartGeneralWorkbenchEntryPrompt: InputbarPresentationParams["onRestartGeneralWorkbenchEntryPrompt"];
  handleContinueGeneralWorkbenchEntryPrompt: InputbarPresentationParams["onContinueGeneralWorkbenchEntryPrompt"];
  generalWorkbenchEnabled: boolean;
  contextHarnessRuntime: ContextHarnessRuntime;
  harnessState: GeneralWorkbenchDialogParams["harnessState"];
  compatSubagentRuntime: GeneralWorkbenchDialogParams["compatSubagentRuntime"];
  harnessInventoryRuntime: HarnessInventoryRuntime;
  mappedTheme: GeneralWorkbenchDialogParams["activeTheme"];
  handleHarnessLoadFilePreview: GeneralWorkbenchDialogParams["onLoadFilePreview"];
  handleFileClick: GeneralWorkbenchDialogParams["onOpenFile"];
  shellChromeRuntime: ShellChromeRuntime;
  handleActivateTeamWorkbench: FloatingTeamWorkspaceDockParams["onActivateWorkbench"];
  chatToolPreferences?: ChatToolPreferences;
}

export function useWorkspaceInputbarSceneRuntime({
  contextVariant = "default",
  setMentionedCharacters,
  taskFiles,
  taskFilesExpanded,
  setTaskFilesExpanded,
  selectedFileId,
  isThemeWorkbench,
  sessionId,
  childSubagentSessions,
  subagentParentContext,
  selectedTeamLabel,
  selectedTeamSummary,
  teamDispatchPreviewState,
  teamMemorySnapshot,
  teamSessionRuntime,
  teamSessionControlRuntime,
  handleOpenSubagentSession,
  handleReturnToParentSession,
  input,
  setInput,
  currentGate,
  generalWorkbenchSidebarRuntime,
  steps,
  workflowRunState,
  handleSend,
  isPreparingSend,
  isSending,
  providerType,
  setProviderType,
  model,
  setModel,
  sessionExecutionRuntime,
  projectId,
  projectRootPath,
  executionStrategy,
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  activeTheme,
  navigationActions,
  selectedTeam,
  handleSelectTeam,
  handleEnableSuggestedTeam,
  layoutMode,
  handleTaskFileClick,
  characters,
  skills,
  serviceSkills,
  serviceSkillGroups,
  skillsLoading,
  onSelectServiceSkill,
  setChatToolPreferences,
  handleNavigateToSkillSettings,
  handleRefreshSkills,
  turns,
  threadItems,
  currentTurnId,
  threadRead,
  activeExecutionRuntime,
  pendingActions,
  submittedActionsInFlight,
  messages,
  queuedTurns,
  resumeThread,
  replayPendingAction,
  promoteQueuedTurn,
  removeQueuedTurn,
  latestAssistantMessageId,
  sessionIdForDiagnostics,
  generalWorkbenchEntryPrompt,
  handleRestartGeneralWorkbenchEntryPrompt,
  handleContinueGeneralWorkbenchEntryPrompt,
  generalWorkbenchEnabled,
  contextHarnessRuntime,
  harnessState,
  compatSubagentRuntime,
  harnessInventoryRuntime,
  mappedTheme,
  handleHarnessLoadFilePreview,
  handleFileClick,
  shellChromeRuntime,
  handleActivateTeamWorkbench,
  chatToolPreferences,
}: UseWorkspaceInputbarSceneRuntimeParams) {
  const resolvedQueuedTurns = queuedTurns ?? [];
  const resolvedChatToolPreferences =
    chatToolPreferences ?? DEFAULT_CHAT_TOOL_PREFERENCES;
  const handleInputbarToolStatesChange = useCallback(
    (
      nextToolStates: Pick<
        ChatToolPreferences,
        "webSearch" | "thinking" | "subagent"
      >,
    ) => {
      setChatToolPreferences((previous) => ({
        ...previous,
        ...nextToolStates,
      }));
    },
    [setChatToolPreferences],
  );
  const dockLayoutMode = layoutMode === "chat" ? "chat" : "chat-canvas";
  const latestTurnPrompt =
    turns.find((turn) => turn.id === currentTurnId)?.prompt_text?.trim() ||
    turns[turns.length - 1]?.prompt_text?.trim() ||
    "";

  return useWorkspaceInputbarScenePresentation({
    setMentionedCharacters,
    taskFiles,
    taskFilesExpanded,
    setTaskFilesExpanded,
    selectedFileId,
    isThemeWorkbench,
    inputbarPresentation: {
      teamWorkbench: {
        shellVisible: resolvedChatToolPreferences.subagent,
        currentSessionId: sessionId,
        currentSessionName: teamSessionRuntime.currentSessionTitle,
        currentSessionRuntimeStatus:
          teamSessionRuntime.currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus:
          teamSessionRuntime.currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount: resolvedQueuedTurns.length,
        childSubagentSessions,
        subagentParentContext,
        liveRuntimeBySessionId: teamSessionRuntime.liveRuntimeBySessionId,
        liveActivityBySessionId: teamSessionRuntime.liveActivityBySessionId,
        activityRefreshVersionBySessionId:
          teamSessionRuntime.activityRefreshVersionBySessionId,
        onSendSubagentInput: teamSessionControlRuntime.handleSendSubagentInput,
        onWaitSubagentSession:
          teamSessionControlRuntime.handleWaitSubagentSession,
        onWaitActiveTeamSessions:
          teamSessionControlRuntime.handleWaitActiveTeamSessions,
        onCloseCompletedTeamSessions:
          teamSessionControlRuntime.handleCloseCompletedTeamSessions,
        onCloseSubagentSession:
          teamSessionControlRuntime.handleCloseSubagentSession,
        onResumeSubagentSession:
          teamSessionControlRuntime.handleResumeSubagentSession,
        onOpenSubagentSession: handleOpenSubagentSession,
        onReturnToParentSession: handleReturnToParentSession,
        teamWaitSummary: teamSessionControlRuntime.teamWaitSummary,
        teamControlSummary: teamSessionControlRuntime.teamControlSummary,
        selectedTeamLabel,
        selectedTeamSummary,
        selectedTeamRoles: selectedTeam?.roles,
        teamDispatchPreviewState,
      },
      inputbar: {
        input,
        setInput,
        contextVariant,
        variant: isThemeWorkbench ? "workspace" : "default",
        workflowGate: isThemeWorkbench ? currentGate : null,
        workflowSteps: isThemeWorkbench
          ? generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps
          : steps,
        workflowRunState,
        onSend: handleSend,
        onStop: teamSessionControlRuntime.handleStopSending,
        isLoading: isSending || resolvedQueuedTurns.length > 0,
        providerType,
        setProviderType,
        model,
        setModel,
        executionRuntime: sessionExecutionRuntime,
        executionStrategy,
        setExecutionStrategy,
        accessMode,
        setAccessMode,
        activeTheme,
        onManageProviders: navigationActions.handleManageProviders,
        selectedTeam,
        onSelectTeam: handleSelectTeam,
        onEnableSuggestedTeam: handleEnableSuggestedTeam,
        disabled: !projectId || isPreparingSend,
        onTaskFileClick: handleTaskFileClick,
        characters,
        skills,
        serviceSkills,
        serviceSkillGroups,
        isSkillsLoading: skillsLoading,
        onSelectServiceSkill,
        toolStates: {
          webSearch: resolvedChatToolPreferences.webSearch,
          thinking: resolvedChatToolPreferences.thinking,
          subagent: resolvedChatToolPreferences.subagent,
        },
        onToolStatesChange: handleInputbarToolStatesChange,
        onNavigateToSettings: handleNavigateToSkillSettings,
        onRefreshSkills: handleRefreshSkills,
        queuedTurns: resolvedQueuedTurns,
        onPromoteQueuedTurn: promoteQueuedTurn
          ? async (queuedTurnId: string) => {
              return Boolean(await promoteQueuedTurn(queuedTurnId));
            }
          : undefined,
        onRemoveQueuedTurn: removeQueuedTurn,
      },
      floatingTeamWorkspaceDock: {
        enabled: teamSessionRuntime.showTeamWorkspaceBoard,
        layoutMode: dockLayoutMode,
        showFloatingInputOverlay:
          shellChromeRuntime.shouldShowGeneralWorkbenchFloatingInputOverlay,
        onActivateWorkbench: handleActivateTeamWorkbench,
      },
      generalWorkbenchEntryPrompt,
      onRestartGeneralWorkbenchEntryPrompt:
        handleRestartGeneralWorkbenchEntryPrompt,
      onContinueGeneralWorkbenchEntryPrompt:
        handleContinueGeneralWorkbenchEntryPrompt,
      generalWorkbenchDialog: {
        enabled: generalWorkbenchEnabled && !isThemeWorkbench,
        open: contextHarnessRuntime.harnessPanelVisible,
        onOpenChange: contextHarnessRuntime.setHarnessPanelVisible,
        harnessState,
        compatSubagentRuntime,
        environment: contextHarnessRuntime.harnessEnvironment,
        childSubagentSessions,
        selectedTeamLabel,
        selectedTeamSummary,
        selectedTeamRoles: selectedTeam?.roles,
        teamMemorySnapshot,
        threadRead,
        turns,
        threadItems,
        currentTurnId,
        pendingActions,
        submittedActionsInFlight,
        messages,
        queuedTurns: resolvedQueuedTurns,
        canInterrupt: isSending,
        onInterruptCurrentTurn: teamSessionControlRuntime.handleStopSending,
        onResumeThread: resumeThread,
        onReplayPendingRequest:
          latestAssistantMessageId && replayPendingAction
            ? (requestId: string) =>
                replayPendingAction(requestId, latestAssistantMessageId)
            : undefined,
        onPromoteQueuedTurn: promoteQueuedTurn,
        onOpenMemoryWorkbench:
          sessionIdForDiagnostics && projectRootPath
            ? () =>
                navigationActions.handleOpenRuntimeMemoryWorkbench({
                  sessionId: sessionIdForDiagnostics,
                  workingDir: projectRootPath,
                  userMessage: latestTurnPrompt,
                })
            : undefined,
        diagnosticRuntimeContext: {
          sessionId: sessionIdForDiagnostics,
          workspaceId: projectId,
          workingDir: projectRootPath || null,
          providerType:
            activeExecutionRuntime?.provider_selector || providerType || null,
          model: activeExecutionRuntime?.model_name || model || null,
          executionStrategy: executionStrategy || null,
          activeTheme: activeTheme || null,
          selectedTeamLabel: selectedTeamLabel || null,
        },
        toolInventory: harnessInventoryRuntime.toolInventory,
        toolInventoryLoading: harnessInventoryRuntime.toolInventoryLoading,
        toolInventoryError: harnessInventoryRuntime.toolInventoryError,
        onRefreshToolInventory: harnessInventoryRuntime.refreshToolInventory,
        activeTheme: mappedTheme,
        toolPreferences: resolvedChatToolPreferences,
        isSending,
        executionRuntime: sessionExecutionRuntime,
        isExecutionRuntimeActive: Boolean(activeExecutionRuntime),
        runtimeStatusTitle: contextHarnessRuntime.activeRuntimeStatusTitle,
        selectedTeamRoleCount: selectedTeam?.roles.length || 0,
        onOpenSubagentSession: handleOpenSubagentSession,
        onLoadFilePreview: handleHarnessLoadFilePreview,
        onOpenFile: handleFileClick,
      },
    },
  });
}
