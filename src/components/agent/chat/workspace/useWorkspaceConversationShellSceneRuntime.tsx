import { useWorkspaceCanvasSceneRuntime } from "./useWorkspaceCanvasSceneRuntime";
import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import { useWorkspaceConversationSceneRuntime } from "./useWorkspaceConversationSceneRuntime";
import { useWorkspaceConversationSendRuntime } from "./useWorkspaceConversationSendRuntime";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import { useWorkspaceShellChromeRuntime } from "./useWorkspaceShellChromeRuntime";
import { useWorkspaceShellSceneRuntime } from "./useWorkspaceShellSceneRuntime";
import { useWorkspaceTeamSessionRuntime } from "./useWorkspaceTeamSessionRuntime";
import { useWorkspaceGeneralWorkbenchShellRuntime } from "./useWorkspaceGeneralWorkbenchShellRuntime";

type NavigationActions = ReturnType<typeof useWorkspaceNavigationActions>;
type InputbarScene = ReturnType<typeof useWorkspaceInputbarSceneRuntime>;
type CanvasScene = ReturnType<typeof useWorkspaceCanvasSceneRuntime>;
type ShellChromeRuntime = ReturnType<typeof useWorkspaceShellChromeRuntime>;
type GeneralWorkbenchShellRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchShellRuntime
>;
type ContextHarnessRuntime = ReturnType<
  typeof useWorkspaceContextHarnessRuntime
>;
type TeamSessionRuntime = ReturnType<typeof useWorkspaceTeamSessionRuntime>;
type ConversationSendRuntimeParams = Parameters<
  typeof useWorkspaceConversationSendRuntime
>[0];
type ConversationSceneRuntimeParams = Parameters<
  typeof useWorkspaceConversationSceneRuntime
>[0];
type ShellSceneRuntimeParams = Parameters<
  typeof useWorkspaceShellSceneRuntime
>[0];
type ConversationSceneBridgeParams = Omit<
  ConversationSceneRuntimeParams,
  | "navigationActions"
  | "inputbarScene"
  | "canvasScene"
  | "conversationSendRuntime"
  | "shellChromeRuntime"
  | "generalWorkbenchHarnessDialog"
  | "generalCanvasContent"
  | "projectId"
  | "projectCharacters"
  | "handleToggleHarnessPanel"
  | "showTeamWorkspaceBoard"
  | "currentImageWorkbenchActive"
  | "projectRootPath"
>;

interface UseWorkspaceConversationShellSceneRuntimeParams extends ConversationSceneBridgeParams {
  navigationActions: NavigationActions;
  inputbarScene: InputbarScene;
  canvasScene: CanvasScene;
  shellChromeRuntime: ShellChromeRuntime;
  generalWorkbenchShellRuntime: GeneralWorkbenchShellRuntime;
  contextHarnessRuntime: Pick<
    ContextHarnessRuntime,
    "handleToggleHarnessPanel"
  >;
  teamSessionRuntime: Pick<TeamSessionRuntime, "showTeamWorkspaceBoard">;
  currentImageWorkbenchState: { active: boolean };
  project: { rootPath?: string | null } | null;
  projectId: string | null | undefined;
  sidebarContextVariant?: "default" | "task-center";
  generalCanvasState: { content: string };
  projectMemory: {
    characters?: ConversationSceneRuntimeParams["projectCharacters"];
  } | null;
  handleSend: ConversationSendRuntimeParams["handleSend"];
  showSidebar: ShellSceneRuntimeParams["showSidebar"];
  topics: ShellSceneRuntimeParams["topics"];
  switchTopic: ShellSceneRuntimeParams["switchTopic"];
  handleResumeSidebarTask: ShellSceneRuntimeParams["handleResumeSidebarTask"];
  deleteTopic: ShellSceneRuntimeParams["deleteTopic"];
  renameTopic: ShellSceneRuntimeParams["renameTopic"];
  childSubagentSessions: ShellSceneRuntimeParams["childSubagentSessions"];
  subagentParentContext: ShellSceneRuntimeParams["subagentParentContext"];
  handleReturnToParentSession: ShellSceneRuntimeParams["handleReturnToParentSession"];
}

export function useWorkspaceConversationShellSceneRuntime({
  navigationActions,
  inputbarScene,
  canvasScene,
  shellChromeRuntime,
  generalWorkbenchShellRuntime,
  contextHarnessRuntime,
  teamSessionRuntime,
  currentImageWorkbenchState,
  project,
  projectId,
  sidebarContextVariant = "default",
  projectMemory,
  handleSend,
  showSidebar,
  topics,
  switchTopic,
  handleResumeSidebarTask,
  deleteTopic,
  renameTopic,
  childSubagentSessions,
  subagentParentContext,
  handleReturnToParentSession,
  ...conversationScene
}: UseWorkspaceConversationShellSceneRuntimeParams) {
  const conversationSendRuntime = useWorkspaceConversationSendRuntime({
    chatToolPreferences: conversationScene.chatToolPreferences,
    handleSend,
  });

  const conversationSceneRuntime = useWorkspaceConversationSceneRuntime({
    ...conversationScene,
    navigationActions,
    inputbarScene,
    canvasScene,
    conversationSendRuntime,
    shellChromeRuntime,
    generalWorkbenchHarnessDialog:
      generalWorkbenchShellRuntime.generalWorkbenchHarnessDialog,
    generalCanvasContent: conversationScene.generalCanvasState.content,
    projectId: projectId ?? null,
    projectCharacters: projectMemory?.characters || [],
    handleToggleHarnessPanel: contextHarnessRuntime.handleToggleHarnessPanel,
    showTeamWorkspaceBoard: teamSessionRuntime.showTeamWorkspaceBoard,
    currentImageWorkbenchActive: currentImageWorkbenchState.active,
    projectRootPath: project?.rootPath || null,
  });

  const pendingActions = conversationScene.pendingActions ?? [];
  const queuedTurns = conversationScene.queuedTurns ?? [];
  const handleBackHome = conversationScene.handleBackHome ?? (() => undefined);
  const handleOpenSubagentSession =
    conversationScene.handleOpenSubagentSession ?? (() => undefined);
  const displayMessages = conversationScene.displayMessages ?? [];
  const isSending = conversationScene.isSending ?? false;

  return useWorkspaceShellSceneRuntime({
    compactChrome: shellChromeRuntime.isWorkspaceCompactChrome,
    isThemeWorkbench: conversationScene.isThemeWorkbench,
    showChatPanel: conversationScene.showChatPanel,
    showSidebar,
    sidebarContextVariant,
    generalWorkbenchShellRuntime,
    conversationSceneRuntime,
    sessionId: conversationScene.sessionId,
    topics,
    handleBackHome,
    switchTopic,
    handleResumeSidebarTask,
    deleteTopic,
    renameTopic,
    displayMessages,
    isSending,
    pendingActionCount: pendingActions.length,
    queuedTurnCount: queuedTurns.length,
    childSubagentSessions,
    subagentParentContext,
    handleOpenSubagentSession,
    handleReturnToParentSession,
  });
}
