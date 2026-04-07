import type { ComponentProps, ReactNode } from "react";
import type { SyncStatus } from "../hooks/useContentSync";
import { ChatNavbar } from "../components/ChatNavbar";
import { WorkspaceCanvasContent } from "./WorkspaceCanvasContent";
import { WorkspaceContentSyncNotice } from "./WorkspaceContentSyncNotice";
import { WorkspaceMainArea } from "./WorkspaceMainArea";

type WorkspaceCanvasContentProps = ComponentProps<
  typeof WorkspaceCanvasContent
>;
type WorkspaceMainAreaProps = ComponentProps<typeof WorkspaceMainArea>;

interface WorkspaceMainSceneProps {
  chatNavbarProps: ComponentProps<typeof ChatNavbar> | null;
  isThemeWorkbench: boolean;
  contentId?: string;
  syncStatus: SyncStatus;
  hasLiveCanvasPreviewContent: boolean;
  liveCanvasPreview: ReactNode;
  currentImageWorkbenchActive: WorkspaceCanvasContentProps["currentImageWorkbenchActive"];
  shouldShowCanvasLoadingState: WorkspaceCanvasContentProps["shouldShowCanvasLoadingState"];
  teamWorkbenchView: WorkspaceCanvasContentProps["teamWorkbenchView"];
  canvasWorkbenchLayoutProps: WorkspaceCanvasContentProps["canvasWorkbenchLayoutProps"];
  compactChrome: WorkspaceMainAreaProps["compactChrome"];
  shellBottomInset: WorkspaceMainAreaProps["shellBottomInset"];
  layoutMode: WorkspaceMainAreaProps["layoutMode"];
  chatContent: WorkspaceMainAreaProps["chatContent"];
  chatPanelWidth?: WorkspaceMainAreaProps["chatPanelWidth"];
  chatPanelMinWidth?: WorkspaceMainAreaProps["chatPanelMinWidth"];
  generalWorkbenchDialog: WorkspaceMainAreaProps["generalWorkbenchDialog"];
  generalWorkbenchHarnessDialog: WorkspaceMainAreaProps["generalWorkbenchHarnessDialog"];
  showFloatingInputOverlay: WorkspaceMainAreaProps["showFloatingInputOverlay"];
  hasPendingA2UIForm: WorkspaceMainAreaProps["hasPendingA2UIForm"];
  inputbarNode: WorkspaceMainAreaProps["inputbarNode"];
}

export function WorkspaceMainScene({
  chatNavbarProps,
  isThemeWorkbench,
  contentId,
  syncStatus,
  hasLiveCanvasPreviewContent,
  liveCanvasPreview,
  currentImageWorkbenchActive,
  shouldShowCanvasLoadingState,
  teamWorkbenchView,
  canvasWorkbenchLayoutProps,
  compactChrome,
  shellBottomInset,
  layoutMode,
  chatContent,
  chatPanelWidth,
  chatPanelMinWidth,
  generalWorkbenchDialog,
  generalWorkbenchHarnessDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
  inputbarNode,
}: WorkspaceMainSceneProps) {
  const navbarNode = chatNavbarProps ? (
    <ChatNavbar {...chatNavbarProps} />
  ) : null;
  const contentSyncNoticeNode =
    !isThemeWorkbench && contentId && syncStatus !== "idle" ? (
      <WorkspaceContentSyncNotice status={syncStatus} />
    ) : null;
  const canvasContent = (
    <WorkspaceCanvasContent
      liveCanvasPreview={liveCanvasPreview}
      currentImageWorkbenchActive={currentImageWorkbenchActive}
      shouldShowCanvasLoadingState={shouldShowCanvasLoadingState}
      teamWorkbenchView={teamWorkbenchView}
      canvasWorkbenchLayoutProps={canvasWorkbenchLayoutProps}
    />
  );

  return (
    <WorkspaceMainArea
      compactChrome={compactChrome}
      navbarNode={navbarNode}
      contentSyncNoticeNode={contentSyncNoticeNode}
      shellBottomInset={shellBottomInset}
      layoutMode={layoutMode}
      forceCanvasMode={Boolean(
        isThemeWorkbench &&
        (hasLiveCanvasPreviewContent || Boolean(teamWorkbenchView)),
      )}
      chatContent={chatContent}
      canvasContent={canvasContent}
      chatPanelWidth={chatPanelWidth}
      chatPanelMinWidth={chatPanelMinWidth}
      generalWorkbenchDialog={generalWorkbenchDialog}
      generalWorkbenchHarnessDialog={generalWorkbenchHarnessDialog}
      showFloatingInputOverlay={showFloatingInputOverlay}
      hasPendingA2UIForm={hasPendingA2UIForm}
      inputbarNode={inputbarNode}
    />
  );
}
