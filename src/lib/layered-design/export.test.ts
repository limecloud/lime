import { describe, expect, it } from "vitest";
import {
  createImageLayer,
  createLayeredDesignDocument,
  createLayeredDesignExportBundle,
  createLayeredDesignFlatImageDraftDocument,
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

function readBigEndianUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readBigEndianInt16(view: DataView, offset: number): number {
  return view.getInt16(offset, false);
}

function readAscii(content: Uint8Array, offset: number, length: number): string {
  return Array.from(content.slice(offset, offset + length))
    .map((code) => String.fromCharCode(code))
    .join("");
}

function readPsdLayerCount(content: Uint8Array): number {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let offset = 26;
  const colorModeDataLength = readBigEndianUint32(view, offset);
  offset += 4 + colorModeDataLength;
  const imageResourcesLength = readBigEndianUint32(view, offset);
  offset += 4 + imageResourcesLength;
  const layerAndMaskLength = readBigEndianUint32(view, offset);
  offset += 4;
  expect(layerAndMaskLength).toBeGreaterThan(0);
  const layerInfoLength = readBigEndianUint32(view, offset);
  offset += 4;
  expect(layerInfoLength).toBeGreaterThan(0);
  return readBigEndianInt16(view, offset);
}

function decodePsdText(content: Uint8Array): string {
  return new TextDecoder().decode(content);
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
    expect(bundle.trialPsdFile.downloadName).toBe("coffee-cover.trial.psd");
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
    expect(bundle.manifest.trialPsdFile).toBe("trial.psd");

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

  it("应生成 PSD 试点文件并保留图层列表", () => {
    const bundle = createLayeredDesignExportBundle(createExportDocument(), {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "coffee-cover",
    });
    const psd = bundle.trialPsdFile.content;
    const view = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);

    expect(bundle.trialPsdFile).toMatchObject({
      filename: "trial.psd",
      mimeType: "image/vnd.adobe.photoshop",
    });
    expect(readAscii(psd, 0, 4)).toBe("8BPS");
    expect(view.getUint16(4, false)).toBe(1);
    expect(view.getUint16(12, false)).toBe(3);
    expect(view.getUint32(14, false)).toBe(1440);
    expect(view.getUint32(18, false)).toBe(1080);
    expect(view.getUint16(22, false)).toBe(8);
    expect(view.getUint16(24, false)).toBe(3);
    expect(readPsdLayerCount(psd)).toBe(3);
    expect(readAscii(psd, 0, psd.byteLength)).toContain("LmTx");
    expect(decodePsdText(psd)).toContain("lime.layered-design.text-layer");
    expect(decodePsdText(psd)).toContain("咖啡 & 甜点 <入门>");
    expect(decodePsdText(psd)).toContain("rasterized_placeholder_layer");
    expect(readAscii(psd, 0, psd.byteLength)).not.toMatch(
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

  it("export manifest 应投影 analyzer capability gate，避免把实验能力误判为生产级", () => {
    const document = createLayeredDesignFlatImageDraftDocument({
      id: "flat-capability-gate",
      title: "拆层能力准入测试",
      image: {
        src: "data:image/png;base64,ZmFrZS1mbGF0",
        width: 1080,
        height: 1440,
      },
      analysis: {
        analyzer: {
          kind: "local_heuristic",
          label: "Worker local heuristic analyzer",
        },
        outputs: {
          candidateRaster: true,
          candidateMask: false,
          cleanPlate: true,
          ocrText: false,
        },
        providerCapabilities: [
          {
            kind: "clean_plate",
            label: "Simple browser clean plate provider",
            execution: "browser_worker",
            modelId: "simple_neighbor_inpaint_v1",
            supports: {
              dataUrlPng: true,
              maskInput: true,
              cleanPlateOutput: true,
            },
            quality: {
              productionReady: false,
              deterministic: true,
              requiresHumanReview: true,
            },
          },
        ],
        generatedAt: CREATED_AT,
      },
      cleanPlate: {
        status: "succeeded",
        asset: {
          id: "clean-plate",
          kind: "clean_plate",
          src: "data:image/png;base64,Y2xlYW4=",
          width: 1080,
          height: 1440,
          hasAlpha: false,
          createdAt: CREATED_AT,
        },
      },
      createdAt: CREATED_AT,
    });
    const bundle = createLayeredDesignExportBundle(document, {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "flat-capability-gate",
    });

    expect(bundle.manifest.analysis).toMatchObject({
      analyzer: {
        label: "Worker local heuristic analyzer",
      },
      outputs: {
        cleanPlate: true,
      },
      providerCapabilities: [
        {
          kind: "clean_plate",
          label: "Simple browser clean plate provider",
          modelId: "simple_neighbor_inpaint_v1",
        },
      ],
      capabilityGate: {
        readyForProduction: false,
        checks: [
          {
            requirementId: "clean_plate_masked_output",
            status: "failed",
            capabilityLabel: "Simple browser clean plate provider",
            warnings: ["生产可用 需要 是，实际为 否"],
          },
        ],
      },
    });
    expect(bundle.manifest.analysis).toBeDefined();
    expect(JSON.parse(bundle.manifestFile.content).analysis).toMatchObject(
      bundle.manifest.analysis!,
    );
  });

  it("export manifest 应投影 analyzer model slot config 与 readiness", () => {
    const bundle = createLayeredDesignExportBundle(createExportDocument(), {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "model-slot-config",
      analyzerModelSlotConfigs: [
        {
          id: "clean-slot",
          kind: "clean_plate",
          label: "Clean Slot",
          modelId: "clean-slot-v1",
          io: {
            dataUrlPng: true,
            maskInput: true,
            cleanPlateOutput: true,
          },
          metadata: {
            productionReady: false,
          },
        },
        {
          id: "ocr-slot",
          kind: "text_ocr",
          label: "OCR Slot",
          modelId: "ocr-slot-v1",
          metadata: {
            productionReady: true,
            requiresHumanReview: false,
          },
        },
      ],
    });

    expect(bundle.manifest.analyzerModelSlots).toMatchObject([
      {
        config: {
          id: "clean-slot",
          kind: "clean_plate",
          modelId: "clean-slot-v1",
          runtime: {
            timeoutMs: 45_000,
            maxAttempts: 1,
            fallbackStrategy: "return_null",
          },
        },
        readiness: {
          valid: false,
          warnings: ["生产可用 需要 是，实际为 否"],
          productionGate: {
            readyForProduction: false,
          },
        },
      },
      {
        config: {
          id: "ocr-slot",
          kind: "text_ocr",
          io: {
            dataUrlPng: true,
            textGeometry: true,
          },
          metadata: {
            productionReady: true,
            requiresHumanReview: false,
          },
        },
        readiness: {
          valid: true,
          warnings: [],
          productionGate: {
            readyForProduction: true,
          },
        },
      },
    ]);
    expect(
      JSON.parse(bundle.manifestFile.content).analyzerModelSlots,
    ).toMatchObject(bundle.manifest.analyzerModelSlots!);
  });

  it("export manifest 应汇总实际 analyzer model slot 执行证据", () => {
    const subjectExecution = {
      slotId: "subject-runtime",
      slotKind: "subject_matting",
      providerLabel: "Runtime subject matting",
      modelId: "runtime-matting-v1",
      execution: "remote_model",
      attempt: 1,
      maxAttempts: 1,
      timeoutMs: 45_000,
      fallbackStrategy: "return_null",
      fallbackUsed: false,
      status: "succeeded",
    };
    const cleanPlateExecution = {
      slotId: "clean-runtime",
      slotKind: "clean_plate",
      providerLabel: "Runtime clean plate",
      modelId: "runtime-inpaint-v1",
      execution: "remote_model",
      attempt: 2,
      maxAttempts: 2,
      timeoutMs: 45_000,
      fallbackStrategy: "return_null",
      fallbackUsed: false,
      status: "succeeded",
    };
    const ocrExecution = {
      slotId: "ocr-runtime",
      slotKind: "text_ocr",
      providerLabel: "Runtime OCR",
      modelId: "runtime-ocr-v1",
      execution: "remote_model",
      attempt: 1,
      maxAttempts: 1,
      timeoutMs: 45_000,
      fallbackStrategy: "use_heuristic",
      fallbackUsed: true,
      status: "fallback_succeeded",
    };
    const document = createLayeredDesignDocument({
      id: "model-slot-evidence",
      title: "执行证据导出",
      canvas: { width: 1080, height: 1440 },
      layers: [
        createImageLayer({
          id: "subject-layer",
          name: "主体",
          type: "image",
          assetId: "asset-subject",
          x: 120,
          y: 260,
          width: 720,
          height: 820,
          zIndex: 10,
          source: "extracted",
        }),
        createTextLayer({
          id: "headline-layer",
          name: "标题",
          type: "text",
          text: "RUNTIME OCR",
          x: 100,
          y: 120,
          width: 880,
          height: 140,
          fontSize: 48,
          zIndex: 20,
          source: "extracted",
          params: {
            modelSlotExecution: ocrExecution,
          },
        }),
      ],
      assets: [
        {
          ...createAsset("asset-subject"),
          params: {
            modelSlotExecution: subjectExecution,
          },
        },
        {
          id: "clean-plate",
          kind: "clean_plate",
          src: "data:image/png;base64,Y2xlYW4=",
          width: 1080,
          height: 1440,
          hasAlpha: false,
          createdAt: CREATED_AT,
          params: {
            modelSlotExecution: cleanPlateExecution,
          },
        },
      ],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    const bundle = createLayeredDesignExportBundle(document, {
      exportedAt: "2026-05-05T03:00:00.000Z",
      baseName: "model-slot-evidence",
    });

    expect(bundle.manifest.evidence?.modelSlotExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "subject-runtime",
          slotKind: "subject_matting",
          modelId: "runtime-matting-v1",
          sources: [
            {
              kind: "asset",
              id: "asset-subject",
              assetKind: "subject",
            },
          ],
        }),
        expect.objectContaining({
          slotId: "clean-runtime",
          modelId: "runtime-inpaint-v1",
          attempt: 2,
          sources: [
            {
              kind: "asset",
              id: "clean-plate",
              assetKind: "clean_plate",
            },
          ],
        }),
        expect.objectContaining({
          slotId: "ocr-runtime",
          modelId: "runtime-ocr-v1",
          fallbackUsed: true,
          status: "fallback_succeeded",
          sources: [
            {
              kind: "layer",
              id: "headline-layer",
              layerType: "text",
            },
          ],
        }),
      ]),
    );
    expect(
      JSON.parse(bundle.manifestFile.content).evidence.modelSlotExecutions,
    ).toMatchObject(bundle.manifest.evidence!.modelSlotExecutions!);
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
      "trial.psd",
      "preview.svg",
      "preview.png",
      "assets/asset-subject.png",
    ]);
    expect(new TextDecoder().decode(zipFile.content)).not.toMatch(
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
      "trial.psd",
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
      files.find((file) => file.relativePath === "trial.psd"),
    ).toMatchObject({
      encoding: "base64",
      mimeType: "image/vnd.adobe.photoshop",
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
