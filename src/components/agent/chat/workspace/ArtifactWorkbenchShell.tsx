import React, { memo } from "react";
import {
  ArtifactCanvasOverlay,
  ArtifactRenderer,
  ArtifactToolbar,
} from "@/components/artifact";
import type { Artifact } from "@/lib/artifact/types";
import { cn } from "@/lib/utils";
import type {
  ArtifactBlockRewriteCompletion,
  ArtifactBlockRewriteRunPayload,
} from "./artifactWorkbenchRewrite";
import {
  ArtifactWorkbenchEditSurface,
  type EditableArtifactBlockDraft,
  type ArtifactWorkbenchDocumentController,
} from "./artifactWorkbenchDocument";

interface ArtifactWorkbenchShellProps {
  artifact: Artifact;
  artifactOverlay:
    | React.ComponentProps<typeof ArtifactCanvasOverlay>["overlay"]
    | null;
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
  onArtifactBlockRewriteRun?: (
    payload: ArtifactBlockRewriteRunPayload,
  ) =>
    | Promise<ArtifactBlockRewriteCompletion>
    | ArtifactBlockRewriteCompletion
    | void;
  onCloseCanvas: () => void;
  actionsSlot?: React.ReactNode;
  documentController: ArtifactWorkbenchDocumentController;
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
  documentController: controller,
  onArtifactBlockRewriteRun,
}: ArtifactWorkbenchShellProps) {
  const handleBlockRewriteRun = React.useCallback(
    async ({
      draft,
      instruction,
    }: {
      draft: EditableArtifactBlockDraft;
      instruction: string;
    }) => {
      if (
        !onArtifactBlockRewriteRun ||
        !controller.document ||
        !controller.selectedEditableBlock
      ) {
        return;
      }

      return await onArtifactBlockRewriteRun({
        artifact,
        document: controller.document,
        entry: controller.selectedEditableBlock,
        draft,
        timelineLink: controller.selectedTimelineLink,
        instruction,
      });
    },
    [
      artifact,
      controller.document,
      controller.selectedEditableBlock,
      controller.selectedTimelineLink,
      onArtifactBlockRewriteRun,
    ],
  );

  return (
    <div
      data-testid="artifact-workbench-shell"
      data-layout-mode="canvas-only"
      className="mt-5 mx-4 mb-4 flex h-[calc(100%-24px)] flex-col bg-transparent"
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
        displayBadgeLabel={
          showPreviousVersionBadge ? "预览上一版本" : undefined
        }
        actionsSlot={actionsSlot}
      />
      <div className="mt-4 min-h-0 flex flex-1 flex-col bg-transparent">
        <div
          ref={
            controller.rendererViewportRef as React.RefObject<HTMLDivElement>
          }
          className={cn(
            "relative min-h-0 bg-white",
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
              onRewrite={
                onArtifactBlockRewriteRun ? handleBlockRewriteRun : undefined
              }
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
              {artifactOverlay ? (
                <ArtifactCanvasOverlay overlay={artifactOverlay} />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
export const ArtifactWorkbenchShell: React.FC<ArtifactWorkbenchShellProps> =
  memo((props) => <ArtifactWorkbenchShellLayout {...props} />);
ArtifactWorkbenchShell.displayName = "ArtifactWorkbenchShell";
