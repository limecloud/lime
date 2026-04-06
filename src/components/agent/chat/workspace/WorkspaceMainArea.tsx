import type { ReactNode } from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  LayoutTransitionRenderGate,
  MainArea,
  GeneralWorkbenchInputOverlay,
  GeneralWorkbenchLayoutShell,
} from "./WorkspaceStyles";

interface WorkspaceMainAreaProps {
  compactChrome: boolean;
  navbarNode: ReactNode;
  contentSyncNoticeNode: ReactNode;
  shellBottomInset: string;
  layoutMode: LayoutMode;
  forceCanvasMode: boolean;
  chatContent: ReactNode;
  canvasContent: ReactNode;
  chatPanelWidth?: string;
  chatPanelMinWidth?: string;
  generalWorkbenchDialog: ReactNode;
  generalWorkbenchHarnessDialog: ReactNode;
  showFloatingInputOverlay: boolean;
  hasPendingA2UIForm: boolean;
  inputbarNode: ReactNode;
}

export function WorkspaceMainArea({
  compactChrome,
  navbarNode,
  contentSyncNoticeNode,
  shellBottomInset,
  layoutMode,
  forceCanvasMode,
  chatContent,
  canvasContent,
  chatPanelWidth,
  chatPanelMinWidth,
  generalWorkbenchDialog,
  generalWorkbenchHarnessDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
  inputbarNode,
}: WorkspaceMainAreaProps) {
  const effectiveLayoutMode = hasPendingA2UIForm
    ? "chat"
    : forceCanvasMode
      ? "canvas"
      : layoutMode;

  return (
    <MainArea $compact={compactChrome}>
      {navbarNode}
      {contentSyncNoticeNode}
      <GeneralWorkbenchLayoutShell $bottomInset={shellBottomInset}>
        <LayoutTransitionRenderGate
          mode={effectiveLayoutMode}
          chatContent={chatContent}
          canvasContent={canvasContent}
          chatPanelWidth={chatPanelWidth}
          chatPanelMinWidth={chatPanelMinWidth}
          forceOpenChatPanel={hasPendingA2UIForm}
        />
      </GeneralWorkbenchLayoutShell>
      {generalWorkbenchDialog}
      {generalWorkbenchHarnessDialog}
      {showFloatingInputOverlay ? (
        <GeneralWorkbenchInputOverlay>
          {inputbarNode}
        </GeneralWorkbenchInputOverlay>
      ) : null}
    </MainArea>
  );
}
