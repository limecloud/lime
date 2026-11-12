import { Children, type ReactNode } from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import { LayoutTransition } from "@/components/workspace/layout/LayoutTransition";
import {
  MainArea,
  GeneralWorkbenchInputOverlay,
  GeneralWorkbenchLayoutShell,
} from "./WorkspaceStyles";

interface WorkspaceMainAreaProps {
  compactChrome: boolean;
  mainToolbar?: ReactNode;
  mainTabLabel?: string;
  sidePanelTabStrip?: ReactNode;
  inlineMainToolbar?: boolean;
  inlineSidePanelTabs?: boolean;
  taskCenterShellPanelNode?: ReactNode;
  contentSyncNoticeNode: ReactNode;
  shellBottomInset: string;
  layoutMode: LayoutMode;
  forceCanvasMode: boolean;
  chatContent: ReactNode;
  canvasContent: ReactNode;
  rightSurfaceContent?: ReactNode;
  rightSurfaceOpen: boolean;
  chatPanelWidth?: string;
  generalWorkbenchDialog: ReactNode;
  showFloatingInputOverlay: boolean;
  hasPendingA2UIForm: boolean;
  inputbarNode: ReactNode;
  inputContentShift?: number;
}

export function WorkspaceMainArea({
  compactChrome,
  mainToolbar,
  mainTabLabel,
  sidePanelTabStrip,
  inlineMainToolbar = false,
  inlineSidePanelTabs = false,
  taskCenterShellPanelNode,
  contentSyncNoticeNode,
  shellBottomInset,
  layoutMode,
  forceCanvasMode,
  chatContent,
  canvasContent,
  rightSurfaceContent,
  rightSurfaceOpen,
  chatPanelWidth,
  generalWorkbenchDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
  inputbarNode,
  inputContentShift = 0,
}: WorkspaceMainAreaProps) {
  const hasRightSurfaceContent = Children.count(rightSurfaceContent) > 0;
  const showRightSurface = hasRightSurfaceContent && rightSurfaceOpen;
  const useRightSurfaceWidth = showRightSurface && !chatPanelWidth;
  const effectiveCanvasContent = hasRightSurfaceContent ? (
    <>
      <div hidden={!showRightSurface} className="h-full min-h-0 min-w-0">
        {rightSurfaceContent}
      </div>
      {!showRightSurface ? canvasContent : null}
    </>
  ) : (
    canvasContent
  );
  const effectiveLayoutMode = hasPendingA2UIForm
    ? "chat"
    : showRightSurface
      ? "chat-canvas"
      : forceCanvasMode
        ? "canvas"
        : layoutMode;

  return (
    <MainArea
      $compact={compactChrome}
      $taskCenterSurface
      data-testid="workspace-main-area"
      data-layout-mode={effectiveLayoutMode}
      data-has-right-surface={showRightSurface ? "true" : "false"}
      data-floating-input-overlay={showFloatingInputOverlay ? "true" : "false"}
    >
      {contentSyncNoticeNode}
      <GeneralWorkbenchLayoutShell
        $bottomInset={shellBottomInset}
        $taskCenterSurface
      >
        <LayoutTransition
          mode={effectiveLayoutMode}
          mainToolbar={mainToolbar}
          mainTabLabel={mainTabLabel}
          sidePanelTabStrip={showRightSurface ? sidePanelTabStrip : undefined}
          inlineMainToolbar={inlineMainToolbar}
          inlineSidePanelTabs={inlineSidePanelTabs}
          chatContent={chatContent}
          canvasContent={effectiveCanvasContent}
          chatPanelWidth={chatPanelWidth}
          contentPaneDefaultWidth={useRightSurfaceWidth ? 600 : undefined}
          forceOpenChatPanel={hasPendingA2UIForm}
        />
      </GeneralWorkbenchLayoutShell>
      {generalWorkbenchDialog}
      {showFloatingInputOverlay ? (
        <GeneralWorkbenchInputOverlay
          style={{ transform: `translateX(${inputContentShift}px)` }}
          $bottomInset={shellBottomInset}
          data-testid="general-workbench-input-overlay"
          data-action-owner="composer"
          data-bottom-inset={shellBottomInset}
        >
          {inputbarNode}
        </GeneralWorkbenchInputOverlay>
      ) : null}
      {taskCenterShellPanelNode}
    </MainArea>
  );
}
