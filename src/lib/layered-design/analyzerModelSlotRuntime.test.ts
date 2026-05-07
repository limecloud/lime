import { describe, expect, it, vi } from "vitest";
import { createLayeredDesignFlatImageAnalyzerFromStructuredProvider } from "./analyzer";
import {
  createLayeredDesignCleanPlateModelSlotFromConfig,
  createLayeredDesignSubjectMattingModelSlotFromConfig,
  createLayeredDesignTextOcrModelSlotFromConfig,
  type LayeredDesignAnalyzerModelSlotExecutionContext,
} from "./analyzerModelSlotRuntime";
import { createLayeredDesignWorkerHeuristicModelSlotOptions } from "./analyzerModelSlots";
import type { LayeredDesignFlatImageTextOcrProviderInput } from "./analyzer";
import type { LayeredDesignCleanPlateInput } from "./cleanPlate";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";
import type { LayeredDesignSubjectMattingInput } from "./subjectMatting";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

function createSubjectInput(): LayeredDesignSubjectMattingInput {
  return {
    image: {
      src: "data:image/png;base64,flat",
      width: 512,
      height: 768,
      mimeType: "image/png",
    },
    createdAt: CREATED_AT,
    subject: {
      id: "subject",
      name: "主体",
      rect: { x: 24, y: 40, width: 160, height: 240 },
      confidence: 0.92,
      zIndex: 20,
      crop: {
        src: "data:image/png;base64,crop",
        width: 160,
        height: 240,
        mimeType: "image/png",
      },
    },
  };
}

function createCleanPlateInput(): LayeredDesignCleanPlateInput {
  return {
    ...createSubjectInput(),
    subject: {
      ...createSubjectInput().subject,
      maskSrc: "data:image/png;base64,mask",
    },
  };
}

function createOcrInput(): LayeredDesignFlatImageTextOcrProviderInput {
  return {
    image: {
      src: "data:image/png;base64,flat",
      width: 512,
      height: 768,
      mimeType: "image/png",
    },
    candidate: {
      id: "headline",
      name: "标题",
      role: "text",
      rect: { x: 32, y: 48, width: 260, height: 96 },
      asset: {
        id: "headline-asset",
        kind: "text_raster",
        src: "data:image/png;base64,text",
        width: 260,
        height: 96,
        hasAlpha: false,
        createdAt: CREATED_AT,
      },
    },
  };
}

describe("layered-design analyzer model slot runtime", () => {
  it("应从 subject matting config 创建可执行 slot 并传入执行上下文", async () => {
    const execute = vi.fn(
      async (
        input: LayeredDesignSubjectMattingInput,
        context: LayeredDesignAnalyzerModelSlotExecutionContext,
      ) => {
        expect(input.subject.id).toBe("subject");
        expect(context.attempt).toBe(1);
        expect(context.config.id).toBe("subject-prod");
        expect(context.metadata).toMatchObject({
          slotId: "subject-prod",
          slotKind: "subject_matting",
          modelId: "remote-matting-v1",
          providerId: "remote-vision",
        });
        expect(context.signal.aborted).toBe(false);

        return {
          imageSrc: input.subject.crop.src,
          maskSrc: "data:image/png;base64,slot-mask",
          confidence: 0.98,
          hasAlpha: true,
        };
      },
    );

    const slot = createLayeredDesignSubjectMattingModelSlotFromConfig(
      {
        id: "subject-prod",
        kind: "subject_matting",
        label: "Remote subject matting",
        modelId: "remote-matting-v1",
        metadata: {
          providerId: "remote-vision",
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      { execute },
    );

    await expect(slot.execute(createSubjectInput())).resolves.toMatchObject({
      maskSrc: "data:image/png;base64,slot-mask",
      hasAlpha: true,
      params: {
        modelSlotExecution: {
          slotId: "subject-prod",
          slotKind: "subject_matting",
          modelId: "remote-matting-v1",
          attempt: 1,
          status: "succeeded",
          fallbackUsed: false,
        },
      },
    });
    expect(slot.capability).toMatchObject({
      kind: "subject_matting",
      label: "Remote subject matting",
      execution: "remote_model",
      modelId: "remote-matting-v1",
      quality: {
        productionReady: true,
        requiresHumanReview: false,
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("应按 maxAttempts 重试 clean plate slot 后返回成功结果", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({
        src: "data:image/png;base64,clean",
        params: { model: "remote-inpaint-v1" },
      });

    const slot = createLayeredDesignCleanPlateModelSlotFromConfig(
      {
        id: "clean-prod",
        kind: "clean_plate",
        label: "Remote clean plate",
        modelId: "remote-inpaint-v1",
        runtime: {
          maxAttempts: 2,
        },
        metadata: {
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      { execute },
    );

    await expect(slot.execute(createCleanPlateInput())).resolves.toMatchObject({
      src: "data:image/png;base64,clean",
      params: {
        model: "remote-inpaint-v1",
        modelSlotExecution: {
          slotId: "clean-prod",
          slotKind: "clean_plate",
          modelId: "remote-inpaint-v1",
          attempt: 2,
          maxAttempts: 2,
          status: "succeeded",
        },
      },
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[1].attempt)).toEqual([1, 2]);
  });

  it("return_null 策略应在执行失败时保持 current analyzer 主链不中断", async () => {
    const slot = createLayeredDesignCleanPlateModelSlotFromConfig(
      {
        id: "clean-null",
        kind: "clean_plate",
        label: "Remote clean plate nullable",
        modelId: "remote-inpaint-v1",
        runtime: {
          fallbackStrategy: "return_null",
        },
      },
      {
        execute: vi.fn(async () => {
          throw new Error("remote failed");
        }),
      },
    );

    await expect(slot.execute(createCleanPlateInput())).resolves.toBeNull();
  });

  it("throw 策略应把模型执行失败显式暴露给调用方", async () => {
    const slot = createLayeredDesignSubjectMattingModelSlotFromConfig(
      {
        id: "subject-throw",
        kind: "subject_matting",
        label: "Remote subject matting strict",
        modelId: "remote-matting-v1",
        runtime: {
          fallbackStrategy: "throw",
        },
      },
      {
        execute: vi.fn(async () => {
          throw new Error("strict failure");
        }),
      },
    );

    await expect(slot.execute(createSubjectInput())).rejects.toThrow(
      "strict failure",
    );
  });

  it("use_heuristic 策略应允许 OCR slot 回退到调用方注入的 heuristic", async () => {
    const fallback = vi.fn(
      async (
        _input: LayeredDesignFlatImageTextOcrProviderInput,
        context: LayeredDesignAnalyzerModelSlotExecutionContext,
        error: unknown,
      ) => {
        expect(error).toBeInstanceOf(Error);
        expect(context.metadata).toMatchObject({
          slotId: "ocr-fallback",
          fallbackStrategy: "use_heuristic",
        });

        return [
          {
            text: "HEURISTIC OCR",
            boundingBox: { x: 0, y: 0, width: 120, height: 40 },
            confidence: 0.72,
          },
        ];
      },
    );
    const slot = createLayeredDesignTextOcrModelSlotFromConfig(
      {
        id: "ocr-fallback",
        kind: "text_ocr",
        label: "Remote OCR with fallback",
        modelId: "remote-ocr-v1",
        runtime: {
          fallbackStrategy: "use_heuristic",
        },
      },
      {
        execute: vi.fn(async () => {
          throw new Error("ocr unavailable");
        }),
        fallback,
      },
    );

    await expect(slot.execute(createOcrInput())).resolves.toMatchObject([
      {
        text: "HEURISTIC OCR",
        boundingBox: { x: 0, y: 0, width: 120, height: 40 },
        confidence: 0.72,
        params: {
          modelSlotExecution: {
            slotId: "ocr-fallback",
            slotKind: "text_ocr",
            fallbackStrategy: "use_heuristic",
            fallbackUsed: true,
            status: "fallback_succeeded",
          },
        },
      },
    ]);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("config kind 不匹配时应拒绝创建可执行 slot", () => {
    expect(() =>
      createLayeredDesignSubjectMattingModelSlotFromConfig(
        {
          id: "wrong-kind",
          kind: "text_ocr",
          label: "Wrong kind",
          modelId: "ocr-v1",
        },
        {
          execute: vi.fn(async () => null),
        },
      ),
    ).toThrow("Layered design analyzer model slot config kind mismatch");
  });

  it("执行证据应穿过 Worker heuristic analyzer 回到候选资产和 TextLayer params", async () => {
    const subjectSlot = createLayeredDesignSubjectMattingModelSlotFromConfig(
      {
        id: "subject-runtime",
        kind: "subject_matting",
        label: "Runtime subject matting",
        modelId: "runtime-matting-v1",
        metadata: {
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      {
        execute: vi.fn(async (input) => ({
          imageSrc: `data:image/png;base64,subject-${input.subject.rect.width}`,
          maskSrc: "data:image/png;base64,subject-mask",
          confidence: 0.98,
          hasAlpha: true,
        })),
      },
    );
    const cleanPlateSlot = createLayeredDesignCleanPlateModelSlotFromConfig(
      {
        id: "clean-runtime",
        kind: "clean_plate",
        label: "Runtime clean plate",
        modelId: "runtime-inpaint-v1",
        runtime: { maxAttempts: 2 },
        metadata: {
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      {
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error("retry once"))
          .mockResolvedValueOnce({
            src: "data:image/png;base64,clean-runtime",
            params: { provider: "Runtime clean plate" },
          }),
      },
    );
    const textSlot = createLayeredDesignTextOcrModelSlotFromConfig(
      {
        id: "ocr-runtime",
        kind: "text_ocr",
        label: "Runtime OCR",
        modelId: "runtime-ocr-v1",
        metadata: {
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      {
        execute: vi.fn(async () => [
          {
            text: "RUNTIME OCR",
            boundingBox: { x: 4, y: 5, width: 120, height: 40 },
            confidence: 0.99,
          },
        ]),
      },
    );
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        ...createLayeredDesignWorkerHeuristicModelSlotOptions({
          subjectMattingSlot: subjectSlot,
          cleanPlateSlot,
          textOcrSlot: textSlot,
        }),
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
      { fallbackAnalyzer: null },
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

    const subjectCandidate = result.candidates.find(
      (candidate) => candidate.id === "subject-candidate",
    );
    expect(
      subjectCandidate?.assets?.find((asset) => asset.kind === "subject"),
    ).toMatchObject({
      params: {
        modelSlotExecution: {
          slotId: "subject-runtime",
          modelId: "runtime-matting-v1",
          attempt: 1,
          status: "succeeded",
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
        text: "RUNTIME OCR",
        params: {
          modelSlotExecution: {
            slotId: "ocr-runtime",
            modelId: "runtime-ocr-v1",
            attempt: 1,
          },
        },
      },
    });
    expect(result.cleanPlate).toMatchObject({
      asset: {
        params: {
          seed: "worker_heuristic_clean_plate_provider",
          provider: "Runtime clean plate",
          modelSlotExecution: {
            slotId: "clean-runtime",
            modelId: "runtime-inpaint-v1",
            attempt: 2,
            maxAttempts: 2,
          },
        },
      },
    });
  });
});
