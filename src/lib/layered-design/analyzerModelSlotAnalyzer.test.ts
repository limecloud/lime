import { describe, expect, it, vi } from "vitest";
import { createLayeredDesignNativeTextOcrProvider } from "./analyzer";
import {
  createLayeredDesignAnalyzerModelSlotsFromTransport,
  createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders,
  createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor,
  createLayeredDesignFlatImageAnalyzerFromModelSlotTransport,
} from "./analyzerModelSlotAnalyzer";
import type { LayeredDesignAnalyzerModelSlotConfigInput } from "./analyzerModelSlotConfig";
import {
  type LayeredDesignAnalyzerModelSlotTransport,
  type LayeredDesignAnalyzerModelSlotTransportJsonRequest,
  type LayeredDesignAnalyzerModelSlotTransportJsonResult,
} from "./analyzerModelSlotTransport";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const MODEL_SLOT_CONFIGS: readonly LayeredDesignAnalyzerModelSlotConfigInput[] =
  [
    {
      id: "subject-slot",
      kind: "subject_matting",
      label: "Remote subject matting slot",
      execution: "remote_model",
      modelId: "remote-matting-v1",
      metadata: {
        providerId: "remote-layering",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "clean-slot",
      kind: "clean_plate",
      label: "Remote clean plate slot",
      execution: "remote_model",
      modelId: "remote-inpaint-v1",
      metadata: {
        providerId: "remote-layering",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "ocr-slot",
      kind: "text_ocr",
      label: "Remote OCR slot",
      execution: "remote_model",
      modelId: "remote-ocr-v1",
      metadata: {
        providerId: "remote-layering",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
  ];

function createRasterizerFactory() {
  return vi.fn(async () => ({
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
  }));
}

describe("createLayeredDesignFlatImageAnalyzerFromModelSlotTransport", () => {
  it("应把 model slot configs + transport 收口成 current flat image analyzer", async () => {
    const transport: LayeredDesignAnalyzerModelSlotTransport = {
      executeSubjectMatting: vi.fn(async (request) => ({
        imageSrc: `data:image/png;base64,matted-${request.input.subject.id}`,
        maskSrc: "data:image/png;base64,subject-mask",
        confidence: 0.98,
        hasAlpha: true,
      })),
      executeCleanPlate: vi.fn(async (request) => ({
        src: request.input.image.src,
        message: "remote clean plate ready",
        params: {
          provider: String(request.context.metadata.providerLabel ?? ""),
          model: String(request.context.metadata.modelId ?? ""),
        },
      })),
      executeTextOcr: vi.fn(async (request) => [
        {
          text: "REMOTE OCR",
          boundingBox: {
            x: 2,
            y: 3,
            width: request.input.candidate.asset.width - 4,
            height: request.input.candidate.asset.height - 6,
          },
          confidence: 0.99,
        },
      ]),
    };
    const analyzer = createLayeredDesignFlatImageAnalyzerFromModelSlotTransport(
      MODEL_SLOT_CONFIGS,
      transport,
      {
        fallbackAnalyzer: null,
        rasterizerFactory: createRasterizerFactory(),
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
      analyzer: {
        label: "Worker local heuristic analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: true,
        cleanPlate: true,
        ocrText: true,
      },
      providerCapabilities: [
        { label: "Remote subject matting slot", modelId: "remote-matting-v1" },
        { label: "Remote clean plate slot", modelId: "remote-inpaint-v1" },
        { label: "Remote OCR slot", modelId: "remote-ocr-v1" },
      ],
    });
    const subjectCandidate = result.candidates.find(
      (candidate) => candidate.id === "subject-candidate",
    );
    expect(subjectCandidate).toMatchObject({
      confidence: 0.98,
      layer: {
        type: "image",
        maskAssetId: "subject-mask",
      },
    });
    const subjectAsset = subjectCandidate?.assets?.find(
      (asset) => asset.kind === "subject",
    );
    const subjectMaskAsset = subjectCandidate?.assets?.find(
      (asset) => asset.id === "subject-mask",
    );
    expect(subjectAsset?.src).toBe(
      "data:image/png;base64,matted-subject-candidate",
    );
    expect(subjectAsset?.params?.modelSlotExecution).toMatchObject({
      slotId: "subject-slot",
      slotKind: "subject_matting",
      status: "succeeded",
    });
    expect(subjectMaskAsset?.src).toBe("data:image/png;base64,subject-mask");
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      role: "text",
      layer: {
        type: "text",
        text: "REMOTE OCR",
      },
    });
    expect(result.cleanPlate).toMatchObject({
      status: "succeeded",
      asset: {
        params: {
          modelSlotExecution: expect.objectContaining({
            slotId: "clean-slot",
            slotKind: "clean_plate",
            status: "succeeded",
          }),
        },
      },
    });
    expect(transport.executeSubjectMatting).toHaveBeenCalledTimes(1);
    expect(transport.executeCleanPlate).toHaveBeenCalledTimes(1);
    expect(transport.executeTextOcr).toHaveBeenCalledTimes(2);
  });

  it("应允许只配置部分 model slot，并让其余拆层能力继续走 heuristic fallback", () => {
    const slots = createLayeredDesignAnalyzerModelSlotsFromTransport(
      [MODEL_SLOT_CONFIGS[2]],
      {},
    );

    expect(slots).toMatchObject({
      textOcrSlot: {
        kind: "text_ocr",
        capability: {
          label: "Remote OCR slot",
        },
      },
    });
    expect(slots.subjectMattingSlot).toBeUndefined();
    expect(slots.cleanPlateSlot).toBeUndefined();
  });

  it("应把标准 JSON executor 直接收口成 current flat image analyzer", async () => {
    const requests: LayeredDesignAnalyzerModelSlotTransportJsonRequest[] = [];
    const executor = vi.fn(
      async (
        request: LayeredDesignAnalyzerModelSlotTransportJsonRequest,
      ): Promise<LayeredDesignAnalyzerModelSlotTransportJsonResult> => {
        requests.push(request);
        expect("signal" in request.context).toBe(false);
        expect("config" in request.context).toBe(false);

        if (request.kind === "subject_matting") {
          return {
            kind: "subject_matting",
            result: {
              imageSrc: `data:image/png;base64,json-matted-${request.context.slotId}`,
              maskSrc: "data:image/png;base64,json-subject-mask",
              confidence: 0.97,
              hasAlpha: true,
            },
          };
        }

        if (request.kind === "clean_plate") {
          return {
            kind: "clean_plate",
            result: {
              src: "data:image/png;base64,json-clean-plate",
              params: {
                source: "json-executor",
                modelId: request.context.modelId,
              },
            },
          };
        }

        return {
          kind: "text_ocr",
          result: [
            {
              text: "JSON ANALYZER OCR",
              boundingBox: { x: 6, y: 7, width: 120, height: 32 },
              confidence: 0.94,
            },
          ],
        };
      },
    );
    const analyzer =
      createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(
        MODEL_SLOT_CONFIGS,
        executor,
        {
          fallbackAnalyzer: null,
          rasterizerFactory: createRasterizerFactory(),
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
        { label: "Remote subject matting slot", modelId: "remote-matting-v1" },
        { label: "Remote clean plate slot", modelId: "remote-inpaint-v1" },
        { label: "Remote OCR slot", modelId: "remote-ocr-v1" },
      ],
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "subject-candidate",
      ),
    ).toMatchObject({
      confidence: 0.97,
      layer: {
        type: "image",
        maskAssetId: "subject-mask",
      },
    });
    expect(
      result.candidates
        .flatMap((candidate) => candidate.assets ?? [])
        .find((asset) => asset.kind === "subject"),
    ).toMatchObject({
      src: "data:image/png;base64,json-matted-subject-slot",
      params: {
        modelSlotExecution: {
          slotId: "subject-slot",
          slotKind: "subject_matting",
          modelId: "remote-matting-v1",
          status: "succeeded",
        },
      },
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      role: "text",
      layer: {
        type: "text",
        text: "JSON ANALYZER OCR",
      },
    });
    expect(result.cleanPlate).toMatchObject({
      status: "succeeded",
      asset: {
        src: "data:image/png;base64,json-clean-plate",
        params: {
          source: "json-executor",
          modelSlotExecution: {
            slotId: "clean-slot",
            slotKind: "clean_plate",
            modelId: "remote-inpaint-v1",
            status: "succeeded",
          },
        },
      },
    });
    expect(executor).toHaveBeenCalledTimes(4);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "subject_matting",
          context: expect.objectContaining({
            slotId: "subject-slot",
            slotKind: "subject_matting",
            providerId: "remote-layering",
            modelId: "remote-matting-v1",
            attempt: 1,
          }),
        }),
        expect.objectContaining({
          kind: "clean_plate",
          context: expect.objectContaining({
            slotId: "clean-slot",
            modelId: "remote-inpaint-v1",
          }),
        }),
        expect.objectContaining({
          kind: "text_ocr",
          context: expect.objectContaining({
            slotId: "ocr-slot",
            modelId: "remote-ocr-v1",
          }),
        }),
      ]),
    );
  });

  it("应把 native OCR provider 经标准 JSON executor 接回 current analyzer", async () => {
    const recognizeText = vi.fn(
      async (request: {
        imageSrc: string;
        width: number;
        height: number;
        candidateId?: string;
      }) => ({
        supported: true,
        engine: "mock-native-ocr",
        blocks: [
          {
            text: `NATIVE OCR ${request.candidateId}`,
            boundingBox: { x: 3, y: 5, width: 128, height: 34 },
            confidence: 0.88,
          },
        ],
      }),
    );
    const analyzer =
      createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders(
        [MODEL_SLOT_CONFIGS[2]],
        {
          nativeTextOcrProvider:
            createLayeredDesignNativeTextOcrProvider(recognizeText),
          workerTextOcrProvider: null,
          fallbackAnalyzer: null,
          rasterizerFactory: createRasterizerFactory(),
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

    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      role: "text",
      layer: {
        type: "text",
        text: "NATIVE OCR headline-candidate",
        params: {
          modelSlotExecution: {
            slotId: "ocr-slot",
            slotKind: "text_ocr",
            modelId: "remote-ocr-v1",
            status: "succeeded",
          },
        },
      },
    });
    expect(recognizeText).toHaveBeenCalledWith(
      expect.objectContaining({
        imageSrc: "data:image/png;base64,crop-108-84",
        width: 684,
        height: 252,
        candidateId: "headline-candidate",
      }),
    );
  });
});
