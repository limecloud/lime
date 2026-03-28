import React, { memo } from "react";
import {
  ArtifactCanvasOverlay,
  ArtifactRenderer,
  ArtifactToolbar,
} from "@/components/artifact";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import { cn } from "@/lib/utils";
import type { AgentThreadItem } from "../types";
import {
  ArtifactWorkbenchDocumentInspector,
  ArtifactWorkbenchEditSurface,
  type ArtifactWorkbenchDocumentController,
  type ArtifactWorkbenchLayoutMode,
  useArtifactWorkbenchDocumentController,
} from "./artifactWorkbenchDocument";

interface ArtifactWorkbenchShellProps {
  artifact: Artifact;
  artifactOverlay: React.ComponentProps<typeof ArtifactCanvasOverlay>["overlay"] | null;
  isStreaming: boolean;
  showPreviousVersionBadge: boolean;
  viewMode: React.ComponentProps<typeof ArtifactToolbar>["viewMode"];
  onViewModeChange: NonNullable<
    React.ComponentProps<typeof ArtifactToolbar>["onViewModeChange"]
  >;
  previewSize: React.ComponentProps<typeof ArtifactToolbar>["previewSize"];
  onPreviewSizeChange: NonNullable<
    React.ComponentProps<typeof ArtifactToolbar>["onPreviewSizeChange"]
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
  actionsSlot?: React.ReactNode;
  layoutMode?: ArtifactWorkbenchLayoutMode;
  documentController?: ArtifactWorkbenchDocumentController | null;
}

function ArtifactWorkbenchShellLayout({
  artifact,
  artifactOverlay,
  isStreaming,
  showPreviousVersionBadge,
  viewMode,
  onViewModeChange,
  previewSize,
  onPreviewSizeChange,
  onCloseCanvas,
  actionsSlot,
  layoutMode = "full",
  controller,
}: Omit<
  ArtifactWorkbenchShellProps,
  | "onSaveArtifactDocument"
  | "threadItems"
  | "focusedBlockId"
  | "blockFocusRequestKey"
  | "onJumpToTimelineItem"
  | "documentController"
> & {
  controller: ArtifactWorkbenchDocumentController;
}) {
  const showInspector = layoutMode === "full";

  return (
    <div
      data-testid="artifact-workbench-shell"
      data-layout-mode={layoutMode}
      className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5"
    >
      <ArtifactToolbar
        artifact={artifact}
        onClose={onCloseCanvas}
        isStreaming={isStreaming}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        previewSize={previewSize}
        onPreviewSizeChange={onPreviewSizeChange}
        tone="light"
        displayBadgeLabel={showPreviousVersionBadge ? "预览上一版本" : undefined}
        actionsSlot={actionsSlot}
      />
      <div
        className={cn(
          "min-h-0 flex-1",
          showInspector
            ? controller.canEditDocument
              ? "grid lg:grid-cols-[minmax(0,1fr)_360px]"
              : "grid lg:grid-cols-[minmax(0,1fr)_320px]"
            : "flex flex-col",
        )}
      >
        <div
          ref={controller.rendererViewportRef as React.RefObject<HTMLDivElement>}
          className={cn(
            "relative min-h-0 bg-white",
            showInspector && "lg:border-r lg:border-slate-200",
            controller.inspectorTab === "edit" && controller.canEditDocument
              ? "overflow-hidden"
              : "overflow-auto",
          )}
        >
          {controller.inspectorTab === "edit" && controller.canEditDocument ? (
            <ArtifactWorkbenchEditSurface
              entry={controller.selectedEditableBlock}
              draft={controller.selectedEditableDraft}
              timelineLink={controller.selectedTimelineLink}
              isSaving={controller.isSavingEdit}
              isStreaming={isStreaming}
              onChange={controller.handleEditDraftChange}
              onSave={controller.handleEditSave}
              onCancel={controller.handleEditCancel}
              onJumpToTimelineItem={controller.onJumpToTimelineItem}
            />
          ) : (
            <>
              <ArtifactRenderer
                artifact={artifact}
                isStreaming={isStreaming}
                hideToolbar={true}
                viewMode={viewMode}
                previewSize={previewSize}
                tone="light"
              />
              {artifactOverlay ? <ArtifactCanvasOverlay overlay={artifactOverlay} /> : null}
            </>
          )}
        </div>
        {showInspector ? (
          <ArtifactWorkbenchDocumentInspector
            controller={controller}
            containerClassName="min-h-0 border-t border-slate-200 bg-slate-50/70 lg:border-t-0"
            tabsClassName="flex h-full min-h-0 flex-col p-4"
          />
        ) : null}
      </div>
    </div>
  );
}

const LocalArtifactWorkbenchShell = ({
  artifact,
  artifactOverlay,
  isStreaming,
  showPreviousVersionBadge,
  viewMode,
  onViewModeChange,
  previewSize,
  onPreviewSizeChange,
  onSaveArtifactDocument,
  threadItems = [],
  focusedBlockId = null,
  blockFocusRequestKey = 0,
  onJumpToTimelineItem,
  onCloseCanvas,
  actionsSlot,
  layoutMode = "full",
}: Omit<ArtifactWorkbenchShellProps, "documentController">) => {
  const controller = useArtifactWorkbenchDocumentController({
    artifact,
    onSaveArtifactDocument,
    threadItems,
    focusedBlockId,
    blockFocusRequestKey,
    onJumpToTimelineItem,
  });

  return (
    <ArtifactWorkbenchShellLayout
      artifact={artifact}
      artifactOverlay={artifactOverlay}
      isStreaming={isStreaming}
      showPreviousVersionBadge={showPreviousVersionBadge}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      previewSize={previewSize}
      onPreviewSizeChange={onPreviewSizeChange}
      onCloseCanvas={onCloseCanvas}
      actionsSlot={actionsSlot}
      layoutMode={layoutMode}
      controller={controller}
    />
  );
};

export const ArtifactWorkbenchShell: React.FC<ArtifactWorkbenchShellProps> = memo(
  ({ documentController, ...props }) =>
    documentController ? (
      <ArtifactWorkbenchShellLayout {...props} controller={documentController} />
    ) : (
      <LocalArtifactWorkbenchShell {...props} />
    ),
);
ArtifactWorkbenchShell.displayName = "ArtifactWorkbenchShell";
