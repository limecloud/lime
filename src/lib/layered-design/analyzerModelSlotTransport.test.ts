import { describe, expect, it, vi } from "vitest";
import type { LayeredDesignFlatImageTextOcrProviderInput } from "./analyzer";
import type { LayeredDesignCleanPlateInput } from "./cleanPlate";
import type { LayeredDesignSubjectMattingInput } from "./subjectMatting";
import {
  createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders,
  createLayeredDesignAnalyzerModelSlotTransportError,
  createLayeredDesignAnalyzerModelSlotTransportFromHandler,
  createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor,
  createLayeredDesignCleanPlateModelSlotFromTransport,
  createLayeredDesignSubjectMattingModelSlotFromTransport,
  createLayeredDesignTextOcrModelSlotFromTransport,
  isLayeredDesignAnalyzerModelSlotTransportError,
  normalizeLayeredDesignAnalyzerModelSlotTransportError,
  type LayeredDesignAnalyzerModelSlotTransportJsonRequest,
  type LayeredDesignAnalyzerModelSlotTransportJsonResult,
  type LayeredDesignAnalyzerModelSlotTransport,
} from "./analyzerModelSlotTransport";

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
  const subjectInput = createSubjectInput();

  return {
    ...subjectInput,
    subject: {
      ...subjectInput.subject,
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

describe("layered-design analyzer model slot transport", () => {
  it("应把 subject matting transport 包装成 current model slot 并保留执行证据", async () => {
    const transport: LayeredDesignAnalyzerModelSlotTransport = {
      executeSubjectMatting: vi.fn(async (request) => {
        expect(request.kind).toBe("subject_matting");
        expect(request.input.subject.id).toBe("subject");
        expect(request.context.attempt).toBe(1);
        expect(request.context.metadata).toMatchObject({
          slotId: "subject-transport",
          slotKind: "subject_matting",
          providerId: "native-vision",
          modelId: "native-matting-v1",
        });
        expect(request.context.signal.aborted).toBe(false);

        return {
          imageSrc: "data:image/png;base64,subject-alpha",
          maskSrc: "data:image/png;base64,subject-mask",
          confidence: 0.98,
          hasAlpha: true,
        };
      }),
    };

    const slot = createLayeredDesignSubjectMattingModelSlotFromTransport(
      {
        id: "subject-transport",
        kind: "subject_matting",
        label: "Native subject matting",
        modelId: "native-matting-v1",
        metadata: {
          providerId: "native-vision",
          productionReady: true,
          requiresHumanReview: false,
        },
      },
      transport,
    );

    await expect(slot.execute(createSubjectInput())).resolves.toMatchObject({
      imageSrc: "data:image/png;base64,subject-alpha",
      maskSrc: "data:image/png;base64,subject-mask",
      params: {
        modelSlotExecution: {
          slotId: "subject-transport",
          slotKind: "subject_matting",
          providerLabel: "Native subject matting",
          providerId: "native-vision",
          modelId: "native-matting-v1",
          attempt: 1,
          status: "succeeded",
          fallbackUsed: false,
        },
      },
    });
    expect(transport.executeSubjectMatting).toHaveBeenCalledTimes(1);
  });

  it("应把 clean plate transport 结果接回 runtime retry 与证据写回", async () => {
    const transport: LayeredDesignAnalyzerModelSlotTransport = {
      executeCleanPlate: vi
        .fn()
        .mockRejectedValueOnce(new Error("remote busy"))
        .mockImplementationOnce(async (request) => {
          expect(request.kind).toBe("clean_plate");
          expect(request.input.subject.maskSrc).toBe(
            "data:image/png;base64,mask",
          );
          expect(request.context.attempt).toBe(2);
          expect(request.context.metadata).toMatchObject({
            slotId: "clean-transport",
            slotKind: "clean_plate",
            modelId: "remote-inpaint-v2",
          });

          return {
            src: "data:image/png;base64,clean",
            params: { transport: "remote" },
          };
        }),
    };

    const slot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-transport",
        kind: "clean_plate",
        label: "Remote clean plate",
        modelId: "remote-inpaint-v2",
        runtime: {
          maxAttempts: 2,
        },
      },
      transport,
    );

    await expect(slot.execute(createCleanPlateInput())).resolves.toMatchObject({
      src: "data:image/png;base64,clean",
      params: {
        transport: "remote",
        modelSlotExecution: {
          slotId: "clean-transport",
          slotKind: "clean_plate",
          modelId: "remote-inpaint-v2",
          attempt: 2,
          maxAttempts: 2,
          status: "succeeded",
        },
      },
    });
    expect(transport.executeCleanPlate).toHaveBeenCalledTimes(2);
  });

  it("应把 OCR transport blocks 自动装饰为可导出的执行证据", async () => {
    const transport: LayeredDesignAnalyzerModelSlotTransport = {
      executeTextOcr: vi.fn(async (request) => {
        expect(request.kind).toBe("text_ocr");
        expect(request.input.candidate.id).toBe("headline");
        expect(request.context.metadata).toMatchObject({
          slotId: "ocr-transport",
          slotKind: "text_ocr",
          modelId: "remote-ocr-v2",
        });

        return [
          {
            text: "REMOTE OCR",
            boundingBox: { x: 8, y: 12, width: 180, height: 42 },
            confidence: 0.96,
          },
        ];
      }),
    };

    const slot = createLayeredDesignTextOcrModelSlotFromTransport(
      {
        id: "ocr-transport",
        kind: "text_ocr",
        label: "Remote OCR",
        modelId: "remote-ocr-v2",
      },
      transport,
    );

    await expect(slot.execute(createOcrInput())).resolves.toMatchObject([
      {
        text: "REMOTE OCR",
        params: {
          modelSlotExecution: {
            slotId: "ocr-transport",
            slotKind: "text_ocr",
            modelId: "remote-ocr-v2",
            attempt: 1,
            status: "succeeded",
          },
        },
      },
    ]);
    expect(transport.executeTextOcr).toHaveBeenCalledTimes(1);
  });

  it("统一 transport handler 应按 kind 路由三类 model slot 请求", async () => {
    const handler = vi.fn(async (request) => {
      expect(request.context.metadata).toMatchObject({
        slotId: request.context.config.id,
        slotKind: request.kind,
      });

      if (request.kind === "subject_matting") {
        return {
          imageSrc: `data:image/png;base64,${request.context.config.id}-alpha`,
          maskSrc: `data:image/png;base64,${request.context.config.id}-mask`,
          confidence: 0.97,
          hasAlpha: true,
        };
      }

      if (request.kind === "clean_plate") {
        return {
          src: `data:image/png;base64,${request.context.config.id}-clean`,
          params: {
            modelId: request.context.config.modelId,
          },
        };
      }

      return [
        {
          text: `OCR ${request.context.config.modelId}`,
          boundingBox: { x: 0, y: 0, width: 120, height: 40 },
          confidence: 0.96,
        },
      ];
    });
    const transport =
      createLayeredDesignAnalyzerModelSlotTransportFromHandler(handler);
    const subjectSlot = createLayeredDesignSubjectMattingModelSlotFromTransport(
      {
        id: "subject-handler",
        kind: "subject_matting",
        label: "Handler subject",
        modelId: "handler-matting-v1",
      },
      transport,
    );
    const cleanSlot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-handler",
        kind: "clean_plate",
        label: "Handler clean plate",
        modelId: "handler-inpaint-v1",
      },
      transport,
    );
    const ocrSlot = createLayeredDesignTextOcrModelSlotFromTransport(
      {
        id: "ocr-handler",
        kind: "text_ocr",
        label: "Handler OCR",
        modelId: "handler-ocr-v1",
      },
      transport,
    );

    await expect(subjectSlot.execute(createSubjectInput())).resolves.toMatchObject({
      imageSrc: "data:image/png;base64,subject-handler-alpha",
      maskSrc: "data:image/png;base64,subject-handler-mask",
      params: {
        modelSlotExecution: {
          slotId: "subject-handler",
          slotKind: "subject_matting",
        },
      },
    });
    await expect(cleanSlot.execute(createCleanPlateInput())).resolves.toMatchObject({
      src: "data:image/png;base64,clean-handler-clean",
      params: {
        modelId: "handler-inpaint-v1",
        modelSlotExecution: {
          slotId: "clean-handler",
          slotKind: "clean_plate",
        },
      },
    });
    await expect(ocrSlot.execute(createOcrInput())).resolves.toMatchObject([
      {
        text: "OCR handler-ocr-v1",
        params: {
          modelSlotExecution: {
            slotId: "ocr-handler",
            slotKind: "text_ocr",
          },
        },
      },
    ]);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("统一 transport handler 返回非法结果时应输出 invalid_response 分类", async () => {
    const transport = createLayeredDesignAnalyzerModelSlotTransportFromHandler(
      async () => ({ unexpected: true }) as never,
    );
    const slot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-invalid-response",
        kind: "clean_plate",
        label: "Invalid clean plate handler",
        modelId: "handler-inpaint-v1",
        runtime: {
          fallbackStrategy: "throw",
        },
      },
      transport,
    );

    await expect(slot.execute(createCleanPlateInput())).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
      details: {
        kind: "clean_plate",
        slotId: "clean-invalid-response",
        modelId: "handler-inpaint-v1",
      },
    });
  });

  it("标准 JSON executor 应接收可序列化 context 并执行三类 model slot", async () => {
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
              imageSrc: `data:image/png;base64,${request.context.slotId}-alpha`,
              maskSrc: `data:image/png;base64,${request.context.slotId}-mask`,
              confidence: 0.98,
              hasAlpha: true,
            },
          };
        }

        if (request.kind === "clean_plate") {
          return {
            kind: "clean_plate",
            result: {
              src: `data:image/png;base64,${request.context.modelId}-clean`,
              params: {
                modelId: request.context.modelId,
              },
            },
          };
        }

        return {
          kind: "text_ocr",
          result: [
            {
              text: `JSON OCR ${request.context.modelId}`,
              boundingBox: { x: 4, y: 8, width: 160, height: 38 },
              confidence: 0.95,
            },
          ],
        };
      },
    );
    const transport =
      createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(executor);
    const subjectSlot = createLayeredDesignSubjectMattingModelSlotFromTransport(
      {
        id: "subject-json",
        kind: "subject_matting",
        label: "JSON subject",
        modelId: "json-matting-v1",
        runtime: {
          timeoutMs: 12_000,
        },
        metadata: {
          providerId: "json-provider",
          modelVersion: "2026-05",
        },
      },
      transport,
    );
    const cleanSlot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-json",
        kind: "clean_plate",
        label: "JSON clean plate",
        modelId: "json-inpaint-v1",
        metadata: {
          providerId: "json-provider",
        },
      },
      transport,
    );
    const ocrSlot = createLayeredDesignTextOcrModelSlotFromTransport(
      {
        id: "ocr-json",
        kind: "text_ocr",
        label: "JSON OCR",
        modelId: "json-ocr-v1",
      },
      transport,
    );

    await expect(subjectSlot.execute(createSubjectInput())).resolves.toMatchObject(
      {
        imageSrc: "data:image/png;base64,subject-json-alpha",
        maskSrc: "data:image/png;base64,subject-json-mask",
        params: {
          modelSlotExecution: {
            slotId: "subject-json",
            slotKind: "subject_matting",
            providerId: "json-provider",
            modelVersion: "2026-05",
            modelId: "json-matting-v1",
            attempt: 1,
            timeoutMs: 12_000,
            status: "succeeded",
          },
        },
      },
    );
    await expect(cleanSlot.execute(createCleanPlateInput())).resolves.toMatchObject(
      {
        src: "data:image/png;base64,json-inpaint-v1-clean",
        params: {
          modelId: "json-inpaint-v1",
          modelSlotExecution: {
            slotId: "clean-json",
            slotKind: "clean_plate",
            providerId: "json-provider",
            modelId: "json-inpaint-v1",
            attempt: 1,
            status: "succeeded",
          },
        },
      },
    );
    await expect(ocrSlot.execute(createOcrInput())).resolves.toMatchObject([
      {
        text: "JSON OCR json-ocr-v1",
        params: {
          modelSlotExecution: {
            slotId: "ocr-json",
            slotKind: "text_ocr",
            modelId: "json-ocr-v1",
            attempt: 1,
            status: "succeeded",
          },
        },
      },
    ]);
    expect(executor).toHaveBeenCalledTimes(3);
    expect(requests).toMatchObject([
      {
        kind: "subject_matting",
        context: {
          slotId: "subject-json",
          slotKind: "subject_matting",
          providerLabel: "JSON subject",
          providerId: "json-provider",
          modelVersion: "2026-05",
          modelId: "json-matting-v1",
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 12_000,
          fallbackStrategy: "return_null",
          metadata: {
            slotId: "subject-json",
            slotKind: "subject_matting",
            providerId: "json-provider",
          },
        },
      },
      {
        kind: "clean_plate",
        context: {
          slotId: "clean-json",
          modelId: "json-inpaint-v1",
          providerId: "json-provider",
        },
      },
      {
        kind: "text_ocr",
        context: {
          slotId: "ocr-json",
          modelId: "json-ocr-v1",
        },
      },
    ]);
  });

  it("标准 JSON executor kind 不匹配时应输出 invalid_response 分类", async () => {
    const transport =
      createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(
        async () => ({
          kind: "text_ocr",
          result: [],
        }),
      );
    const slot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-json-kind-mismatch",
        kind: "clean_plate",
        label: "JSON clean plate strict",
        modelId: "json-inpaint-v1",
        runtime: {
          fallbackStrategy: "throw",
        },
      },
      transport,
    );

    await expect(slot.execute(createCleanPlateInput())).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
      details: {
        kind: "clean_plate",
        slotId: "clean-json-kind-mismatch",
        modelId: "json-inpaint-v1",
        expectedKind: "clean_plate",
        receivedKind: "text_ocr",
      },
    });
  });

  it("provider JSON executor 应把三类 provider 接入标准 JSON result", async () => {
    const subjectProvider = {
      label: "Provider subject",
      matteSubject: vi.fn(async (input: LayeredDesignSubjectMattingInput) => ({
        imageSrc: `data:image/png;base64,provider-${input.subject.id}`,
        maskSrc: "data:image/png;base64,provider-mask",
        confidence: 0.91,
        hasAlpha: true,
      })),
    };
    const cleanPlateProvider = {
      label: "Provider clean plate",
      createCleanPlate: vi.fn(async (input: LayeredDesignCleanPlateInput) => ({
        src: input.image.src,
        params: {
          provider: "Provider clean plate",
          model: "provider-clean-v1",
        },
      })),
    };
    const textOcrProvider = {
      label: "Provider OCR",
      detectText: vi.fn(
        async (input: LayeredDesignFlatImageTextOcrProviderInput) => [
          {
            text: `PROVIDER OCR ${input.candidate.id}`,
            boundingBox: { x: 1, y: 2, width: 120, height: 24 },
            confidence: 0.9,
          },
        ],
      ),
    };
    const executor =
      createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders({
        subjectMattingProvider: subjectProvider,
        cleanPlateProvider,
        textOcrProvider,
      });

    await expect(
      executor({
        kind: "subject_matting",
        input: createSubjectInput(),
        context: {
          slotId: "subject-provider",
          slotKind: "subject_matting",
          providerLabel: "Provider subject slot",
          modelId: "provider-subject-v1",
          execution: "browser_worker",
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 45_000,
          fallbackStrategy: "return_null",
          metadata: {},
        },
      }),
    ).resolves.toMatchObject({
      kind: "subject_matting",
      result: {
        imageSrc: "data:image/png;base64,provider-subject",
        maskSrc: "data:image/png;base64,provider-mask",
      },
    });
    await expect(
      executor({
        kind: "clean_plate",
        input: createCleanPlateInput(),
        context: {
          slotId: "clean-provider",
          slotKind: "clean_plate",
          providerLabel: "Provider clean slot",
          modelId: "provider-clean-v1",
          execution: "browser_worker",
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 45_000,
          fallbackStrategy: "return_null",
          metadata: {},
        },
      }),
    ).resolves.toMatchObject({
      kind: "clean_plate",
      result: {
        src: "data:image/png;base64,flat",
        params: {
          provider: "Provider clean plate",
          model: "provider-clean-v1",
        },
      },
    });
    await expect(
      executor({
        kind: "text_ocr",
        input: createOcrInput(),
        context: {
          slotId: "ocr-provider",
          slotKind: "text_ocr",
          providerLabel: "Provider OCR slot",
          modelId: "provider-ocr-v1",
          execution: "browser_worker",
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 45_000,
          fallbackStrategy: "return_null",
          metadata: {},
        },
      }),
    ).resolves.toMatchObject({
      kind: "text_ocr",
      result: [
        {
          text: "PROVIDER OCR headline",
        },
      ],
    });
    expect(subjectProvider.matteSubject).toHaveBeenCalledTimes(1);
    expect(cleanPlateProvider.createCleanPlate).toHaveBeenCalledTimes(1);
    expect(textOcrProvider.detectText).toHaveBeenCalledTimes(1);
  });

  it("provider JSON executor 缺少对应 provider 时应输出 missing_handler 分类", async () => {
    const executor =
      createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders({});

    await expect(
      executor({
        kind: "clean_plate",
        input: createCleanPlateInput(),
        context: {
          slotId: "clean-provider-missing",
          slotKind: "clean_plate",
          providerLabel: "Provider clean slot",
          modelId: "provider-clean-v1",
          execution: "browser_worker",
          attempt: 1,
          maxAttempts: 1,
          timeoutMs: 45_000,
          fallbackStrategy: "return_null",
          metadata: {},
        },
      }),
    ).rejects.toMatchObject({
      code: "missing_handler",
      retryable: false,
      details: {
        kind: "clean_plate",
        slotId: "clean-provider-missing",
        modelId: "provider-clean-v1",
      },
    });
  });

  it("缺失 transport handler 时应服从 return_null 策略并保持主链不中断", async () => {
    const slot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-missing-handler",
        kind: "clean_plate",
        label: "Remote clean plate missing handler",
        modelId: "remote-inpaint-v2",
        runtime: {
          fallbackStrategy: "return_null",
        },
      },
      {},
    );

    await expect(slot.execute(createCleanPlateInput())).resolves.toBeNull();
  });

  it("缺失 transport handler 且 throw 策略时应抛出稳定错误分类", async () => {
    const slot = createLayeredDesignCleanPlateModelSlotFromTransport(
      {
        id: "clean-missing-handler-throw",
        kind: "clean_plate",
        label: "Remote clean plate missing handler strict",
        modelId: "remote-inpaint-v2",
        runtime: {
          fallbackStrategy: "throw",
        },
      },
      {},
    );

    try {
      await slot.execute(createCleanPlateInput());
      throw new Error("expected transport error");
    } catch (error) {
      expect(isLayeredDesignAnalyzerModelSlotTransportError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "missing_handler",
        retryable: false,
        details: {
          kind: "clean_plate",
          slotId: "clean-missing-handler-throw",
          modelId: "remote-inpaint-v2",
        },
      });
    }
  });

  it("transport handler 可抛出可重试的远端错误并由 runtime 保留分类", async () => {
    const transport: LayeredDesignAnalyzerModelSlotTransport = {
      executeSubjectMatting: vi.fn(async () => {
        throw createLayeredDesignAnalyzerModelSlotTransportError({
          code: "rate_limited",
          message: "remote model rate limited",
          retryable: true,
          statusCode: 429,
          providerErrorCode: "too_many_requests",
          details: {
            quotaWindowSeconds: 60,
          },
        });
      }),
    };
    const slot = createLayeredDesignSubjectMattingModelSlotFromTransport(
      {
        id: "subject-rate-limited",
        kind: "subject_matting",
        label: "Remote subject matting strict",
        modelId: "remote-matting-v2",
        runtime: {
          fallbackStrategy: "throw",
        },
      },
      transport,
    );

    await expect(slot.execute(createSubjectInput())).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      statusCode: 429,
      providerErrorCode: "too_many_requests",
      details: {
        quotaWindowSeconds: 60,
      },
    });
  });

  it("normalize transport error 应保留已分类错误并包装未知错误", () => {
    const classified = createLayeredDesignAnalyzerModelSlotTransportError({
      code: "invalid_response",
      message: "missing maskSrc",
      retryable: false,
    });

    expect(
      normalizeLayeredDesignAnalyzerModelSlotTransportError(classified),
    ).toBe(classified);
    expect(
      normalizeLayeredDesignAnalyzerModelSlotTransportError(new Error("boom"), {
        code: "remote_unavailable",
        message: "fallback message",
        retryable: true,
      }),
    ).toMatchObject({
      code: "remote_unavailable",
      message: "boom",
      retryable: true,
    });
  });

  it("config kind 不匹配时应沿用 runtime 拒绝创建 slot", () => {
    expect(() =>
      createLayeredDesignSubjectMattingModelSlotFromTransport(
        {
          id: "wrong-kind",
          kind: "text_ocr",
          label: "Wrong kind",
          modelId: "remote-ocr-v2",
        },
        {},
      ),
    ).toThrow("Layered design analyzer model slot config kind mismatch");
  });
});
