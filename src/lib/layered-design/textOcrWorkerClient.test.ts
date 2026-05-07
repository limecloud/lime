import { describe, expect, it, vi } from "vitest";
import type { LayeredDesignFlatImageTextOcrProvider } from "./analyzer";
import {
  createLayeredDesignWorkerTextOcrProvider,
  type LayeredDesignTextOcrWorkerHandle,
} from "./textOcrWorkerClient";
import {
  LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
  LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
  LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
  type LayeredDesignTextOcrWorkerMessageListener,
  type LayeredDesignTextOcrWorkerRequest,
  type LayeredDesignTextOcrWorkerResponse,
} from "./textOcrWorker";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const textOcrInput = {
  image: {
    src: "data:image/png;base64,flat",
    width: 900,
    height: 1400,
    mimeType: "image/png",
  },
  candidate: {
    id: "headline-candidate",
    name: "标题文字候选",
    role: "text" as const,
    rect: {
      x: 108,
      y: 84,
      width: 684,
      height: 252,
    },
    asset: {
      id: "headline-candidate-ocr-crop",
      kind: "text_raster" as const,
      src: "data:image/png;base64,headline-crop",
      width: 684,
      height: 252,
      hasAlpha: true,
      createdAt: CREATED_AT,
    },
  },
};

class FakeTextOcrWorker implements LayeredDesignTextOcrWorkerHandle {
  readonly sentMessages: LayeredDesignTextOcrWorkerRequest[] = [];
  readonly terminate = vi.fn();
  private readonly listeners =
    new Set<LayeredDesignTextOcrWorkerMessageListener>();

  postMessage(message: LayeredDesignTextOcrWorkerRequest) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignTextOcrWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: LayeredDesignTextOcrWorkerResponse) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

describe("LayeredDesign text OCR worker client", () => {
  it("应创建 text OCR Worker provider 并在完成后释放 Worker", async () => {
    const worker = new FakeTextOcrWorker();
    const provider = createLayeredDesignWorkerTextOcrProvider({
      label: "Browser OCR fixture",
      requestIdFactory: () => "text-ocr-worker-request-1",
      workerFactory: () => worker,
      fallbackProvider: null,
    });

    const promise = provider.detectText(textOcrInput);

    expect(provider.label).toBe("Browser OCR fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
        requestId: "text-ocr-worker-request-1",
        input: textOcrInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
      requestId: "text-ocr-worker-request-1",
      blocks: [
        {
          text: "WORKER OCR TEXT",
          boundingBox: { x: 12, y: 16, width: 320, height: 64 },
          confidence: 0.93,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        text: "WORKER OCR TEXT",
        boundingBox: { x: 12, y: 16, width: 320, height: 64 },
        confidence: 0.93,
      },
    ]);
    expect(worker.listenerCount).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在 text OCR Worker 失败时使用 fallback provider 并释放 Worker", async () => {
    const worker = new FakeTextOcrWorker();
    const fallbackProvider: LayeredDesignFlatImageTextOcrProvider = {
      label: "Fallback OCR provider",
      detectText: vi.fn(async () => [
        {
          text: "FALLBACK OCR TEXT",
          confidence: 0.81,
        },
      ]),
    };
    const provider = createLayeredDesignWorkerTextOcrProvider({
      requestIdFactory: () => "text-ocr-worker-request-2",
      workerFactory: () => worker,
      fallbackProvider,
    });

    const promise = provider.detectText(textOcrInput);

    worker.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
      requestId: "text-ocr-worker-request-2",
      error: {
        message: "OCR Worker 暂不可用",
      },
    });

    await expect(promise).resolves.toEqual([
      {
        text: "FALLBACK OCR TEXT",
        confidence: 0.81,
      },
    ]);
    expect(fallbackProvider.detectText).toHaveBeenCalledWith(textOcrInput);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在无法创建 Worker 时默认回退 deterministic OCR provider", async () => {
    const provider = createLayeredDesignWorkerTextOcrProvider({
      workerFactory: () => {
        throw new Error("当前环境不支持文字 OCR Worker");
      },
    });

    await expect(provider.detectText(textOcrInput)).resolves.toEqual([
      {
        text: "LIME LAYERED TEXT",
        boundingBox: {
          x: 0,
          y: 0,
          width: 684,
          height: 252,
        },
        confidence: 0.9,
      },
    ]);
  });

  it("应在关闭 fallback 时透出 Worker 创建错误", async () => {
    const provider = createLayeredDesignWorkerTextOcrProvider({
      fallbackProvider: null,
      workerFactory: () => {
        throw new Error("文字 OCR Worker 创建失败");
      },
    });

    await expect(provider.detectText(textOcrInput)).rejects.toThrow(
      "文字 OCR Worker 创建失败",
    );
  });
});
