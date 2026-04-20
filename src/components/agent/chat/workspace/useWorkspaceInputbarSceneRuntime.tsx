import {
  useCallback,
  useMemo,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Info } from "lucide-react";
import styled from "styled-components";
import type { Character } from "@/lib/api/memory";
import type { AgentInitialInputCapabilityParams } from "@/types/page";
import { Inputbar } from "../components/Inputbar";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import type { Message } from "../types";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { TaskFile } from "../components/TaskFiles";
import {
  DEFAULT_CHAT_TOOL_PREFERENCES,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";
import {
  deriveRuntimeToolAvailability,
  type RuntimeToolAvailability,
} from "../utils/runtimeToolAvailability";
import { resolveCanvasTaskFileTarget } from "../utils/taskFileCanvasSync";
import { isRenderableTaskFile } from "./generalWorkbenchHelpers";
import { GeneralWorkbenchDialogSection } from "./WorkspaceHarnessDialogs";
import type { TeamWorkbenchSurfaceProps } from "./chatSurfaceProps";
import type { GeneralWorkbenchEntryPromptState } from "./workspaceSendHelpers";
import type { CuratedTaskReferenceEntry } from "../utils/curatedTaskReferenceSelection";

interface GeneralWorkbenchEntryPromptAccessoryProps {
  prompt: GeneralWorkbenchEntryPromptState;
  onRestart: () => void;
  onContinue: () => Promise<void> | void;
}

const GeneralWorkbenchEntryPromptCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: min(360px, calc(100vw - 48px));
  max-width: min(420px, calc(100vw - 48px));
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(191, 219, 254, 0.92);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.98) 0%,
    rgba(239, 246, 255, 0.96) 100%
  );
  color: #0f172a;
  box-shadow: 0 18px 34px -28px rgba(15, 23, 42, 0.26);
`;

const GeneralWorkbenchEntryPromptHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

const GeneralWorkbenchEntryPromptTitleWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const GeneralWorkbenchEntryPromptTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
`;

const GeneralWorkbenchEntryPromptDescription = styled.span`
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
`;

const GeneralWorkbenchEntryPromptActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const GeneralWorkbenchEntryPromptButton = styled.button<{
  $variant?: "primary" | "ghost";
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "ghost"
        ? "rgba(191, 219, 254, 0.92)"
        : "rgba(59, 130, 246, 0.94)"};
  background: ${({ $variant }) =>
    $variant === "ghost"
      ? "rgba(255, 255, 255, 0.92)"
      : "linear-gradient(180deg, rgba(59,130,246,0.96) 0%, rgba(37,99,235,0.96) 100%)"};
  color: ${({ $variant }) => ($variant === "ghost" ? "#1e293b" : "#eff6ff")};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px -18px rgba(37, 99, 235, 0.46);
    background: ${({ $variant }) =>
      $variant === "ghost"
        ? "rgba(239, 246, 255, 0.98)"
        : "linear-gradient(180deg, rgba(37,99,235,0.98) 0%, rgba(29,78,216,0.98) 100%)"};
  }
`;

function renderGeneralWorkbenchEntryPromptAccessory({
  prompt,
  onRestart,
  onContinue,
}: GeneralWorkbenchEntryPromptAccessoryProps): ReactNode {
  return (
    <GeneralWorkbenchEntryPromptCard data-testid="theme-workbench-entry-prompt">
      <GeneralWorkbenchEntryPromptHeader>
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <GeneralWorkbenchEntryPromptTitleWrap>
          <GeneralWorkbenchEntryPromptTitle>
            {prompt.title}
          </GeneralWorkbenchEntryPromptTitle>
          <GeneralWorkbenchEntryPromptDescription>
            {prompt.description}
          </GeneralWorkbenchEntryPromptDescription>
        </GeneralWorkbenchEntryPromptTitleWrap>
      </GeneralWorkbenchEntryPromptHeader>
      <GeneralWorkbenchEntryPromptActions>
        <GeneralWorkbenchEntryPromptButton
          type="button"
          $variant="ghost"
          data-testid="theme-workbench-entry-restart"
          onClick={onRestart}
        >
          重新开始
        </GeneralWorkbenchEntryPromptButton>
        <GeneralWorkbenchEntryPromptButton
          type="button"
          data-testid="theme-workbench-entry-continue"
          onClick={() => {
            void onContinue();
          }}
        >
          {prompt.actionLabel}
        </GeneralWorkbenchEntryPromptButton>
      </GeneralWorkbenchEntryPromptActions>
    </GeneralWorkbenchEntryPromptCard>
  );
}

type WorkspaceInputbarBuilderParams = Omit<
  ComponentProps<typeof Inputbar>,
  "overlayAccessory"
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
interface FloatingTeamWorkspaceDockParams {
  enabled: boolean;
  layoutMode: "chat" | "chat-canvas";
  showFloatingInputOverlay: boolean;
  onActivateWorkbench: NonNullable<
    ComponentProps<typeof TeamWorkspaceDock>["onActivateWorkbench"]
  >;
}

interface UseWorkspaceInputbarScenePresentationRuntimeParams {
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  taskFiles: TaskFile[];
  taskFilesExpanded: boolean;
  setTaskFilesExpanded: Dispatch<SetStateAction<boolean>>;
  selectedFileId?: string;
  isThemeWorkbench: boolean;
  inputbarPresentation: {
    teamWorkbench: WorkspaceTeamWorkbenchSurfaceParams;
    inputbar: Omit<
      WorkspaceInputbarBuilderParams,
      | "taskFiles"
      | "selectedFileId"
      | "taskFilesExpanded"
      | "onToggleTaskFiles"
      | "onSelectCharacter"
    >;
    floatingTeamWorkspaceDock: FloatingTeamWorkspaceDockParams;
    generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
    onRestartGeneralWorkbenchEntryPrompt: () => void;
    onContinueGeneralWorkbenchEntryPrompt: () => Promise<void> | void;
    generalWorkbenchDialog: ComponentProps<
      typeof GeneralWorkbenchDialogSection
    >;
  };
}
interface WorkspaceInputbarScenePresentationRuntimeResult {
  visibleTaskFiles: TaskFile[];
  visibleSelectedFileId?: string;
  activeCanvasTaskFile: TaskFile | null;
  teamWorkbenchSurfaceProps: TeamWorkbenchSurfaceProps;
  inputbarNode: ReactNode;
  generalWorkbenchDialog: ReactNode;
  runtimeToolAvailability: RuntimeToolAvailability | null | undefined;
}
type InputbarScenePresentationParams =
  UseWorkspaceInputbarScenePresentationRuntimeParams;
type InputbarPresentationParams =
  InputbarScenePresentationParams["inputbarPresentation"];
type TeamWorkbenchParams = InputbarPresentationParams["teamWorkbench"];
type InputbarParams = InputbarPresentationParams["inputbar"];
type GeneralWorkbenchDialogParams =
  InputbarPresentationParams["generalWorkbenchDialog"];
type NavigationActions = ReturnType<typeof useWorkspaceNavigationActions>;

function useWorkspaceInputbarScenePresentationRuntime({
  setMentionedCharacters,
  taskFiles,
  taskFilesExpanded,
  setTaskFilesExpanded,
  selectedFileId,
  isThemeWorkbench,
  inputbarPresentation,
}: UseWorkspaceInputbarScenePresentationRuntimeParams): WorkspaceInputbarScenePresentationRuntimeResult {
  const handleSelectCharacter = useCallback(
    (character: Character) => {
      setMentionedCharacters((previous) => {
        if (previous.find((item) => item.id === character.id)) {
          return previous;
        }
        return [...previous, character];
      });
    },
    [setMentionedCharacters],
  );

  const handleToggleTaskFiles = useCallback(() => {
    setTaskFilesExpanded((previous) => !previous);
  }, [setTaskFilesExpanded]);

  const visibleTaskFiles = useMemo(
    () =>
      taskFiles.filter((file) => isRenderableTaskFile(file, isThemeWorkbench)),
    [isThemeWorkbench, taskFiles],
  );

  const visibleSelectedFileId = useMemo(() => {
    if (!selectedFileId) {
      return undefined;
    }
    return visibleTaskFiles.some((file) => file.id === selectedFileId)
      ? selectedFileId
      : undefined;
  }, [selectedFileId, visibleTaskFiles]);

  const activeCanvasTaskFile = useMemo(
    () =>
      resolveCanvasTaskFileTarget(visibleTaskFiles, visibleSelectedFileId)
        .targetFile,
    [visibleSelectedFileId, visibleTaskFiles],
  );

  const teamWorkbenchSurfaceProps = useMemo<TeamWorkbenchSurfaceProps>(
    () => ({
      shellVisible: inputbarPresentation.teamWorkbench.shellVisible,
      currentSessionId: inputbarPresentation.teamWorkbench.currentSessionId,
      currentSessionName: inputbarPresentation.teamWorkbench.currentSessionName,
      currentSessionRuntimeStatus:
        inputbarPresentation.teamWorkbench.currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus:
        inputbarPresentation.teamWorkbench.currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount:
        inputbarPresentation.teamWorkbench.currentSessionQueuedTurnCount,
      childSubagentSessions:
        inputbarPresentation.teamWorkbench.childSubagentSessions,
      subagentParentContext:
        inputbarPresentation.teamWorkbench.subagentParentContext,
      liveRuntimeBySessionId:
        inputbarPresentation.teamWorkbench.liveRuntimeBySessionId,
      liveActivityBySessionId:
        inputbarPresentation.teamWorkbench.liveActivityBySessionId,
      activityRefreshVersionBySessionId:
        inputbarPresentation.teamWorkbench.activityRefreshVersionBySessionId,
      onSendSubagentInput:
        inputbarPresentation.teamWorkbench.onSendSubagentInput,
      onWaitSubagentSession:
        inputbarPresentation.teamWorkbench.onWaitSubagentSession,
      onWaitActiveTeamSessions:
        inputbarPresentation.teamWorkbench.onWaitActiveTeamSessions,
      onCloseCompletedTeamSessions:
        inputbarPresentation.teamWorkbench.onCloseCompletedTeamSessions,
      onCloseSubagentSession:
        inputbarPresentation.teamWorkbench.onCloseSubagentSession,
      onResumeSubagentSession:
        inputbarPresentation.teamWorkbench.onResumeSubagentSession,
      onOpenSubagentSession:
        inputbarPresentation.teamWorkbench.onOpenSubagentSession,
      onReturnToParentSession:
        inputbarPresentation.teamWorkbench.onReturnToParentSession,
      teamWaitSummary: inputbarPresentation.teamWorkbench.teamWaitSummary,
      teamControlSummary: inputbarPresentation.teamWorkbench.teamControlSummary,
      selectedTeamLabel: inputbarPresentation.teamWorkbench.selectedTeamLabel,
      selectedTeamSummary:
        inputbarPresentation.teamWorkbench.selectedTeamSummary,
      selectedTeamRoles: inputbarPresentation.teamWorkbench.selectedTeamRoles,
      teamDispatchPreviewState:
        inputbarPresentation.teamWorkbench.teamDispatchPreviewState,
    }),
    [inputbarPresentation.teamWorkbench],
  );

  const generalWorkbenchEntryPromptAccessory = useMemo(
    () =>
      inputbarPresentation.generalWorkbenchEntryPrompt
        ? renderGeneralWorkbenchEntryPromptAccessory({
            prompt: inputbarPresentation.generalWorkbenchEntryPrompt,
            onRestart:
              inputbarPresentation.onRestartGeneralWorkbenchEntryPrompt,
            onContinue:
              inputbarPresentation.onContinueGeneralWorkbenchEntryPrompt,
          })
        : null,
    [
      inputbarPresentation.generalWorkbenchEntryPrompt,
      inputbarPresentation.onContinueGeneralWorkbenchEntryPrompt,
      inputbarPresentation.onRestartGeneralWorkbenchEntryPrompt,
    ],
  );

  const floatingTeamWorkspaceDockProps = useMemo<ComponentProps<
    typeof TeamWorkspaceDock
  > | null>(
    () =>
      !inputbarPresentation.floatingTeamWorkspaceDock.enabled ||
      !inputbarPresentation.floatingTeamWorkspaceDock
        .showFloatingInputOverlay ||
      inputbarPresentation.floatingTeamWorkspaceDock.layoutMode !== "chat"
        ? null
        : {
            placement: "inline",
            onActivateWorkbench:
              inputbarPresentation.floatingTeamWorkspaceDock
                .onActivateWorkbench,
            ...teamWorkbenchSurfaceProps,
          },
    [inputbarPresentation.floatingTeamWorkspaceDock, teamWorkbenchSurfaceProps],
  );

  const workspaceInputbarProps = useMemo<WorkspaceInputbarBuilderParams>(
    () => ({
      ...inputbarPresentation.inputbar,
      taskFiles: visibleTaskFiles,
      selectedFileId: visibleSelectedFileId,
      taskFilesExpanded,
      onToggleTaskFiles: handleToggleTaskFiles,
      onSelectCharacter: handleSelectCharacter,
    }),
    [
      handleSelectCharacter,
      handleToggleTaskFiles,
      inputbarPresentation.inputbar,
      taskFilesExpanded,
      visibleSelectedFileId,
      visibleTaskFiles,
    ],
  );

  const overlayAccessory =
    generalWorkbenchEntryPromptAccessory || floatingTeamWorkspaceDockProps ? (
      <>
        {generalWorkbenchEntryPromptAccessory}
        {floatingTeamWorkspaceDockProps ? (
          <TeamWorkspaceDock {...floatingTeamWorkspaceDockProps} />
        ) : null}
      </>
    ) : undefined;
  const inputbarNode = (
    <Inputbar {...workspaceInputbarProps} overlayAccessory={overlayAccessory} />
  );
  const generalWorkbenchDialog = (
    <GeneralWorkbenchDialogSection
      {...inputbarPresentation.generalWorkbenchDialog}
    />
  );

  return {
    visibleTaskFiles,
    visibleSelectedFileId,
    activeCanvasTaskFile,
    teamWorkbenchSurfaceProps,
    inputbarNode,
    generalWorkbenchDialog,
    runtimeToolAvailability:
      inputbarPresentation.generalWorkbenchDialog.runtimeToolAvailability,
  };
}

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
  currentSessionTitle: TeamWorkbenchParams["currentSessionName"];
  currentSessionRuntimeStatus: TeamWorkbenchParams["currentSessionRuntimeStatus"];
  currentSessionLatestTurnStatus: TeamWorkbenchParams["currentSessionLatestTurnStatus"];
  liveRuntimeBySessionId: TeamWorkbenchParams["liveRuntimeBySessionId"];
  liveActivityBySessionId: TeamWorkbenchParams["liveActivityBySessionId"];
  activityRefreshVersionBySessionId: TeamWorkbenchParams["activityRefreshVersionBySessionId"];
  handleSendSubagentInput: TeamWorkbenchParams["onSendSubagentInput"];
  handleWaitSubagentSession: TeamWorkbenchParams["onWaitSubagentSession"];
  handleWaitActiveTeamSessions: TeamWorkbenchParams["onWaitActiveTeamSessions"];
  handleCloseCompletedTeamSessions: TeamWorkbenchParams["onCloseCompletedTeamSessions"];
  handleCloseSubagentSession: TeamWorkbenchParams["onCloseSubagentSession"];
  handleResumeSubagentSession: TeamWorkbenchParams["onResumeSubagentSession"];
  teamWaitSummary: TeamWorkbenchParams["teamWaitSummary"];
  teamControlSummary: TeamWorkbenchParams["teamControlSummary"];
  handleStopSending: InputbarParams["onStop"];
  teamWorkspaceEnabled: FloatingTeamWorkspaceDockParams["enabled"];
  handleOpenSubagentSession: TeamWorkbenchParams["onOpenSubagentSession"];
  handleReturnToParentSession: TeamWorkbenchParams["onReturnToParentSession"];
  input: InputbarParams["input"];
  setInput: InputbarParams["setInput"];
  currentGate: InputbarParams["workflowGate"];
  generalWorkbenchWorkflowSteps: InputbarParams["workflowSteps"];
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
  initialInputCapability?: AgentInitialInputCapabilityParams;
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
  harnessPanelVisible: GeneralWorkbenchDialogParams["open"];
  setHarnessPanelVisible: GeneralWorkbenchDialogParams["onOpenChange"];
  harnessState: GeneralWorkbenchDialogParams["harnessState"];
  harnessEnvironment: GeneralWorkbenchDialogParams["environment"];
  toolInventory: GeneralWorkbenchDialogParams["toolInventory"];
  toolInventoryLoading: GeneralWorkbenchDialogParams["toolInventoryLoading"];
  toolInventoryError: GeneralWorkbenchDialogParams["toolInventoryError"];
  refreshToolInventory: GeneralWorkbenchDialogParams["onRefreshToolInventory"];
  mappedTheme: GeneralWorkbenchDialogParams["activeTheme"];
  activeRuntimeStatusTitle: GeneralWorkbenchDialogParams["runtimeStatusTitle"];
  handleHarnessLoadFilePreview: GeneralWorkbenchDialogParams["onLoadFilePreview"];
  handleFileClick: GeneralWorkbenchDialogParams["onOpenFile"];
  showGeneralWorkbenchFloatingInputOverlay: FloatingTeamWorkspaceDockParams["showFloatingInputOverlay"];
  handleActivateTeamWorkbench: FloatingTeamWorkspaceDockParams["onActivateWorkbench"];
  chatToolPreferences?: ChatToolPreferences;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
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
  currentSessionTitle,
  currentSessionRuntimeStatus,
  currentSessionLatestTurnStatus,
  liveRuntimeBySessionId,
  liveActivityBySessionId,
  activityRefreshVersionBySessionId,
  handleSendSubagentInput,
  handleWaitSubagentSession,
  handleWaitActiveTeamSessions,
  handleCloseCompletedTeamSessions,
  handleCloseSubagentSession,
  handleResumeSubagentSession,
  teamWaitSummary,
  teamControlSummary,
  handleStopSending,
  teamWorkspaceEnabled,
  handleOpenSubagentSession,
  handleReturnToParentSession,
  input,
  setInput,
  currentGate,
  generalWorkbenchWorkflowSteps,
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
  initialInputCapability,
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
  harnessPanelVisible,
  setHarnessPanelVisible,
  harnessState,
  harnessEnvironment,
  toolInventory,
  toolInventoryLoading,
  toolInventoryError,
  refreshToolInventory,
  mappedTheme,
  activeRuntimeStatusTitle,
  handleHarnessLoadFilePreview,
  handleFileClick,
  showGeneralWorkbenchFloatingInputOverlay,
  handleActivateTeamWorkbench,
  chatToolPreferences,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
}: UseWorkspaceInputbarSceneRuntimeParams) {
  const resolvedQueuedTurns = useMemo(() => queuedTurns ?? [], [queuedTurns]);
  const resolvedChatToolPreferences =
    chatToolPreferences ?? DEFAULT_CHAT_TOOL_PREFERENCES;
  const runtimeToolAvailability = useMemo(
    () => deriveRuntimeToolAvailability(toolInventory),
    [toolInventory],
  );
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
  const resolvedTurns = useMemo(() => turns ?? [], [turns]);
  const latestTurnPrompt =
    resolvedTurns
      .find((turn) => turn.id === currentTurnId)
      ?.prompt_text?.trim() ||
    resolvedTurns[resolvedTurns.length - 1]?.prompt_text?.trim() ||
    "";

  return useWorkspaceInputbarScenePresentationRuntime({
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
        currentSessionName: currentSessionTitle,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount: resolvedQueuedTurns.length,
        childSubagentSessions,
        subagentParentContext,
        liveRuntimeBySessionId,
        liveActivityBySessionId,
        activityRefreshVersionBySessionId,
        onSendSubagentInput: handleSendSubagentInput,
        onWaitSubagentSession: handleWaitSubagentSession,
        onWaitActiveTeamSessions: handleWaitActiveTeamSessions,
        onCloseCompletedTeamSessions: handleCloseCompletedTeamSessions,
        onCloseSubagentSession: handleCloseSubagentSession,
        onResumeSubagentSession: handleResumeSubagentSession,
        onOpenSubagentSession: handleOpenSubagentSession,
        onReturnToParentSession: handleReturnToParentSession,
        teamWaitSummary,
        teamControlSummary,
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
        projectId,
        sessionId,
        workflowGate: isThemeWorkbench ? currentGate : null,
        workflowSteps: isThemeWorkbench ? generalWorkbenchWorkflowSteps : steps,
        workflowRunState,
        onSend: handleSend,
        onStop: handleStopSending,
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
        initialInputCapability,
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
        defaultCuratedTaskReferenceMemoryIds,
        defaultCuratedTaskReferenceEntries,
      },
      floatingTeamWorkspaceDock: {
        enabled: teamWorkspaceEnabled,
        layoutMode: dockLayoutMode,
        showFloatingInputOverlay: showGeneralWorkbenchFloatingInputOverlay,
        onActivateWorkbench: handleActivateTeamWorkbench,
      },
      generalWorkbenchEntryPrompt,
      onRestartGeneralWorkbenchEntryPrompt:
        handleRestartGeneralWorkbenchEntryPrompt,
      onContinueGeneralWorkbenchEntryPrompt:
        handleContinueGeneralWorkbenchEntryPrompt,
      generalWorkbenchDialog: {
        enabled: generalWorkbenchEnabled && !isThemeWorkbench,
        open: harnessPanelVisible,
        onOpenChange: setHarnessPanelVisible,
        harnessState,
        environment: harnessEnvironment,
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
        onInterruptCurrentTurn: handleStopSending,
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
        toolInventory,
        toolInventoryLoading,
        toolInventoryError,
        onRefreshToolInventory: refreshToolInventory,
        activeTheme: mappedTheme,
        toolPreferences: resolvedChatToolPreferences,
        runtimeToolAvailability,
        isSending,
        executionRuntime: sessionExecutionRuntime,
        isExecutionRuntimeActive: Boolean(activeExecutionRuntime),
        runtimeStatusTitle: activeRuntimeStatusTitle,
        selectedTeamRoleCount: selectedTeam?.roles.length || 0,
        onOpenSubagentSession: handleOpenSubagentSession,
        onLoadFilePreview: handleHarnessLoadFilePreview,
        onOpenFile: handleFileClick,
      },
    },
  });
}
