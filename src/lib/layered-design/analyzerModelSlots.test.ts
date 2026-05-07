import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignCleanPlateProviderFromModelSlot,
  createLayeredDesignSubjectMattingProviderFromModelSlot,
  createLayeredDesignTextOcrProviderFromModelSlot,
  createLayeredDesignWorkerHeuristicModelSlotOptions,
  evaluateLayeredDesignAnalyzerModelSlotProductionGate,
  type LayeredDesignAnalyzerModelSlot,
  type LayeredDesignCleanPlateModelSlot,
  type LayeredDesignSubjectMattingModelSlot,
  type LayeredDesignTextOcrModelSlot,
} from "./analyzerModelSlots";
import { createLayeredDesignFlatImageAnalyzerFromStructuredProvider } from "./analyzer";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

describe("layered-design analyzer model slots", () => {
  it("应把 clean plate model slot 接到既有 clean plate provider seam", async () => {
    const execute = vi.fn(async () => ({
      src: "data:image/png;base64,clean",
      params: { model: "remote-inpaint-v1" },
    }));
    const slot: LayeredDesignCleanPlateModelSlot = {
      kind: "clean_plate",
      capability: {
        kind: "clean_plate",
        label: "Remote clean plate model slot",
        execution: "remote_model",
        modelId: "remote-inpaint-v1",
        supports: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
        quality: {
          productionReady: true,
          deterministic: false,
          requiresHumanReview: false,
        },
      },
      execute,
    };
    const provider = createLayeredDesignCleanPlateProviderFromModelSlot(slot);

    await expect(
      provider.createCleanPlate({
        image: {
          src: "data:image/png;base64,flat",
          width: 1080,
          height: 1440,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
        subject: {
          id: "subject",
          name: "主体",
          rect: { x: 10, y: 20, width: 100, height: 160 },
          confidence: 0.91,
          zIndex: 10,
          crop: {
            src: "data:image/png;base64,crop",
            width: 100,
            height: 160,
            mimeType: "image/png",
          },
          maskSrc: "data:image/png;base64,mask",
        },
      }),
    ).resolves.toMatchObject({
      src: "data:image/png;base64,clean",
      params: { model: "remote-inpaint-v1" },
    });
    expect(provider.label).toBe("Remote clean plate model slot");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("应把 subject matting model slot 接到既有 matting provider seam", async () => {
    const slot: LayeredDesignSubjectMattingModelSlot = {
      kind: "subject_matting",
      capability: {
        kind: "subject_matting",
        label: "Remote subject matting model slot",
        execution: "remote_model",
        modelId: "remote-matting-v1",
        supports: {
          dataUrlPng: true,
          alphaOutput: true,
          maskOutput: true,
        },
        quality: {
          productionReady: true,
        },
      },
      execute: vi.fn(async (input) => ({
        imageSrc: input.subject.crop.src,
        maskSrc: "data:image/png;base64,mask",
        confidence: 0.97,
        hasAlpha: true,
      })),
    };
    const provider = createLayeredDesignSubjectMattingProviderFromModelSlot(slot);

    await expect(
      provider.matteSubject({
        image: {
          src: "data:image/png;base64,flat",
          width: 512,
          height: 512,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
        subject: {
          id: "subject",
          name: "主体",
          rect: { x: 0, y: 0, width: 128, height: 128 },
          confidence: 0.9,
          zIndex: 1,
          crop: {
            src: "data:image/png;base64,crop",
            width: 128,
            height: 128,
            mimeType: "image/png",
          },
        },
      }),
    ).resolves.toMatchObject({
      maskSrc: "data:image/png;base64,mask",
      hasAlpha: true,
    });
  });

  it("应把 OCR model slot 接到既有 Text OCR provider seam", async () => {
    const slot: LayeredDesignTextOcrModelSlot = {
      kind: "text_ocr",
      capability: {
        kind: "text_ocr",
        label: "Remote OCR model slot",
        execution: "remote_model",
        modelId: "remote-ocr-v1",
        supports: {
          dataUrlPng: true,
          textGeometry: true,
        },
        quality: {
          productionReady: true,
        },
      },
      execute: vi.fn(async () => [
        {
          text: "Lime OCR",
          boundingBox: { x: 8, y: 10, width: 120, height: 40 },
          confidence: 0.96,
        },
      ]),
    };
    const provider = createLayeredDesignTextOcrProviderFromModelSlot(slot);

    await expect(
      provider.detectText({
        image: {
          src: "data:image/png;base64,flat",
          width: 512,
          height: 512,
          mimeType: "image/png",
        },
        candidate: {
          id: "headline",
          name: "标题",
          role: "text",
          rect: { x: 0, y: 0, width: 200, height: 80 },
          asset: {
            id: "headline-asset",
            kind: "text_raster",
            src: "data:image/png;base64,crop",
            width: 200,
            height: 80,
            hasAlpha: false,
            createdAt: CREATED_AT,
          },
        },
      }),
    ).resolves.toEqual([
      {
        text: "Lime OCR",
        boundingBox: { x: 8, y: 10, width: 120, height: 40 },
        confidence: 0.96,
      },
    ]);
  });

  it("应用同一个 production gate 判断 model slot 是否满足生产准入", () => {
    const slot: LayeredDesignCleanPlateModelSlot = {
      kind: "clean_plate",
      capability: {
        kind: "clean_plate",
        label: "Simple clean plate slot",
        execution: "browser_worker",
        modelId: "simple_neighbor_inpaint_v1",
        supports: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
        quality: {
          productionReady: false,
          requiresHumanReview: true,
        },
      },
      execute: vi.fn(async () => null),
    };

    expect(evaluateLayeredDesignAnalyzerModelSlotProductionGate(slot)).toEqual({
      readyForProduction: false,
      checks: [
        {
          requirementId: "clean_plate_masked_output",
          label: "clean plate 需要支持 mask 输入和背景修补输出",
          kind: "clean_plate",
          status: "failed",
          capabilityLabel: "Simple clean plate slot",
          capabilityModelId: "simple_neighbor_inpaint_v1",
          warnings: ["生产可用 需要 是，实际为 否"],
        },
      ],
    });
  });

  it("slot kind 与 capability kind 不一致时应拒绝接入", () => {
    const slot = {
      kind: "clean_plate",
      capability: {
        kind: "text_ocr",
        label: "Mismatched slot",
        execution: "remote_model",
        supports: { textGeometry: true },
      },
      execute: vi.fn(async () => null),
    } as unknown as LayeredDesignAnalyzerModelSlot;

    expect(() =>
      createLayeredDesignCleanPlateProviderFromModelSlot(
        slot as LayeredDesignCleanPlateModelSlot,
      ),
    ).toThrow("Layered design analyzer model slot kind mismatch");
  });

  it("应把三类 model slot 组合进 Worker heuristic analyzer 并回写 extraction", async () => {
    const subjectSlot: LayeredDesignSubjectMattingModelSlot = {
      kind: "subject_matting",
      capability: {
        kind: "subject_matting",
        label: "Remote matting slot",
        execution: "remote_model",
        modelId: "remote-matting-v1",
        supports: {
          dataUrlPng: true,
          alphaOutput: true,
          maskOutput: true,
        },
        quality: { productionReady: true },
      },
      execute: vi.fn(async (input) => ({
        imageSrc: `data:image/png;base64,slot-matted-${input.subject.rect.width}`,
        maskSrc: "data:image/png;base64,slot-mask",
        confidence: 0.98,
        hasAlpha: true,
      })),
    };
    const cleanPlateSlot: LayeredDesignCleanPlateModelSlot = {
      kind: "clean_plate",
      capability: {
        kind: "clean_plate",
        label: "Remote clean plate slot",
        execution: "remote_model",
        modelId: "remote-inpaint-v1",
        supports: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
        quality: { productionReady: true },
      },
      execute: vi.fn(async () => ({
        src: "data:image/png;base64,slot-clean",
        message: "slot clean plate ready",
        params: { model: "remote-inpaint-v1" },
      })),
    };
    const textSlot: LayeredDesignTextOcrModelSlot = {
      kind: "text_ocr",
      capability: {
        kind: "text_ocr",
        label: "Remote OCR slot",
        execution: "remote_model",
        modelId: "remote-ocr-v1",
        supports: {
          dataUrlPng: true,
          textGeometry: true,
        },
        quality: { productionReady: true },
      },
      execute: vi.fn(async () => [
        {
          text: "SLOT OCR",
          boundingBox: { x: 4, y: 5, width: 120, height: 40 },
          confidence: 0.99,
        },
      ]),
    };
    const workerSlotOptions = createLayeredDesignWorkerHeuristicModelSlotOptions({
      subjectMattingSlot: subjectSlot,
      cleanPlateSlot,
      textOcrSlot: textSlot,
    });
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        ...workerSlotOptions,
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async (rect) => {
            return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
          }),
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,masked-fallback";
          }),
          createEllipseMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,mask-fallback";
          }),
          createApproximateCleanPlateDataUrl: vi.fn(async () => {
            return "data:image/png;base64,clean-fallback";
          }),
        })),
      });
    const analyzer = createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
      provider,
      {
        fallbackAnalyzer: null,
      },
    );

    const result = await analyzer({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(result.analysis).toMatchObject({
      outputs: {
        candidateMask: true,
        cleanPlate: true,
        ocrText: true,
      },
      providerCapabilities: [
        { label: "Remote matting slot", modelId: "remote-matting-v1" },
        { label: "Remote clean plate slot", modelId: "remote-inpaint-v1" },
        { label: "Remote OCR slot", modelId: "remote-ocr-v1" },
      ],
    });
    expect(
      result.candidates.find((candidate) => candidate.id === "subject-candidate"),
    ).toMatchObject({
      confidence: 0.98,
      assets: [
        expect.objectContaining({
          src: expect.stringContaining("slot-matted-"),
        }),
        expect.objectContaining({
          src: "data:image/png;base64,slot-mask",
        }),
      ],
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      layer: {
        type: "text",
        text: "SLOT OCR",
      },
    });
    expect(result.cleanPlate).toMatchObject({
      asset: {
        src: "data:image/png;base64,slot-clean",
        params: {
          seed: "worker_heuristic_clean_plate_provider",
          model: "remote-inpaint-v1",
        },
      },
      message: "slot clean plate ready",
    });
  });
});
