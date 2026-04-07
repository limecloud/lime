import { describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import { WorkspaceLiveCanvasPreview } from "./workbenchPreview";

function createArtifact(): Artifact {
  return {
    id: "artifact-live-1",
    type: "document",
    title: "live.artifact.json",
    content: '{"schemaVersion":"artifact_document.v1"}',
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/live.artifact.json",
      filename: "live.artifact.json",
      language: "json",
    },
    position: { start: 0, end: 38 },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("workbenchPreview", () => {
  it("general live artifact 应强制走 canvas-only 文稿布局，避免重复 inspector", () => {
    const artifact = createArtifact();
    const renderArtifactPreview = vi.fn(() => null);

    WorkspaceLiveCanvasPreview({
      currentImageWorkbenchActive: false,
      imageWorkbenchProps: {} as never,
      onCloseCanvas: vi.fn(),
      canvasRenderTheme: "general",
      liveArtifact: artifact,
      hasDisplayedLiveArtifact: true,
      renderArtifactPreview,
      generalCanvasPanelProps: null,
      shouldShowCanvasLoadingState: false,
      canvasLoadingLabel: "loading",
      canvasFactoryProps: null,
      stackedWorkbenchTrigger: null,
    });

    expect(renderArtifactPreview).toHaveBeenCalledTimes(1);
    expect(renderArtifactPreview).toHaveBeenCalledWith(
      artifact,
      expect.objectContaining({
        stackedWorkbenchTrigger: null,
      }),
    );
  });
});
