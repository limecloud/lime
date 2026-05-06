import { describe, expect, it } from "vitest";
import {
  createImageLayer,
  createLayeredDesignDocument,
  createLayeredDesignExportBundle,
  createLayeredDesignProjectExportFiles,
  createLayeredDesignExportZipFile,
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
        fontSize: 48,
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

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readLocalZipEntryNames(content: Uint8Array): string[] {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;

  while (offset + 30 <= content.byteLength) {
    const signature = readUint32(view, offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressedSize = readUint32(view, offset + 18);
    const filenameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const filenameStart = offset + 30;
    const filenameEnd = filenameStart + filenameLength;

    names.push(decoder.decode(content.slice(filenameStart, filenameEnd)));
    offset = filenameEnd + extraLength + compressedSize;
  }

  return names;
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
    expect(bundle.psdLikeManifestFile.downloadName).toBe(
      "coffee-cover.psd-like-manifest.json",
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
    expect(bundle.manifest.psdLikeManifestFile).toBe(
      "psd-like-manifest.json",
    );

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

  it("应生成 PSD-like 专业层栈投影，但不伪装成真 PSD", () => {
    const bundle = createLayeredDesignExportBundle(createExportDocument(), {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "coffee-cover",
    });
    const psdLikeManifest = JSON.parse(bundle.psdLikeManifestFile.content);

    expect(psdLikeManifest).toMatchObject({
      projectionKind: "psd-like-layer-stack",
      source: {
        factSource: "LayeredDesignDocument",
        documentId: "design-export-test",
        designFile: "design.json",
      },
      compatibility: {
        truePsd: false,
        layerOrder: "back_to_front",
        editableText: true,
      },
    });
    expect(psdLikeManifest.layers.map((layer: any) => layer.id)).toEqual([
      "subject",
      "headline",
      "hidden-badge",
    ]);
    expect(psdLikeManifest.layers[0]).toMatchObject({
      id: "subject",
      role: "raster_image",
      asset: {
        id: "asset-subject",
        source: "file",
        filename: "assets/asset-subject.png",
        hasAlpha: true,
      },
    });
    expect(psdLikeManifest.layers[1]).toMatchObject({
      id: "headline",
      role: "editable_text",
      text: {
        text: "咖啡 & 甜点 <入门>",
        fontSize: 48,
      },
    });
    expect(psdLikeManifest.layers[2]).toMatchObject({
      id: "hidden-badge",
      role: "vector_shape",
      visible: false,
    });
    expect(JSON.stringify(psdLikeManifest)).not.toMatch(
      /poster_generate|canvas:poster|ImageTaskViewer/,
    );
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
    expect(bundle.psdLikeManifest.layers[0]).toMatchObject({
      id: "remote-layer",
      role: "raster_image",
      asset: {
        id: "remote-asset",
        source: "reference",
        originalSrc: "https://example.com/hero.png",
      },
    });
  });

  it("应把设计工程打包成单个 ZIP，并保留 assets/ 目录结构", () => {
    const bundle = createLayeredDesignExportBundle(createExportDocument(), {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "coffee-cover",
    });
    const zipFile = createLayeredDesignExportZipFile(bundle, {
      previewPngDataUrl: "data:image/png;base64,cHJldmlldy1wbmc=",
    });

    expect(zipFile).toMatchObject({
      filename: "layered-design-export.zip",
      downloadName: "coffee-cover.layered-design.zip",
      mimeType: "application/zip",
    });
    expect(Array.from(zipFile.content.slice(0, 4))).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    expect(readLocalZipEntryNames(zipFile.content)).toEqual([
      "design.json",
      "export-manifest.json",
      "psd-like-manifest.json",
      "preview.svg",
      "preview.png",
      "assets/asset-subject.png",
    ]);
    expect(String.fromCharCode(...zipFile.content)).not.toMatch(
      /poster_generate|canvas:poster/,
    );
  });

  it("应生成可交给 Tauri 落盘的工程目录文件列表", () => {
    const bundle = createLayeredDesignExportBundle(createExportDocument(), {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "coffee-cover",
    });
    const files = createLayeredDesignProjectExportFiles(bundle, {
      previewPngDataUrl: "data:image/png;base64,cHJldmlldy1wbmc=",
    });

    expect(files.map((file) => file.relativePath)).toEqual([
      "design.json",
      "export-manifest.json",
      "psd-like-manifest.json",
      "preview.svg",
      "preview.png",
      "assets/asset-subject.png",
    ]);
    expect(
      files.find((file) => file.relativePath === "design.json"),
    ).toMatchObject({
      encoding: "utf8",
      mimeType: "application/json",
    });
    expect(
      files.find((file) => file.relativePath === "preview.png"),
    ).toMatchObject({
      encoding: "base64",
      mimeType: "image/png",
      content: "cHJldmlldy1wbmc=",
    });
    expect(JSON.stringify(files)).not.toMatch(
      /poster_generate|canvas:poster|ImageTaskViewer/,
    );
  });
});
