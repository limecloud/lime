import { describe, expect, it } from "vitest";
import { createCanvasStateFromArtifact } from "@/components/artifact/canvasAdapterUtils";
import { LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION } from "./types";
import {
  createLayeredDesignArtifact,
  createLayeredDesignArtifactFromPrompt,
} from "./artifact";
import { createLayeredDesignSeedDocument } from "./planner";

const DOCUMENT_CREATED_AT = "2026-05-05T00:00:00.000Z";
const ARTIFACT_CREATED_AT = 1_777_920_000_000;

describe("layered-design artifact bridge", () => {
  it("应把 LayeredDesignDocument 序列化为 canvas:design Artifact", () => {
    const document = createLayeredDesignSeedDocument({
      prompt: "@海报 手冲咖啡课程招募",
      id: "coffee-course",
      title: "手冲咖啡课程招募",
      createdAt: DOCUMENT_CREATED_AT,
    });

    const artifact = createLayeredDesignArtifact(document, {
      artifactId: "artifact-coffee-course",
      timestamp: ARTIFACT_CREATED_AT,
      meta: { filename: "coffee-course.design.json" },
    });

    expect(artifact).toMatchObject({
      id: "artifact-coffee-course",
      type: "canvas:design",
      title: "手冲咖啡课程招募",
      status: "complete",
      createdAt: ARTIFACT_CREATED_AT,
      updatedAt: ARTIFACT_CREATED_AT,
      meta: {
        filename: "coffee-course.design.json",
        platform: "layered-design",
        schemaVersion: LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION,
        designId: "coffee-course",
        source: "layered-design-document",
      },
    });
    expect(artifact.position).toEqual({
      start: 0,
      end: artifact.content.length,
    });
    expect(JSON.parse(artifact.content)).toMatchObject({
      id: "coffee-course",
      schemaVersion: LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION,
    });
  });

  it("应从 prompt 生成 seed Artifact，并能打开到 DesignCanvasState", () => {
    const artifact = createLayeredDesignArtifactFromPrompt(
      "@配图 未来主义运动鞋新品发布，银色背景",
      {
        id: "sneaker-launch",
        title: "未来主义运动鞋新品发布",
        artifactId: "artifact-sneaker-launch",
        documentCreatedAt: DOCUMENT_CREATED_AT,
        timestamp: ARTIFACT_CREATED_AT,
      },
    );

    const state = createCanvasStateFromArtifact(artifact);

    expect(artifact.type).toBe("canvas:design");
    expect(artifact.meta).toMatchObject({
      platform: "layered-design",
      designId: "sneaker-launch",
      source: "layered-design-seed",
    });
    expect(state?.type).toBe("design");
    if (state?.type !== "design") {
      throw new Error("expected design canvas state");
    }
    expect(state.document.id).toBe("sneaker-launch");
    expect(state.document.layers.some((layer) => layer.type === "text")).toBe(
      true,
    );
    expect(state.document.assets.every((asset) => asset.src === "")).toBe(true);
  });
});
