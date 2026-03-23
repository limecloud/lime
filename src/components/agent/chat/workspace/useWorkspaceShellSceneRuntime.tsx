import type { ComponentProps } from "react";
import { WorkspaceShellScene } from "./WorkspaceShellScene";
import { useWorkspaceConversationSceneRuntime } from "./useWorkspaceConversationSceneRuntime";
import { useWorkspaceThemeWorkbenchShellRuntime } from "./useWorkspaceThemeWorkbenchShellRuntime";

type ThemeWorkbenchShellRuntime = ReturnType<
  typeof useWorkspaceThemeWorkbenchShellRuntime
>;
type ConversationSceneRuntime = ReturnType<
  typeof useWorkspaceConversationSceneRuntime
>;
type WorkspaceShellSceneProps = ComponentProps<typeof WorkspaceShellScene>;

interface UseWorkspaceShellSceneRuntimeParams {
  compactChrome: boolean;
  isThemeWorkbench: boolean;
  showChatPanel: boolean;
  showSidebar: boolean;
  themeWorkbenchShellRuntime: ThemeWorkbenchShellRuntime;
  conversationSceneRuntime: ConversationSceneRuntime;
  sessionId?: WorkspaceShellSceneProps["currentTopicId"];
  topics: WorkspaceShellSceneProps["topics"];
  handleBackHome: WorkspaceShellSceneProps["onNewChat"];
  switchTopic: WorkspaceShellSceneProps["onSwitchTopic"];
  handleResumeSidebarTask: WorkspaceShellSceneProps["onResumeTask"];
  deleteTopic: WorkspaceShellSceneProps["onDeleteTopic"];
  renameTopic: WorkspaceShellSceneProps["onRenameTopic"];
  displayMessages: WorkspaceShellSceneProps["currentMessages"];
  isSending: WorkspaceShellSceneProps["isSending"];
  pendingActionCount: number;
  queuedTurnCount: number;
  childSubagentSessions: WorkspaceShellSceneProps["childSubagentSessions"];
  subagentParentContext: WorkspaceShellSceneProps["subagentParentContext"];
  handleOpenSubagentSession: WorkspaceShellSceneProps["onOpenSubagentSession"];
  handleReturnToParentSession: WorkspaceShellSceneProps["onReturnToParentSession"];
}

export function useWorkspaceShellSceneRuntime({
  compactChrome,
  isThemeWorkbench,
  showChatPanel,
  showSidebar,
  themeWorkbenchShellRuntime,
  conversationSceneRuntime,
  sessionId,
  topics,
  handleBackHome,
  switchTopic,
  handleResumeSidebarTask,
  deleteTopic,
  renameTopic,
  displayMessages,
  isSending,
  pendingActionCount,
  queuedTurnCount,
  childSubagentSessions,
  subagentParentContext,
  handleOpenSubagentSession,
  handleReturnToParentSession,
}: UseWorkspaceShellSceneRuntimeParams) {
  return {
    shellSceneNode: (
      <WorkspaceShellScene
        compactChrome={compactChrome}
        isThemeWorkbench={isThemeWorkbench}
        themeWorkbenchSidebarNode={themeWorkbenchShellRuntime.themeWorkbenchSidebarNode}
        showChatPanel={showChatPanel}
        showSidebar={showSidebar}
        showThemeWorkbenchLeftExpandButton={
          themeWorkbenchShellRuntime.showThemeWorkbenchLeftExpandButton
        }
        onExpandThemeWorkbenchSidebar={
          themeWorkbenchShellRuntime.onExpandThemeWorkbenchSidebar
        }
        mainAreaNode={conversationSceneRuntime.mainAreaNode}
        currentTopicId={sessionId ?? null}
        topics={topics}
        onNewChat={handleBackHome}
        onSwitchTopic={switchTopic}
        onResumeTask={handleResumeSidebarTask}
        onDeleteTopic={deleteTopic}
        onRenameTopic={renameTopic}
        currentMessages={displayMessages}
        isSending={isSending}
        pendingActionCount={pendingActionCount}
        queuedTurnCount={queuedTurnCount}
        workspaceError={conversationSceneRuntime.workspaceAlertVisible}
        childSubagentSessions={childSubagentSessions}
        subagentParentContext={subagentParentContext}
        onOpenSubagentSession={handleOpenSubagentSession}
        onReturnToParentSession={handleReturnToParentSession}
      />
    ),
  };
}
