import { describe, expect, it } from "vitest";
import {
  createImageLayer,
  createLayeredDesignDocument,
  createLayeredDesignExportBundle,
  createShapeLayer,
  createTextLayer,
  renderLayeredDesignDocumentToSvg,
} from ".";
import type { GeneratedDesignAsset } from "./types";

const CREATED_AT = "2026-05-05T00:00:00.000Z";

function createAsset(
  id: string,
  src = "data:image/png;base64,ZmFrZS1hc3NldA==",
): GeneratedDesignAsset {
  return {
    id,
    kind: "subject",
    src,
    width: 512,
    height: 512,
    hasAlpha: true,
    provider: "openai",
    modelId: "gpt-image-2",
    createdAt: CREATED_AT,
  };
}

function createExportDocument() {
  return createLayeredDesignDocument({
    id: "design-export-test",
    title: "咖啡课程封面",
    canvas: { width: 1080, height: 1440, backgroundColor: "#fff7ed" },
    layers: [
      createImageLayer({
        id: "subject",
        name: "主体图片",
        type: "image",
        assetId: "asset-subject",
        x: 120,
        y: 260,
        width: 720,
        height: 820,
        zIndex: 10,
        source: "generated",
      }),
      createTextLayer({
        id: "headline",
        name: "主标题",
        type: "text",
        text: "咖啡 & 甜点 <入门>",
        x: 100,
        y: 120,
        width: 880,
        height: 140,
        zIndex: 20,
        source: "planned",
      }),
      createShapeLayer({
        id: "hidden-badge",
        name: "隐藏徽标",
        type: "shape",
        x: 40,
        y: 40,
        width: 120,
        height: 120,
        visible: false,
        zIndex: 30,
        source: "planned",
      }),
    ],
    assets: [createAsset("asset-subject")],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

describe("layered-design export", () => {
  it("应生成 design.json、manifest、预览 SVG 和可下载内嵌 assets", () => {
    const document = createExportDocument();
    const bundle = createLayeredDesignExportBundle(document, {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "coffee-cover",
    });

    expect(bundle.designFile.downloadName).toBe("coffee-cover.design.json");
    expect(bundle.manifestFile.downloadName).toBe(
      "coffee-cover.export-manifest.json",
    );
    expect(bundle.previewSvgFile.downloadName).toBe("coffee-cover.preview.svg");
    expect(bundle.previewPngFile.downloadName).toBe("coffee-cover.preview.png");
    expect(bundle.assetFiles).toHaveLength(1);
    expect(bundle.assetFiles[0]).toMatchObject({
      assetId: "asset-subject",
      filename: "assets/asset-subject.png",
      downloadName: "coffee-cover.asset-subject.png",
      embeddedDataUrl: true,
    });
    expect(bundle.manifest.assets[0]).toMatchObject({
      id: "asset-subject",
      source: "file",
      filename: "assets/asset-subject.png",
      provider: "openai",
      modelId: "gpt-image-2",
    });

    const exportedDocument = JSON.parse(bundle.designFile.content);
    expect(exportedDocument.status).toBe("exported");
    expect(exportedDocument.layers).toHaveLength(3);
    expect(JSON.stringify(bundle)).not.toMatch(/poster_generate|canvas:poster/);
  });

  it("预览 SVG 应来自当前可见图层，并正确转义文本", () => {
    const svg = renderLayeredDesignDocumentToSvg(createExportDocument());

    expect(svg).toContain("<image");
    expect(svg).toContain("<text");
    expect(svg).toContain("咖啡 &amp; 甜点 &lt;入门&gt;");
    expect(svg).not.toContain("隐藏徽标");
  });

  it("远程 assets 应保留引用，不伪装成已下载文件", () => {
    const document = createLayeredDesignDocument({
      ...createExportDocument(),
      assets: [createAsset("remote-asset", "https://example.com/hero.png")],
      layers: [
        createImageLayer({
          id: "remote-layer",
          name: "远程图",
          type: "image",
          assetId: "remote-asset",
          x: 0,
          y: 0,
          width: 320,
          height: 320,
          zIndex: 1,
          source: "generated",
        }),
      ],
    });

    const bundle = createLayeredDesignExportBundle(document, {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "remote",
    });

    expect(bundle.assetFiles).toHaveLength(0);
    expect(bundle.manifest.assets[0]).toMatchObject({
      id: "remote-asset",
      source: "reference",
      originalSrc: "https://example.com/hero.png",
    });
  });
});
