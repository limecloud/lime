import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignAnalyzerModelSlotHttpJsonExecutor,
  createLayeredDesignFlatImageAnalyzerFromModelSlotHttpJsonExecutor,
  type LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch,
} from "./analyzerModelSlotJsonExecutorClient";
import type { LayeredDesignAnalyzerModelSlotConfigInput } from "./analyzerModelSlotConfig";
import type {
  LayeredDesignAnalyzerModelSlotTransportJsonRequest,
  LayeredDesignAnalyzerModelSlotTransportJsonResult,
} from "./analyzerModelSlotTransport";

const CREATED_AT = "2026-05-08T00:00:00.000Z";
const MODEL_SLOT_CONFIGS: readonly LayeredDesignAnalyzerModelSlotConfigInput[] =
  [
    {
      id: "http-subject-slot",
      kind: "subject_matting",
      label: "HTTP subject matting slot",
      execution: "remote_model",
      modelId: "http-matting-v1",
      metadata: {
        providerId: "http-json-executor",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "http-clean-slot",
      kind: "clean_plate",
      label: "HTTP clean plate slot",
      execution: "remote_model",
      modelId: "http-inpaint-v1",
      metadata: {
        providerId: "http-json-executor",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
    {
      id: "http-ocr-slot",
      kind: "text_ocr",
      label: "HTTP OCR slot",
      execution: "remote_model",
      modelId: "http-ocr-v1",
      metadata: {
        providerId: "http-json-executor",
        productionReady: true,
        requiresHumanReview: false,
      },
    },
  ];

function createRasterizerFactory() {
  return vi.fn(async () => ({
    cropImageToPngDataUrl: vi.fn(async (rect) => {
      return `data:image/png;base64,http-crop-${rect.x}-${rect.y}`;
    }),
    cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
      return "data:image/png;base64,http-masked-fallback";
    }),
    createEllipseMaskDataUrl: vi.fn(async () => {
      return "data:image/png;base64,http-mask-fallback";
    }),
    createApproximateCleanPlateDataUrl: vi.fn(async () => {
      return "data:image/png;base64,http-clean-fallback";
    }),
  }));
}

function createHttpExecutorResult(
  request: LayeredDesignAnalyzerModelSlotTransportJsonRequest,
): LayeredDesignAnalyzerModelSlotTransportJsonResult {
  if (request.kind === "subject_matting") {
    return {
      kind: "subject_matting",
      result: {
        imageSrc: `data:image/png;base64,http-matted-${request.context.slotId}`,
        maskSrc: "data:image/png;base64,http-subject-mask",
        confidence: 0.99,
        hasAlpha: true,
        params: {
          foregroundPixelCount: 18_000,
          detectedForegroundPixelCount: 17_800,
          ellipseFallbackApplied: false,
          totalPixelCount: 20_000,
        },
      },
    };
  }

  if (request.kind === "clean_plate") {
    return {
      kind: "clean_plate",
      result: {
        src: "data:image/png;base64,http-clean-plate",
        params: {
          filledPixelCount: 12_000,
          totalSubjectPixelCount: 12_000,
          maskApplied: true,
        },
      },
    };
  }

  return {
    kind: "text_ocr",
    result: [
      {
        text: `HTTP OCR ${request.context.slotId}`,
        boundingBox: { x: 8, y: 10, width: 160, height: 36 },
        confidence: 0.96,
      },
    ],
  };
}

function createMinimalJsonRequest(): LayeredDesignAnalyzerModelSlotTransportJsonRequest {
  return {
    kind: "clean_plate",
    input: {
      image: {
        src: "data:image/png;base64,flat",
        width: 16,
        height: 16,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
      subject: {
        id: "subject",
        name: "主体",
        rect: { x: 1, y: 1, width: 8, height: 8 },
        confidence: 0.9,
        zIndex: 10,
        crop: {
          src: "data:image/png;base64,crop",
          width: 8,
          height: 8,
          mimeType: "image/png",
        },
      },
    },
    context: {
      slotId: "http-clean-slot",
      slotKind: "clean_plate",
      providerLabel: "HTTP clean plate slot",
      modelId: "http-inpaint-v1",
      execution: "remote_model",
      attempt: 1,
      maxAttempts: 1,
      timeoutMs: 45_000,
      fallbackStrategy: "return_null",
      metadata: {},
      qualityContract: {
        factSource: "LayeredDesignDocument.assets",
        requiredResultFields: ["src"],
        requiredParamKeys: [
          "filledPixelCount",
          "totalSubjectPixelCount",
          "maskApplied",
        ],
        reviewFindingIds: ["clean_plate_model_slot_quality_metadata_missing"],
      },
    },
  };
}

describe("layered-design analyzer model slot HTTP JSON executor client", () => {
  it("应把 provider-agnostic HTTP JSON executor 接入 current flat image analyzer", async () => {
    const requests: LayeredDesignAnalyzerModelSlotTransportJsonRequest[] = [];
    const fetchImpl: LayeredDesignAnalyzerModelSlotHttpJsonExecutorFetch = vi.fn(
      async (_url, init) => {
        const request = JSON.parse(
          init.body,
        ) as LayeredDesignAnalyzerModelSlotTransportJsonRequest;
        requests.push(request);

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => createHttpExecutorResult(request),
        };
      },
    );
    const analyzer =
      createLayeredDesignFlatImageAnalyzerFromModelSlotHttpJsonExecutor(
        MODEL_SLOT_CONFIGS,
        {
          endpointUrl: "http://127.0.0.1:4455/layered-design/model-slot",
          fetchImpl,
          headers: {
            "x-lime-fixture": "http-json-executor",
          },
        },
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

    expect(fetchImpl).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4455/layered-design/model-slot",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          accept: "application/json",
          "x-lime-fixture": "http-json-executor",
        }),
      }),
    );
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "subject_matting",
          context: expect.objectContaining({
            slotId: "http-subject-slot",
            qualityContract: expect.objectContaining({
              requiredParamKeys: expect.arrayContaining([
                "foregroundPixelCount",
                "ellipseFallbackApplied",
              ]),
            }),
          }),
        }),
        expect.objectContaining({
          kind: "clean_plate",
          context: expect.objectContaining({
            slotId: "http-clean-slot",
            qualityContract: expect.objectContaining({
              requiredParamKeys: expect.arrayContaining(["maskApplied"]),
            }),
          }),
        }),
        expect.objectContaining({
          kind: "text_ocr",
          context: expect.objectContaining({
            slotId: "http-ocr-slot",
            qualityContract: expect.objectContaining({
              requiredResultFields: ["text", "boundingBox", "confidence"],
            }),
          }),
        }),
      ]),
    );
    expect(
      result.candidates
        .flatMap((candidate) => candidate.assets ?? [])
        .find((asset) => asset.kind === "subject"),
    ).toMatchObject({
      src: "data:image/png;base64,http-matted-http-subject-slot",
      params: {
        qualityContractValidation: {
          status: "satisfied",
          missingParamKeys: [],
        },
        modelSlotExecution: {
          slotId: "http-subject-slot",
          status: "succeeded",
        },
      },
    });
    expect(result.cleanPlate).toMatchObject({
      status: "succeeded",
      asset: {
        src: "data:image/png;base64,http-clean-plate",
        params: {
          qualityContractValidation: {
            status: "satisfied",
            missingParamKeys: [],
          },
          modelSlotExecution: {
            slotId: "http-clean-slot",
            status: "succeeded",
          },
        },
      },
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      layer: {
        type: "text",
        text: "HTTP OCR http-ocr-slot",
        params: {
          qualityContractValidation: {
            status: "satisfied",
          },
          modelSlotExecution: {
            slotId: "http-ocr-slot",
            status: "succeeded",
          },
        },
      },
    });
  });

  it("HTTP 非成功状态应映射为 classified transport error", async () => {
    const executor = createLayeredDesignAnalyzerModelSlotHttpJsonExecutor({
      endpointUrl: "https://example.test/layered-design/model-slot",
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      })),
    });

    await expect(executor(createMinimalJsonRequest())).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      statusCode: 429,
      details: {
        endpointUrl: "https://example.test/layered-design/model-slot",
        kind: "clean_plate",
        slotId: "http-clean-slot",
        modelId: "http-inpaint-v1",
      },
    });
  });
});
