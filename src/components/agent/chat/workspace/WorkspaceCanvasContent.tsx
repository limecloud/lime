import type { ComponentProps, ReactNode } from "react";
import { CanvasWorkbenchLayout } from "../components/CanvasWorkbenchLayout";

interface WorkspaceCanvasContentProps {
  liveCanvasPreview: ReactNode;
  currentImageWorkbenchActive: boolean;
  shouldShowCanvasLoadingState: boolean;
  teamWorkbenchView: ComponentProps<typeof CanvasWorkbenchLayout>["teamView"];
  canvasWorkbenchLayoutProps: Omit<
    ComponentProps<typeof CanvasWorkbenchLayout>,
    "teamView"
  >;
}

export function WorkspaceCanvasContent({
  liveCanvasPreview,
  currentImageWorkbenchActive,
  shouldShowCanvasLoadingState,
  teamWorkbenchView,
  canvasWorkbenchLayoutProps,
}: WorkspaceCanvasContentProps) {
  if (!liveCanvasPreview && !teamWorkbenchView) {
    return null;
  }

  if (currentImageWorkbenchActive) {
    return liveCanvasPreview;
  }

  if (!teamWorkbenchView && shouldShowCanvasLoadingState) {
    return liveCanvasPreview;
  }

  return (
    <CanvasWorkbenchLayout
      {...canvasWorkbenchLayoutProps}
      teamView={teamWorkbenchView}
    />
  );
}
