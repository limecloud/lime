import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignFlatImageAnalyzerFromStructuredProvider,
  type LayeredDesignFlatImageTextOcrProvider,
} from "./analyzer";
import {
  createLayeredDesignStructuredAnalyzerWorkerProvider,
  installLayeredDesignStructuredAnalyzerWorkerRuntime,
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
  type LayeredDesignStructuredAnalyzerWorkerMessageListener,
  type LayeredDesignStructuredAnalyzerWorkerRequest,
  type LayeredDesignStructuredAnalyzerWorkerResponse,
} from "./structuredAnalyzerWorker";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

class FakeStructuredAnalyzerWorker {
  readonly sentMessages: LayeredDesignStructuredAnalyzerWorkerRequest[] = [];
  private readonly listeners =
    new Set<LayeredDesignStructuredAnalyzerWorkerMessageListener>();

  postMessage(message: LayeredDesignStructuredAnalyzerWorkerRequest) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: LayeredDesignStructuredAnalyzerWorkerResponse) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

class FakeStructuredAnalyzerWorkerScope {
  readonly sentMessages: LayeredDesignStructuredAnalyzerWorkerResponse[] = [];
  private readonly listeners =
    new Set<LayeredDesignStructuredAnalyzerWorkerMessageListener>();

  postMessage(message: LayeredDesignStructuredAnalyzerWorkerResponse) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignStructuredAnalyzerWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushUntilScopeMessage(
  scope: FakeStructuredAnalyzerWorkerScope,
) {
  for (
    let index = 0;
    index < 8 && scope.sentMessages.length === 0;
    index += 1
  ) {
    await flushPromises();
  }
}

describe("LayeredDesign structured analyzer worker bridge", () => {
  it("应把 worker 结果包装成 structured analyzer provider", async () => {
    const worker = new FakeStructuredAnalyzerWorker();
    const provider = createLayeredDesignStructuredAnalyzerWorkerProvider(
      worker,
      {
        requestIdFactory: () => "request-1",
      },
    );
    const textOcrProvider: LayeredDesignFlatImageTextOcrProvider = {
      label: "本地 OCR provider",
      detectText: vi.fn(async () => []),
    };

    const promise = provider.analyze({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
      textOcrProvider,
    });

    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
        requestId: "request-1",
        input: {
          image: {
            src: "data:image/png;base64,flat",
            width: 900,
            height: 1400,
            mimeType: "image/png",
          },
          createdAt: CREATED_AT,
        },
      },
    ]);
    expect("textOcrProvider" in worker.sentMessages[0].input).toBe(false);

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
      requestId: "request-1",
      result: {
        analyzer: {
          kind: "structured_pipeline",
          label: "Worker structured analyzer",
        },
        generatedAt: CREATED_AT,
        candidates: [
          {
            id: "worker-subject",
            type: "image",
            role: "subject",
            name: "Worker 主体",
            confidence: 0.91,
            rect: {
              x: 120,
              y: 180,
              width: 620,
              height: 860,
            },
            image: {
              id: "worker-subject-rgba",
              src: "data:image/png;base64,subject",
              width: 620,
              height: 860,
              hasAlpha: true,
            },
          },
        ],
        cleanPlate: {
          status: "not_requested",
          message: "worker 未提供 clean plate",
        },
      },
    });

    await expect(promise).resolves.toMatchObject({
      analyzer: {
        label: "Worker structured analyzer",
      },
      candidates: [
        {
          id: "worker-subject",
        },
      ],
    });
    expect(worker.listenerCount).toBe(0);
    expect(textOcrProvider.detectText).not.toHaveBeenCalled();
  });

  it("应忽略非当前 request 的 worker 消息并透出当前错误", async () => {
    const worker = new FakeStructuredAnalyzerWorker();
    const provider = createLayeredDesignStructuredAnalyzerWorkerProvider(
      worker,
      {
        requestIdFactory: () => "request-2",
      },
    );

    const promise = provider.analyze({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
      },
      createdAt: CREATED_AT,
    });

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
      requestId: "other-request",
      error: {
        message: "不相关错误",
      },
    });
    expect(worker.listenerCount).toBe(1);

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
      requestId: "request-2",
      error: {
        message: "worker analyzer 暂不可用",
        code: "LayeredDesignWorkerUnavailable",
      },
    });

    await expect(promise).rejects.toThrow("worker analyzer 暂不可用");
    expect(worker.listenerCount).toBe(0);
  });

  it("worker provider 应可继续通过 analyzer adapter 写回 current analysis result", async () => {
    const worker = new FakeStructuredAnalyzerWorker();
    const provider = createLayeredDesignStructuredAnalyzerWorkerProvider(
      worker,
      {
        requestIdFactory: () => "request-3",
      },
    );
    const analyzer = createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
      provider,
      {
        fallbackAnalyzer: null,
      },
    );

    const promise = analyzer({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
      requestId: "request-3",
      result: {
        analyzer: {
          kind: "structured_pipeline",
          label: "Worker structured analyzer",
        },
        candidates: [
          {
            id: "worker-text",
            type: "text",
            role: "text",
            name: "Worker 文本",
            confidence: 0.82,
            rect: {
              x: 180,
              y: 96,
              width: 540,
              height: 120,
            },
            text: "WORKER TEXT",
            fontSize: 64,
            color: "#111827",
            align: "center",
          },
        ],
        cleanPlate: {
          status: "not_requested",
        },
      },
    });

    await expect(promise).resolves.toMatchObject({
      analysis: {
        analyzer: {
          kind: "structured_pipeline",
          label: "Worker structured analyzer",
        },
        outputs: {
          candidateRaster: false,
          candidateMask: false,
          cleanPlate: false,
          ocrText: true,
        },
      },
      candidates: [
        {
          id: "worker-text",
          layer: {
            type: "text",
            text: "WORKER TEXT",
          },
        },
      ],
    });
  });

  it("worker runtime 应执行 structured provider 并回传 result", async () => {
    const scope = new FakeStructuredAnalyzerWorkerScope();
    const analyze = vi.fn(async () => ({
      analyzer: {
        kind: "structured_pipeline" as const,
        label: "Worker runtime analyzer",
      },
      generatedAt: CREATED_AT,
      candidates: [
        {
          id: "runtime-subject",
          type: "image" as const,
          role: "subject" as const,
          name: "Runtime 主体",
          confidence: 0.88,
          rect: {
            x: 120,
            y: 180,
            width: 620,
            height: 860,
          },
          image: {
            id: "runtime-subject-rgba",
            src: "data:image/png;base64,subject",
            width: 620,
            height: 860,
            hasAlpha: true,
          },
        },
      ],
      cleanPlate: {
        status: "not_requested" as const,
      },
    }));
    const dispose = installLayeredDesignStructuredAnalyzerWorkerRuntime(scope, {
      analyze,
    });

    scope.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
      requestId: "runtime-request-1",
      input: {
        image: {
          src: "data:image/png;base64,flat",
          width: 900,
          height: 1400,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
      },
    });
    await flushPromises();

    expect(analyze).toHaveBeenCalledWith({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
        requestId: "runtime-request-1",
        result: {
          analyzer: {
            kind: "structured_pipeline",
            label: "Worker runtime analyzer",
          },
          generatedAt: CREATED_AT,
          candidates: [
            expect.objectContaining({
              id: "runtime-subject",
            }),
          ],
          cleanPlate: {
            status: "not_requested",
          },
        },
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应能执行 Worker heuristic text extractor seam 并回传 TextLayer", async () => {
    const scope = new FakeStructuredAnalyzerWorkerScope();
    const textCandidateExtractor = vi.fn(async () => ({
      text: "WORKER RUNTIME TEXT",
      fontSize: 38,
      color: "#111111",
      align: "center" as const,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        textCandidateExtractor,
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async (rect) => {
            return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
          }),
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,masked";
          }),
          createEllipseMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,mask";
          }),
          createApproximateCleanPlateDataUrl: vi.fn(async () => {
            return "data:image/png;base64,clean";
          }),
        })),
      });
    const dispose = installLayeredDesignStructuredAnalyzerWorkerRuntime(
      scope,
      provider,
    );

    scope.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
      requestId: "runtime-request-text",
      input: {
        image: {
          src: "data:image/png;base64,flat",
          width: 900,
          height: 1400,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
      },
    });
    await flushPromises();

    expect(textCandidateExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "headline-candidate",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
          }),
        }),
      }),
    );
    await flushUntilScopeMessage(scope);
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
        requestId: "runtime-request-text",
        result: expect.objectContaining({
          analyzer: {
            kind: "local_heuristic",
            label: "Worker local heuristic analyzer",
          },
          candidates: expect.arrayContaining([
            expect.objectContaining({
              id: "headline-candidate",
              type: "text",
              text: "WORKER RUNTIME TEXT",
              fontSize: 38,
            }),
          ]),
        }),
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应能执行 Worker subject mask refiner seam 并回传主体 mask", async () => {
    const scope = new FakeStructuredAnalyzerWorkerScope();
    const subjectMaskRefiner = vi.fn(async (input) => ({
      imageSrc: `data:image/png;base64,runtime-matted-${input.candidate.rect.width}`,
      maskSrc: "data:image/png;base64,runtime-matted-mask",
      confidence: 0.91,
      hasAlpha: true,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        subjectMaskRefiner,
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async (rect) => {
            return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
          }),
          cropImageWithRefinedSubjectMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,masked";
          }),
          createRefinedSubjectMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,mask";
          }),
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,ellipse";
          }),
          createEllipseMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,ellipse-mask";
          }),
          createApproximateCleanPlateDataUrl: vi.fn(async () => {
            return "data:image/png;base64,clean";
          }),
        })),
      });
    const dispose = installLayeredDesignStructuredAnalyzerWorkerRuntime(
      scope,
      provider,
    );

    scope.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
      requestId: "runtime-request-subject-mask",
      input: {
        image: {
          src: "data:image/png;base64,flat",
          width: 900,
          height: 1400,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
      },
    });
    await flushPromises();

    expect(subjectMaskRefiner).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "subject-candidate",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
          }),
        }),
      }),
    );
    await flushUntilScopeMessage(scope);
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
        requestId: "runtime-request-subject-mask",
        result: expect.objectContaining({
          analyzer: {
            kind: "local_heuristic",
            label: "Worker local heuristic analyzer",
          },
          candidates: expect.arrayContaining([
            expect.objectContaining({
              id: "subject-candidate",
              type: "image",
              confidence: 0.91,
              image: expect.objectContaining({
                src: expect.stringContaining("runtime-matted-"),
                params: expect.objectContaining({
                  seed: "worker_heuristic_subject_matted",
                }),
              }),
              mask: expect.objectContaining({
                src: "data:image/png;base64,runtime-matted-mask",
                params: {
                  seed: "worker_heuristic_subject_matte_mask",
                },
              }),
            }),
          ]),
        }),
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应忽略无效消息并回传 provider 错误", async () => {
    const scope = new FakeStructuredAnalyzerWorkerScope();
    const analyze = vi.fn(async () => {
      throw new Error("runtime analyzer 暂不可用");
    });
    installLayeredDesignStructuredAnalyzerWorkerRuntime(scope, { analyze });

    scope.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
      requestId: "not-a-request",
      result: {
        analyzer: {
          label: "无效消息",
        },
        candidates: [],
      },
    });
    await flushPromises();
    expect(analyze).not.toHaveBeenCalled();
    expect(scope.sentMessages).toEqual([]);

    scope.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
      requestId: "runtime-request-2",
      input: {
        image: {
          src: "data:image/png;base64,flat",
          width: 900,
          height: 1400,
        },
        createdAt: CREATED_AT,
      },
    });
    await flushPromises();

    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
        requestId: "runtime-request-2",
        error: {
          message: "runtime analyzer 暂不可用",
          code: "Error",
        },
      },
    ]);
  });
});
