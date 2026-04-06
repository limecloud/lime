import type { ComponentProps, ReactNode } from "react";
import { PanelLeftOpen } from "lucide-react";
import { ChatSidebar } from "../components/ChatSidebar";
import { PageContainer, GeneralWorkbenchLeftExpandButton } from "./WorkspaceStyles";

interface WorkspacePageShellProps {
  compactChrome: boolean;
  isThemeWorkbench: boolean;
  generalWorkbenchSidebarNode: ReactNode;
  showChatPanel: boolean;
  showSidebar: boolean;
  chatSidebarProps: ComponentProps<typeof ChatSidebar> | null;
  showGeneralWorkbenchLeftExpandButton: boolean;
  onExpandGeneralWorkbenchSidebar: () => void;
  mainAreaNode: ReactNode;
}

export function WorkspacePageShell({
  compactChrome,
  isThemeWorkbench,
  generalWorkbenchSidebarNode,
  showChatPanel,
  showSidebar,
  chatSidebarProps,
  showGeneralWorkbenchLeftExpandButton,
  onExpandGeneralWorkbenchSidebar,
  mainAreaNode,
}: WorkspacePageShellProps) {
  return (
    <PageContainer $compact={compactChrome}>
      {isThemeWorkbench ? (
        generalWorkbenchSidebarNode
      ) : showChatPanel && showSidebar && chatSidebarProps ? (
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
