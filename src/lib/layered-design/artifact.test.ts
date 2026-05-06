import { describe, expect, it } from "vitest";
import { createCanvasStateFromArtifact } from "@/components/artifact/canvasAdapterUtils";
import { LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION } from "./types";
import {
  createLayeredDesignArtifact,
  createLayeredDesignArtifactFromExtraction,
  createLayeredDesignArtifactFromFlatImage,
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

  it("应从扁平图拆层 draft 生成 Artifact，并只把已选候选层送入 DesignCanvasState", () => {
    const artifact = createLayeredDesignArtifactFromExtraction({
      id: "flat-poster-design",
      title: "扁平海报拆层",
      canvas: { width: 1080, height: 1440, backgroundColor: "#050505" },
      sourceAsset: {
        id: "flat-source",
        kind: "background",
        src: "https://example.com/poster.png",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: DOCUMENT_CREATED_AT,
      },
      cleanPlate: {
        status: "failed",
        message: "修补失败，回退原图背景。",
      },
      candidates: [
        {
          id: "subject-candidate",
          role: "subject",
          confidence: 0.92,
          layer: {
            id: "subject-layer",
            name: "人物主体",
            type: "image",
            assetId: "subject-asset",
            x: 160,
            y: 240,
            width: 760,
            height: 980,
            zIndex: 20,
            alphaMode: "embedded",
          },
          assets: [
            {
              id: "subject-asset",
              kind: "subject",
              src: "data:image/png;base64,subject",
              width: 760,
              height: 980,
              hasAlpha: true,
              createdAt: DOCUMENT_CREATED_AT,
            },
          ],
        },
        {
          id: "fragment-candidate",
          role: "background_fragment",
          confidence: 0.22,
          layer: {
            id: "fragment-layer",
            name: "小碎片",
            type: "image",
            assetId: "fragment-asset",
            x: 32,
            y: 40,
            width: 120,
            height: 120,
            zIndex: 30,
            alphaMode: "embedded",
          },
          assets: [
            {
              id: "fragment-asset",
              kind: "effect",
              src: "data:image/png;base64,fragment",
              width: 120,
              height: 120,
              hasAlpha: true,
              createdAt: DOCUMENT_CREATED_AT,
            },
          ],
        },
      ],
      artifactId: "artifact-flat-poster-design",
      timestamp: ARTIFACT_CREATED_AT,
      documentCreatedAt: DOCUMENT_CREATED_AT,
    });

    const state = createCanvasStateFromArtifact(artifact);

    expect(artifact.meta).toMatchObject({
      platform: "layered-design",
      designId: "flat-poster-design",
      source: "layered-design-extraction",
    });
    expect(state?.type).toBe("design");
    if (state?.type !== "design") {
      throw new Error("expected design canvas state");
    }
    expect(state.document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
    ]);
    expect(state.document.extraction?.cleanPlate.status).toBe("failed");
    expect(
      state.document.extraction?.candidates.find(
        (candidate) => candidate.id === "fragment-candidate",
      ),
    ).toMatchObject({
      selected: false,
      issues: ["low_confidence"],
    });
  });

  it("应从上传扁平图直接生成 current canvas:design Artifact", () => {
    const artifact = createLayeredDesignArtifactFromFlatImage({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        fileName: "teaser-poster.png",
        mimeType: "image/png",
      },
      artifactId: "artifact-flat-image-design",
      timestamp: ARTIFACT_CREATED_AT,
      documentCreatedAt: DOCUMENT_CREATED_AT,
    });

    const state = createCanvasStateFromArtifact(artifact);

    expect(artifact.type).toBe("canvas:design");
    expect(artifact.meta).toMatchObject({
      platform: "layered-design",
      designId: "teaser-poster",
      source: "layered-design-extraction",
    });
    expect(state?.type).toBe("design");
    if (state?.type !== "design") {
      throw new Error("expected design canvas state");
    }
    expect(state.document.title).toBe("teaser-poster");
    expect(state.document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
    ]);
    expect(state.document.extraction?.sourceAssetId).toBe(
      "teaser-poster-source-image",
    );
  });
});
