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
import type {
  ArtifactBlockRewriteCompletion,
  ArtifactBlockRewriteRunPayload,
} from "./artifactWorkbenchRewrite";
import {
  ArtifactWorkbenchEditSurface,
  type EditableArtifactBlockDraft,
  type ArtifactWorkbenchDocumentController,
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
  onArtifactBlockRewriteRun?: (
    payload: ArtifactBlockRewriteRunPayload,
  ) => Promise<ArtifactBlockRewriteCompletion> | ArtifactBlockRewriteCompletion | void;
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
  onCloseCanvas: () => void;
  actionsSlot?: React.ReactNode;
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
  controller,
  onArtifactBlockRewriteRun,
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
      <div className="min-h-0 flex flex-1 flex-col">
        <div
          ref={controller.rendererViewportRef as React.RefObject<HTMLDivElement>}
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
              {artifactOverlay ? <ArtifactCanvasOverlay overlay={artifactOverlay} /> : null}
            </>
          )}
        </div>
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
  onArtifactBlockRewriteRun,
  threadItems = [],
  focusedBlockId = null,
  blockFocusRequestKey = 0,
  onJumpToTimelineItem,
  onCloseCanvas,
  actionsSlot,
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
      controller={controller}
      onArtifactBlockRewriteRun={onArtifactBlockRewriteRun}
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
