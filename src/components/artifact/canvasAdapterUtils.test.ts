import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import {
  createCanvasStateFromArtifact,
  extractCanvasMetadata,
  extractContentFromCanvasState,
  getCanvasTypeFromArtifact,
} from "./canvasAdapterUtils";

const CREATED_AT = 1_775_520_000_000;

function createArtifact(
  type: Artifact["type"] | string,
  content: string,
): Artifact {
  return {
    id: "artifact-design",
    type: type as Artifact["type"],
    title: "图层设计",
    content,
    status: "complete",
    meta: {},
    position: { start: 0, end: content.length },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

describe("canvasAdapterUtils", () => {
  it("canvas:design 应创建 design canvas state，并保留 LayeredDesignDocument", () => {
    const content = JSON.stringify({
      id: "design-from-artifact",
      title: "Artifact 图层设计",
      canvas: { width: 1080, height: 1440 },
      layers: [],
      assets: [],
      editHistory: [],
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });

    const state = createCanvasStateFromArtifact(
      createArtifact("canvas:design", content),
    );

    expect(state?.type).toBe("design");
    if (state?.type !== "design") {
      throw new Error("expected design canvas state");
    }
    expect(state.document.id).toBe("design-from-artifact");
    expect(state.document.title).toBe("Artifact 图层设计");
    expect(extractContentFromCanvasState(state)).toContain(
      "design-from-artifact",
    );
    expect(extractCanvasMetadata(state)).toMatchObject({
      platform: "layered-design",
      designId: "design-from-artifact",
    });
  });

  it("旧 canvas:poster 不应再归一到 document canvas", () => {
    expect(getCanvasTypeFromArtifact("canvas:poster")).toBeNull();
    expect(
      createCanvasStateFromArtifact(createArtifact("canvas:poster", "")),
    ).toBeNull();
  });
});
