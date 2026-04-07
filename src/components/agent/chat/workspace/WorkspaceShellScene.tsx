import type { ComponentProps } from "react";
import { ChatSidebar } from "../components/ChatSidebar";
import { buildWorkspaceChatSidebarProps } from "./chatSurfaceProps";
import { WorkspacePageShell } from "./WorkspacePageShell";

type WorkspacePageShellProps = Omit<
  ComponentProps<typeof WorkspacePageShell>,
  "chatSidebarProps"
>;

interface WorkspaceShellSceneProps extends WorkspacePageShellProps {
  sidebarContextVariant?: ComponentProps<typeof ChatSidebar>["contextVariant"];
  currentTopicId: ComponentProps<typeof ChatSidebar>["currentTopicId"];
  topics: ComponentProps<typeof ChatSidebar>["topics"];
  onNewChat: ComponentProps<typeof ChatSidebar>["onNewChat"];
  onSwitchTopic: ComponentProps<typeof ChatSidebar>["onSwitchTopic"];
  onResumeTask: ComponentProps<typeof ChatSidebar>["onResumeTask"];
  onDeleteTopic: ComponentProps<typeof ChatSidebar>["onDeleteTopic"];
  onRenameTopic: ComponentProps<typeof ChatSidebar>["onRenameTopic"];
  currentMessages: ComponentProps<typeof ChatSidebar>["currentMessages"];
  isSending: ComponentProps<typeof ChatSidebar>["isSending"];
  pendingActionCount: number;
  queuedTurnCount: number;
  workspaceError: boolean;
  childSubagentSessions: ComponentProps<
    typeof ChatSidebar
  >["childSubagentSessions"];
  subagentParentContext: ComponentProps<
    typeof ChatSidebar
  >["subagentParentContext"];
  onOpenSubagentSession: ComponentProps<
    typeof ChatSidebar
  >["onOpenSubagentSession"];
  onReturnToParentSession: ComponentProps<
    typeof ChatSidebar
  >["onReturnToParentSession"];
}

export function WorkspaceShellScene({
  compactChrome,
  isThemeWorkbench,
  generalWorkbenchSidebarNode,
  showChatPanel,
  showSidebar,
  showGeneralWorkbenchLeftExpandButton,
  onExpandGeneralWorkbenchSidebar,
  mainAreaNode,
  sidebarContextVariant = "default",
  currentTopicId,
  topics,
  onNewChat,
  onSwitchTopic,
  onResumeTask,
  onDeleteTopic,
  onRenameTopic,
  currentMessages,
  isSending,
  pendingActionCount,
  queuedTurnCount,
  workspaceError,
  childSubagentSessions,
  subagentParentContext,
  onOpenSubagentSession,
  onReturnToParentSession,
}: WorkspaceShellSceneProps) {
  const chatSidebarProps =
    !isThemeWorkbench && showChatPanel && showSidebar
      ? buildWorkspaceChatSidebarProps({
          contextVariant: sidebarContextVariant,
          onNewChat,
          topics,
          currentTopicId,
          onSwitchTopic,
          onResumeTask,
          onDeleteTopic,
          onRenameTopic,
          currentMessages,
          isSending,
          pendingActionCount,
          queuedTurnCount,
          workspaceError,
          childSubagentSessions,
          subagentParentContext,
          onOpenSubagentSession,
          onReturnToParentSession,
        })
      : null;

  return (
    <WorkspacePageShell
      compactChrome={compactChrome}
      isThemeWorkbench={isThemeWorkbench}
      generalWorkbenchSidebarNode={generalWorkbenchSidebarNode}
      showChatPanel={showChatPanel}
      showSidebar={showSidebar}
      chatSidebarProps={chatSidebarProps}
      showGeneralWorkbenchLeftExpandButton={showGeneralWorkbenchLeftExpandButton}
      onExpandGeneralWorkbenchSidebar={onExpandGeneralWorkbenchSidebar}
      mainAreaNode={mainAreaNode}
    />
  );
}
