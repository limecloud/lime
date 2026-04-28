import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  AutoHideNavbarBackdrop,
  AutoHideNavbarHandle,
  AutoHideNavbarHost,
  AutoHideNavbarPanel,
  LayoutTransitionRenderGate,
  MainArea,
  GeneralWorkbenchInputOverlay,
  GeneralWorkbenchLayoutShell,
} from "./WorkspaceStyles";
import { TASK_CENTER_CHROME_RAIL_SURFACE } from "./taskCenterChromeTokens";

interface WorkspaceMainAreaProps {
  compactChrome: boolean;
  navbarNode: ReactNode;
  autoHideTaskCenterNavbar?: boolean;
  taskCenterTabsNode?: ReactNode;
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
  autoHideTaskCenterNavbar = false,
  taskCenterTabsNode,
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
  const [navbarOpen, setNavbarOpen] = useState(false);
  const effectiveLayoutMode = hasPendingA2UIForm
    ? "chat"
    : forceCanvasMode
      ? "canvas"
      : layoutMode;
  const shouldAutoHideNavbar =
    autoHideTaskCenterNavbar &&
    Boolean(navbarNode) &&
    Boolean(taskCenterTabsNode);
  const isAutoHideNavbarVisible = shouldAutoHideNavbar && navbarOpen;
  const shouldRenderRevealHandle =
    shouldAutoHideNavbar && !isAutoHideNavbarVisible;
  const taskCenterChromeNode =
    !shouldAutoHideNavbar && taskCenterTabsNode ? (
      <div
        className="relative z-20 shrink-0 overflow-visible bg-[color:var(--lime-chrome-rail)] dark:bg-slate-900"
        data-testid="task-center-chrome-shell"
        style={{ background: TASK_CENTER_CHROME_RAIL_SURFACE }}
      >
        {navbarNode}
        {taskCenterTabsNode}
      </div>
    ) : null;

  return (
    <MainArea
      $compact={compactChrome}
      $taskCenterSurface={Boolean(taskCenterChromeNode)}
    >
      {shouldAutoHideNavbar ? (
        <AutoHideNavbarBackdrop
          type="button"
          $visible={isAutoHideNavbarVisible}
          data-testid="workspace-navbar-backdrop"
          data-visible={isAutoHideNavbarVisible ? "true" : "false"}
          aria-label="关闭顶部工具"
          onClick={() => {
            setNavbarOpen(false);
          }}
        />
      ) : null}
      {shouldAutoHideNavbar ? (
        <AutoHideNavbarHost
          data-testid="workspace-navbar-auto-hide-shell"
          data-visible={isAutoHideNavbarVisible ? "true" : "false"}
        >
          {shouldRenderRevealHandle ? (
            <AutoHideNavbarHandle
              type="button"
              $visible={isAutoHideNavbarVisible}
              data-testid="workspace-navbar-reveal-handle"
              aria-label="展开顶部工具"
              aria-expanded={isAutoHideNavbarVisible}
              onClick={() => {
                setNavbarOpen(true);
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </AutoHideNavbarHandle>
          ) : null}
          <AutoHideNavbarPanel
            $visible={isAutoHideNavbarVisible}
            data-testid="workspace-navbar-auto-hide-panel"
            data-visible={isAutoHideNavbarVisible ? "true" : "false"}
          >
            {navbarNode}
          </AutoHideNavbarPanel>
        </AutoHideNavbarHost>
      ) : taskCenterChromeNode ? (
        taskCenterChromeNode
      ) : (
        navbarNode
      )}
      {shouldAutoHideNavbar ? taskCenterTabsNode : null}
      {contentSyncNoticeNode}
      <GeneralWorkbenchLayoutShell
        $bottomInset={shellBottomInset}
        $taskCenterSurface={Boolean(taskCenterChromeNode)}
      >
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
