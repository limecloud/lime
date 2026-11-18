import { Children, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PanelRight, X } from "lucide-react";
import { HeaderAction } from "@/components/app-shell/AppShell";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import { LayoutTransition } from "@/components/workspace/layout/LayoutTransition";
import { HomeNewTabSurface } from "./home-new-tab/HomeNewTabSurface";
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
  showHomeNewTab?: boolean;
  homeNewTabWorkspaceRoot?: string | null;
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
  showHomeNewTab = false,
  homeNewTabWorkspaceRoot = null,
}: WorkspaceMainAreaProps) {
  const { t } = useTranslation("workspace");
  const { t: tAgent } = useTranslation("agent");
  const [homeNewTabOpen, setHomeNewTabOpen] = useState(false);
  const hasRightSurfaceContent = Children.count(rightSurfaceContent) > 0;
  const showRightSurface = hasRightSurfaceContent && rightSurfaceOpen;
  const homeNewTabActive = showHomeNewTab && homeNewTabOpen;
  const effectiveRightSurfaceContent = homeNewTabActive ? (
    <HomeNewTabSurface workspaceRoot={homeNewTabWorkspaceRoot} />
  ) : (
    rightSurfaceContent
  );
  const useRightSurfaceWidth =
    (showRightSurface || homeNewTabActive) && !chatPanelWidth;
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
    : showRightSurface || homeNewTabActive
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
          mainToolbar={
            homeNewTabActive ? (
              <div
                className="flex h-full items-center rounded-md px-2 text-[13px]"
                role="tab"
                aria-selected="true"
              >
                {t("workspace.layout.compactMode.chat")}
              </div>
            ) : (
              mainToolbar
            )
          }
          mainTabLabel={
            homeNewTabActive
              ? t("workspace.layout.compactMode.chat")
              : mainTabLabel
          }
          sidePanelTabStrip={
            homeNewTabActive ? (
              <div
                className="flex h-full items-center gap-1 rounded-md px-2 text-[13px]"
                style={{ marginRight: "auto" }}
                role="tab"
                aria-selected="true"
              >
                <span>{tAgent("agentChat.homeNewTab.tabTitle")}</span>
                <button
                  type="button"
                  aria-label={t("workspace.artifactToolbar.action.close")}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
                  onClick={() => setHomeNewTabOpen(false)}
                >
                  <X size={13} />
                </button>
              </div>
            ) : showRightSurface ? (
              sidePanelTabStrip
            ) : undefined
          }
          inlineMainToolbar={homeNewTabActive ? false : inlineMainToolbar}
          inlineSidePanelTabs={
            homeNewTabActive ? false : inlineSidePanelTabs
          }
          chatContent={chatContent}
          canvasContent={homeNewTabActive ? effectiveRightSurfaceContent : effectiveCanvasContent}
          chatPanelWidth={chatPanelWidth}
          contentPaneDefaultWidth={
            useRightSurfaceWidth ? (homeNewTabActive ? 600 : 280) : undefined
          }
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
      {showHomeNewTab ? (
        <HeaderAction
          actionId="home-new-tab"
          align="end"
          slotPosition="right"
          order={400}
        >
          <button
            type="button"
            aria-label={tAgent("agentChat.homeNewTab.new")}
            title={tAgent("agentChat.homeNewTab.new")}
            aria-expanded={homeNewTabOpen}
            onClick={() => setHomeNewTabOpen((open) => !open)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
            data-testid="home-new-tab-toggle"
          >
            <PanelRight size={16} />
          </button>
        </HeaderAction>
      ) : null}
    </MainArea>
  );
}
