import type { ReactNode } from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  LayoutTransitionRenderGate,
  MainArea,
  ThemeWorkbenchInputOverlay,
  ThemeWorkbenchLayoutShell,
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
  themeWorkbenchHarnessDialog: ReactNode;
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
  themeWorkbenchHarnessDialog,
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
      <ThemeWorkbenchLayoutShell $bottomInset={shellBottomInset}>
        <LayoutTransitionRenderGate
          mode={effectiveLayoutMode}
          chatContent={chatContent}
          canvasContent={canvasContent}
          chatPanelWidth={chatPanelWidth}
          chatPanelMinWidth={chatPanelMinWidth}
          forceOpenChatPanel={hasPendingA2UIForm}
        />
      </ThemeWorkbenchLayoutShell>
      {generalWorkbenchDialog}
      {themeWorkbenchHarnessDialog}
      {showFloatingInputOverlay ? (
        <ThemeWorkbenchInputOverlay>
          {inputbarNode}
        </ThemeWorkbenchInputOverlay>
      ) : null}
    </MainArea>
  );
}
