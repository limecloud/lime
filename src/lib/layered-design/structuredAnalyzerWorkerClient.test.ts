import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignWorkerFirstFlatImageAnalyzer,
  createLayeredDesignWorkerHeuristicAnalyzer,
  type LayeredDesignStructuredAnalyzerWorkerHandle,
} from "./structuredAnalyzerWorkerClient";
import {
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
  LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
  type LayeredDesignStructuredAnalyzerWorkerMessageListener,
  type LayeredDesignStructuredAnalyzerWorkerRequest,
  type LayeredDesignStructuredAnalyzerWorkerResponse,
} from "./structuredAnalyzerWorker";
import type { LayeredDesignFlatImageAnalysisResult } from "./analyzer";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

class FakeAnalyzerWorker implements LayeredDesignStructuredAnalyzerWorkerHandle {
  readonly sentMessages: LayeredDesignStructuredAnalyzerWorkerRequest[] = [];
  readonly terminate = vi.fn();
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

function createFallbackResult(): LayeredDesignFlatImageAnalysisResult {
  return {
    analysis: {
      analyzer: {
        kind: "local_heuristic",
        label: "Fallback analyzer",
      },
      generatedAt: CREATED_AT,
      outputs: {
        candidateRaster: false,
        candidateMask: false,
        cleanPlate: false,
        ocrText: false,
      },
    },
    candidates: [],
    cleanPlate: {
      status: "not_requested",
    },
  };
}

describe("LayeredDesign worker heuristic analyzer client", () => {
  it("应创建真实 Worker analyzer 并把 result 写回 current analysis", async () => {
    const worker = new FakeAnalyzerWorker();
    const analyzer = createLayeredDesignWorkerHeuristicAnalyzer({
      fallbackAnalyzer: null,
      requestIdFactory: () => "worker-request-1",
      workerFactory: () => worker,
    });

    const promise = analyzer({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_REQUEST,
        requestId: "worker-request-1",
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

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
      requestId: "worker-request-1",
      result: {
        analyzer: {
          kind: "local_heuristic",
          label: "Worker local heuristic analyzer",
        },
        generatedAt: CREATED_AT,
        candidates: [
          {
            id: "worker-subject",
            type: "image",
            role: "subject",
            name: "Worker 主体",
            confidence: 0.9,
            rect: {
              x: 120,
              y: 180,
              width: 620,
              height: 860,
            },
            image: {
              id: "worker-subject-asset",
              kind: "subject",
              src: "data:image/png;base64,subject",
              width: 620,
              height: 860,
              hasAlpha: true,
            },
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
          label: "Worker local heuristic analyzer",
        },
        outputs: {
          candidateRaster: true,
        },
      },
      candidates: [
        {
          id: "worker-subject",
          layer: {
            type: "image",
            assetId: "worker-subject-asset",
          },
        },
      ],
    });
    expect(worker.listenerCount).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在 Worker 失败时走 adapter fallback 并终止 Worker", async () => {
    const worker = new FakeAnalyzerWorker();
    const fallbackAnalyzer = vi.fn(async () => createFallbackResult());
    const analyzer = createLayeredDesignWorkerHeuristicAnalyzer({
      fallbackAnalyzer,
      requestIdFactory: () => "worker-request-2",
      workerFactory: () => worker,
    });

    const params = {
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    };
    const promise = analyzer(params);

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_ERROR,
      requestId: "worker-request-2",
      error: {
        message: "Worker analyzer 暂不可用",
      },
    });

    await expect(promise).resolves.toEqual(createFallbackResult());
    expect(fallbackAnalyzer).toHaveBeenCalledWith({
      ...params,
      structuredAnalyzerProvider: null,
      textOcrProvider: undefined,
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在 Worker 无法创建时走 fallback analyzer", async () => {
    const fallbackAnalyzer = vi.fn(async () => createFallbackResult());
    const analyzer = createLayeredDesignWorkerHeuristicAnalyzer({
      fallbackAnalyzer,
      workerFactory: () => {
        throw new Error("当前环境不支持图层拆分 Worker");
      },
    });
    const params = {
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
      },
      createdAt: CREATED_AT,
    };

    await expect(analyzer(params)).resolves.toEqual(createFallbackResult());
    expect(fallbackAnalyzer).toHaveBeenCalledWith({
      ...params,
      structuredAnalyzerProvider: null,
      textOcrProvider: undefined,
    });
  });

  it("worker-first 默认 analyzer 应保留 Worker mask/clean plate 并合并 fallback OCR TextLayer", async () => {
    const worker = new FakeAnalyzerWorker();
    const fallbackAnalyzer = vi.fn(async (): Promise<LayeredDesignFlatImageAnalysisResult> => ({
      analysis: {
        analyzer: {
          kind: "local_heuristic",
          label: "Fallback analyzer + Tauri native OCR",
        },
        outputs: {
          candidateRaster: true,
          candidateMask: false,
          cleanPlate: false,
          ocrText: true,
        },
        providerCapabilities: [
          {
            kind: "text_ocr",
            label: "Tauri native OCR",
            execution: "native_command",
            modelId: "tauri_native_ocr",
            supports: {
              textGeometry: true,
            },
            quality: {
              productionReady: false,
              requiresHumanReview: true,
            },
          },
        ],
        generatedAt: CREATED_AT,
      },
      candidates: [
        {
          id: "headline-candidate",
          role: "text",
          confidence: 0.88,
          layer: {
            id: "headline-layer",
            name: "标题文字",
            type: "text",
            text: "OCR 标题",
            x: 120,
            y: 80,
            width: 620,
            height: 140,
            zIndex: 40,
            fontSize: 72,
            color: "#111111",
            align: "center",
          },
          assetIds: [],
        },
      ],
      cleanPlate: {
        status: "not_requested",
      },
    }));
    const analyzer = createLayeredDesignWorkerFirstFlatImageAnalyzer({
      fallbackAnalyzer,
      requestIdFactory: () => "worker-first-request",
      workerFactory: () => worker,
    });
    const params = {
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    };
    const promise = analyzer(params);

    worker.emit({
      type: LAYERED_DESIGN_STRUCTURED_ANALYZER_WORKER_RESULT,
      requestId: "worker-first-request",
      result: {
        analyzer: {
          kind: "local_heuristic",
          label: "Worker local heuristic analyzer",
        },
        generatedAt: CREATED_AT,
        candidates: [
          {
            id: "worker-subject",
            type: "image",
            role: "subject",
            name: "Worker 主体",
            confidence: 0.94,
            rect: {
              x: 120,
              y: 180,
              width: 620,
              height: 860,
            },
            image: {
              id: "worker-subject-asset",
              kind: "subject",
              src: "data:image/png;base64,subject",
              width: 620,
              height: 860,
              hasAlpha: true,
            },
            mask: {
              id: "worker-subject-mask",
              kind: "mask",
              src: "data:image/png;base64,mask",
              width: 620,
              height: 860,
              hasAlpha: false,
            },
          },
          {
            id: "headline-raster",
            type: "image",
            role: "text",
            name: "Worker 文本裁片",
            confidence: 0.62,
            rect: {
              x: 120,
              y: 80,
              width: 620,
              height: 140,
            },
            image: {
              id: "headline-raster-asset",
              kind: "text_raster",
              src: "data:image/png;base64,text-raster",
              width: 620,
              height: 140,
              hasAlpha: false,
            },
          },
        ],
        cleanPlate: {
          asset: {
            id: "worker-clean-plate",
            kind: "clean_plate",
            src: "data:image/png;base64,clean",
            width: 900,
            height: 1400,
            hasAlpha: false,
          },
          message: "Worker clean plate ready.",
        },
      },
    });

    const result = await promise;

    expect(result).toMatchObject({
      analysis: {
        analyzer: {
          kind: "structured_pipeline",
          label: "Worker local heuristic analyzer + OCR TextLayer merge",
        },
        outputs: {
          candidateMask: true,
          cleanPlate: true,
          ocrText: true,
        },
      },
      candidates: [
        {
          id: "worker-subject",
          role: "subject",
        },
        {
          id: "headline-candidate",
          role: "text",
          layer: {
            type: "text",
            text: "OCR 标题",
          },
        },
      ],
      cleanPlate: {
        asset: {
          id: "worker-clean-plate",
        },
      },
    });
    expect(
      result.candidates.some((candidate) => candidate.id === "headline-raster"),
    ).toBe(false);
    expect(fallbackAnalyzer).toHaveBeenCalledWith({
      ...params,
      structuredAnalyzerProvider: null,
      textOcrProvider: undefined,
    });
  });
});
