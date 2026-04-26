import type { ComponentProps, ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { ChatSidebar } from "../components/ChatSidebar";
import { buildWorkspaceChatSidebarProps } from "./chatSurfaceProps";
import {
  GeneralWorkbenchLeftExpandButton,
  PageContainer,
} from "./WorkspaceStyles";

interface WorkspaceShellSceneProps {
  compactChrome: boolean;
  isThemeWorkbench: boolean;
  generalWorkbenchSidebarNode: ReactNode;
  showChatPanel: boolean;
  showSidebar: boolean;
  showGeneralWorkbenchLeftExpandButton: boolean;
  onExpandGeneralWorkbenchSidebar: () => void;
  mainAreaNode: ReactNode;
  sidebarContextVariant?: ComponentProps<typeof ChatSidebar>["contextVariant"];
  currentTopicId: ComponentProps<typeof ChatSidebar>["currentTopicId"];
  topics: ComponentProps<typeof ChatSidebar>["topics"];
  onNewChat: ComponentProps<typeof ChatSidebar>["onNewChat"];
  onOpenTaskCenterHome?: ComponentProps<typeof ChatSidebar>["onOpenTaskCenterHome"];
  onOpenSkillsPage?: ComponentProps<typeof ChatSidebar>["onOpenSkillsPage"];
  onOpenMemoryPage?: ComponentProps<typeof ChatSidebar>["onOpenMemoryPage"];
  onSwitchTopic: ComponentProps<typeof ChatSidebar>["onSwitchTopic"];
  onOpenArchivedTopic?: ComponentProps<typeof ChatSidebar>["onOpenArchivedTopic"];
  onResumeTask: ComponentProps<typeof ChatSidebar>["onResumeTask"];
  onDeleteTopic: ComponentProps<typeof ChatSidebar>["onDeleteTopic"];
  onRenameTopic: ComponentProps<typeof ChatSidebar>["onRenameTopic"];
  currentMessages: ComponentProps<typeof ChatSidebar>["currentMessages"];
  isSending: ComponentProps<typeof ChatSidebar>["isSending"];
  pendingActionCount: number;
  queuedTurnCount: number;
  threadStatus?: ComponentProps<typeof ChatSidebar>["threadStatus"];
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
  onOpenTaskCenterHome,
  onOpenSkillsPage,
  onOpenMemoryPage,
  onSwitchTopic,
  onOpenArchivedTopic,
  onResumeTask,
  onDeleteTopic,
  onRenameTopic,
  currentMessages,
  isSending,
  pendingActionCount,
  queuedTurnCount,
  threadStatus,
  workspaceError,
  childSubagentSessions,
  subagentParentContext,
  onOpenSubagentSession,
  onReturnToParentSession,
}: WorkspaceShellSceneProps) {
  const shouldRenderChatSidebar =
    !isThemeWorkbench &&
    showChatPanel &&
    showSidebar &&
    sidebarContextVariant !== "task-center";
  const chatSidebarProps =
    shouldRenderChatSidebar
      ? buildWorkspaceChatSidebarProps({
          contextVariant: sidebarContextVariant,
          onNewChat,
          onOpenTaskCenterHome,
          onOpenSkillsPage,
          onOpenMemoryPage,
          topics,
          currentTopicId,
          onSwitchTopic,
          onOpenArchivedTopic,
          onResumeTask,
          onDeleteTopic,
          onRenameTopic,
          currentMessages,
          isSending,
          pendingActionCount,
          queuedTurnCount,
          threadStatus,
          workspaceError,
          childSubagentSessions,
          subagentParentContext,
          onOpenSubagentSession,
          onReturnToParentSession,
        })
      : null;

  return (
    <PageContainer $compact={compactChrome}>
      {isThemeWorkbench ? (
        generalWorkbenchSidebarNode
      ) : shouldRenderChatSidebar && chatSidebarProps ? (
        <ChatSidebar {...chatSidebarProps} />
      ) : null}
      {showGeneralWorkbenchLeftExpandButton ? (
        <GeneralWorkbenchLeftExpandButton
          type="button"
          aria-label="展开上下文侧栏"
          onClick={onExpandGeneralWorkbenchSidebar}
          title="展开上下文侧栏"
        >
          <PanelLeftOpen size={14} />
        </GeneralWorkbenchLeftExpandButton>
      ) : null}

      {mainAreaNode}
    </PageContainer>
  );
}
