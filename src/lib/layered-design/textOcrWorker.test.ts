import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignTextOcrWorkerProvider,
  installLayeredDesignTextOcrWorkerRuntime,
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

class FakeTextOcrWorker {
  readonly sentMessages: LayeredDesignTextOcrWorkerRequest[] = [];
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

class FakeTextOcrWorkerScope {
  readonly sentMessages: LayeredDesignTextOcrWorkerResponse[] = [];
  private readonly listeners =
    new Set<LayeredDesignTextOcrWorkerMessageListener>();

  postMessage(message: LayeredDesignTextOcrWorkerResponse) {
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

describe("LayeredDesign text OCR worker bridge", () => {
  it("应把 text OCR worker 结果包装成 provider", async () => {
    const worker = new FakeTextOcrWorker();
    const provider = createLayeredDesignTextOcrWorkerProvider(worker, {
      label: "Worker OCR fixture",
      requestIdFactory: () => "ocr-request-1",
    });

    const promise = provider.detectText(textOcrInput);

    expect(provider.label).toBe("Worker OCR fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
        requestId: "ocr-request-1",
        input: textOcrInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
      requestId: "ocr-request-1",
      blocks: [
        {
          text: "WORKER OCR TEXT",
          boundingBox: { x: 10, y: 12, width: 320, height: 56 },
          confidence: 0.92,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        text: "WORKER OCR TEXT",
        boundingBox: { x: 10, y: 12, width: 320, height: 56 },
        confidence: 0.92,
      },
    ]);
    expect(worker.listenerCount).toBe(0);
  });

  it("应忽略非当前 request 的 text OCR worker 消息并透出当前错误", async () => {
    const worker = new FakeTextOcrWorker();
    const provider = createLayeredDesignTextOcrWorkerProvider(worker, {
      requestIdFactory: () => "ocr-request-2",
    });

    const promise = provider.detectText(textOcrInput);

    worker.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
      requestId: "other-request",
      error: {
        message: "不相关错误",
      },
    });
    expect(worker.listenerCount).toBe(1);

    worker.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
      requestId: "ocr-request-2",
      error: {
        message: "OCR worker 暂不可用",
        code: "TextOcrWorkerUnavailable",
      },
    });

    await expect(promise).rejects.toThrow("OCR worker 暂不可用");
    expect(worker.listenerCount).toBe(0);
  });

  it("worker runtime 应执行 OCR provider 并回传 result", async () => {
    const scope = new FakeTextOcrWorkerScope();
    const detectText = vi.fn(async () => [
      {
        text: "RUNTIME OCR TEXT",
        boundingBox: { x: 8, y: 16, width: 360, height: 64 },
        confidence: 0.9,
      },
    ]);
    const dispose = installLayeredDesignTextOcrWorkerRuntime(scope, {
      label: "Runtime OCR fixture",
      detectText,
    });

    scope.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
      requestId: "runtime-ocr-request-1",
      input: textOcrInput,
    });
    await flushPromises();

    expect(detectText).toHaveBeenCalledWith(textOcrInput);
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
        requestId: "runtime-ocr-request-1",
        blocks: [
          {
            text: "RUNTIME OCR TEXT",
            boundingBox: { x: 8, y: 16, width: 360, height: 64 },
            confidence: 0.9,
          },
        ],
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应忽略无效消息并回传 provider 错误", async () => {
    const scope = new FakeTextOcrWorkerScope();
    const detectText = vi.fn(async () => {
      throw new Error("runtime OCR 暂不可用");
    });
    installLayeredDesignTextOcrWorkerRuntime(scope, {
      label: "Runtime OCR fixture",
      detectText,
    });

    scope.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_RESULT,
      requestId: "not-a-request",
      blocks: [],
    });
    await flushPromises();
    expect(detectText).not.toHaveBeenCalled();
    expect(scope.sentMessages).toEqual([]);

    scope.emit({
      type: LAYERED_DESIGN_TEXT_OCR_WORKER_REQUEST,
      requestId: "runtime-ocr-request-2",
      input: textOcrInput,
    });
    await flushPromises();

    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_TEXT_OCR_WORKER_ERROR,
        requestId: "runtime-ocr-request-2",
        error: {
          message: "runtime OCR 暂不可用",
          code: "Error",
        },
      },
    ]);
  });
});
