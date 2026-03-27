import type { ComponentProps, ReactNode } from "react";
import {
  ArtifactCanvasOverlay,
  ArtifactRenderer,
  ArtifactToolbar,
} from "@/components/artifact";
import { CanvasFactory } from "@/components/content-creator/canvas/CanvasFactory";
import type { ThemeType } from "@/components/content-creator/types";
import {
  CanvasPanel as GeneralCanvasPanel,
  type CanvasState as GeneralCanvasState,
} from "@/components/general-chat/bridge";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasWorkbenchDefaultPreview } from "../components/CanvasWorkbenchLayout";
import { ImageWorkbenchCanvas } from "../components/ImageWorkbenchCanvas";
import { TeamWorkspaceBoard } from "../components/TeamWorkspaceBoard";
import { ArtifactWorkbenchShell } from "./ArtifactWorkbenchShell";
import { wrapPreviewWithWorkbenchTrigger } from "./workbenchPreviewHelpers";
import { resolveArtifactProtocolDocumentPayload } from "@/lib/artifact-protocol";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { AgentThreadItem } from "../types";

interface ArtifactWorkbenchPreviewProps {
  artifact: Artifact;
  currentCanvasArtifact: Artifact | null;
  displayedCanvasArtifact: Artifact | null;
  artifactOverlay:
    | ComponentProps<typeof ArtifactCanvasOverlay>["overlay"]
    | null;
  showPreviousVersionBadge: boolean;
  artifactViewMode: ComponentProps<typeof ArtifactToolbar>["viewMode"];
  onArtifactViewModeChange: NonNullable<
    ComponentProps<typeof ArtifactToolbar>["onViewModeChange"]
  >;
  artifactPreviewSize: ComponentProps<typeof ArtifactToolbar>["previewSize"];
  onArtifactPreviewSizeChange: NonNullable<
    ComponentProps<typeof ArtifactToolbar>["onPreviewSizeChange"]
  >;
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
  onCloseCanvas: () => void;
  stackedWorkbenchTrigger?: ReactNode;
  renderToolbarActions?: (params: {
    artifact: Artifact;
    document: ArtifactDocumentV1 | null;
  }) => ReactNode;
}

export function ArtifactWorkbenchPreview({
  artifact,
  currentCanvasArtifact,
  displayedCanvasArtifact,
  artifactOverlay,
  showPreviousVersionBadge,
  artifactViewMode,
  onArtifactViewModeChange,
  artifactPreviewSize,
  onArtifactPreviewSizeChange,
  onSaveArtifactDocument,
  threadItems,
  focusedBlockId,
  blockFocusRequestKey,
  onJumpToTimelineItem,
  onCloseCanvas,
  stackedWorkbenchTrigger,
  renderToolbarActions,
}: ArtifactWorkbenchPreviewProps) {
  const isLiveSelectedArtifact =
    currentCanvasArtifact?.id === artifact.id &&
    displayedCanvasArtifact !== null;
  const toolbarArtifact =
    isLiveSelectedArtifact && currentCanvasArtifact
      ? currentCanvasArtifact
      : artifact;
  const previewArtifact =
    isLiveSelectedArtifact && displayedCanvasArtifact
      ? displayedCanvasArtifact
      : artifact;
  const isBrowserAssistArtifact = previewArtifact.type === "browser_assist";
  const isArtifactStreaming = Boolean(
    isLiveSelectedArtifact &&
    currentCanvasArtifact &&
    displayedCanvasArtifact &&
    currentCanvasArtifact.id === displayedCanvasArtifact.id &&
    currentCanvasArtifact.id === previewArtifact.id &&
    currentCanvasArtifact.status === "streaming",
  );
  const artifactDocument = resolveArtifactProtocolDocumentPayload({
    content: previewArtifact.content,
    metadata: previewArtifact.meta,
  });
  const combinedActionsSlot = (
    <>
      {renderToolbarActions?.({
        artifact: previewArtifact,
        document: artifactDocument,
      })}
      {stackedWorkbenchTrigger}
    </>
  );

  if (isBrowserAssistArtifact) {
    return wrapPreviewWithWorkbenchTrigger(
      <div className="relative h-full min-h-0 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)]">
        <ArtifactRenderer
          artifact={previewArtifact}
          isStreaming={isArtifactStreaming}
          hideToolbar={true}
          viewMode={artifactViewMode}
          previewSize={artifactPreviewSize}
          tone="light"
        />
        {isLiveSelectedArtifact && artifactOverlay ? (
          <ArtifactCanvasOverlay overlay={artifactOverlay} />
        ) : null}
      </div>,
      stackedWorkbenchTrigger,
    );
  }

  if (artifactDocument) {
    return (
      <ArtifactWorkbenchShell
        artifact={previewArtifact}
        artifactOverlay={isLiveSelectedArtifact ? artifactOverlay : null}
        isStreaming={isArtifactStreaming}
        showPreviousVersionBadge={
          isLiveSelectedArtifact && showPreviousVersionBadge
        }
        viewMode={artifactViewMode}
        onViewModeChange={onArtifactViewModeChange}
        previewSize={artifactPreviewSize}
        onPreviewSizeChange={onArtifactPreviewSizeChange}
        onSaveArtifactDocument={onSaveArtifactDocument}
        threadItems={threadItems}
        focusedBlockId={focusedBlockId}
        blockFocusRequestKey={blockFocusRequestKey}
        onJumpToTimelineItem={onJumpToTimelineItem}
        onCloseCanvas={onCloseCanvas}
        actionsSlot={combinedActionsSlot}
      />
    );
  }

  return (
    <div className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ArtifactToolbar
          artifact={toolbarArtifact}
          onClose={onCloseCanvas}
          isStreaming={Boolean(
            isLiveSelectedArtifact &&
            currentCanvasArtifact?.status === "streaming",
          )}
          viewMode={artifactViewMode}
          onViewModeChange={onArtifactViewModeChange}
          previewSize={artifactPreviewSize}
          onPreviewSizeChange={onArtifactPreviewSizeChange}
          tone="light"
          displayBadgeLabel={
            isLiveSelectedArtifact && showPreviousVersionBadge
              ? "预览上一版本"
              : undefined
          }
          actionsSlot={combinedActionsSlot}
        />
        <div className="relative flex-1 overflow-auto bg-white">
          <ArtifactRenderer
            artifact={previewArtifact}
            isStreaming={isArtifactStreaming}
            hideToolbar={true}
            viewMode={artifactViewMode}
            previewSize={artifactPreviewSize}
            tone="light"
          />
          {isLiveSelectedArtifact && artifactOverlay ? (
            <ArtifactCanvasOverlay overlay={artifactOverlay} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface WorkspaceLiveCanvasPreviewProps {
  currentImageWorkbenchActive: boolean;
  imageWorkbenchProps: ComponentProps<typeof ImageWorkbenchCanvas>;
  canvasRenderTheme: ThemeType;
  liveArtifact: Artifact | null;
  hasDisplayedLiveArtifact: boolean;
  renderArtifactPreview: (
    artifact: Artifact,
    stackedWorkbenchTrigger?: ReactNode,
  ) => ReactNode;
  generalCanvasPanelProps: Omit<
    ComponentProps<typeof GeneralCanvasPanel>,
    "toolbarActions"
  > | null;
  shouldShowCanvasLoadingState: boolean;
  canvasLoadingLabel: string;
  canvasFactoryProps: ComponentProps<typeof CanvasFactory> | null;
  stackedWorkbenchTrigger?: ReactNode;
}

export function WorkspaceLiveCanvasPreview({
  currentImageWorkbenchActive,
  imageWorkbenchProps,
  canvasRenderTheme,
  liveArtifact,
  hasDisplayedLiveArtifact,
  renderArtifactPreview,
  generalCanvasPanelProps,
  shouldShowCanvasLoadingState,
  canvasLoadingLabel,
  canvasFactoryProps,
  stackedWorkbenchTrigger,
}: WorkspaceLiveCanvasPreviewProps) {
  if (currentImageWorkbenchActive) {
    return wrapPreviewWithWorkbenchTrigger(
      <ImageWorkbenchCanvas {...imageWorkbenchProps} />,
      stackedWorkbenchTrigger,
    );
  }

  if (
    canvasRenderTheme === "general" &&
    liveArtifact &&
    hasDisplayedLiveArtifact
  ) {
    return renderArtifactPreview(liveArtifact, stackedWorkbenchTrigger);
  }

  if (canvasRenderTheme === "general") {
    if (generalCanvasPanelProps?.state.isOpen) {
      return (
        <GeneralCanvasPanel
          {...generalCanvasPanelProps}
          toolbarActions={stackedWorkbenchTrigger}
        />
      );
    }
    return null;
  }

  if (shouldShowCanvasLoadingState) {
    return wrapPreviewWithWorkbenchTrigger(
      <div
        data-testid="canvas-loading-state"
        className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
      >
        {canvasLoadingLabel}
      </div>,
      stackedWorkbenchTrigger,
    );
  }

  if (!canvasFactoryProps) {
    return null;
  }

  return wrapPreviewWithWorkbenchTrigger(
    <CanvasFactory {...canvasFactoryProps} />,
    stackedWorkbenchTrigger,
  );
}

interface TeamWorkbenchPreviewProps {
  boardProps: ComponentProps<typeof TeamWorkspaceBoard>;
  stackedWorkbenchTrigger?: ReactNode;
}

export function TeamWorkbenchPreview({
  boardProps,
  stackedWorkbenchTrigger,
}: TeamWorkbenchPreviewProps) {
  return wrapPreviewWithWorkbenchTrigger(
    <div className="flex h-full min-h-0 flex-col overflow-hidden pt-4">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TeamWorkspaceBoard {...boardProps} />
      </div>
    </div>,
    stackedWorkbenchTrigger,
  );
}

export type { CanvasWorkbenchDefaultPreview };
export type { GeneralCanvasState };
