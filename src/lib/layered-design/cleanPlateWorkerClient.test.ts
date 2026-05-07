import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignWorkerCleanPlateProvider,
  type LayeredDesignCleanPlateWorkerHandle,
} from "./cleanPlateWorkerClient";
import {
  LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
  LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
  LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
  type LayeredDesignCleanPlateWorkerMessageListener,
  type LayeredDesignCleanPlateWorkerRequest,
  type LayeredDesignCleanPlateWorkerResponse,
} from "./cleanPlateWorker";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const cleanPlateInput = {
  image: {
    src: "data:image/png;base64,flat",
    width: 900,
    height: 1400,
    mimeType: "image/png",
  },
  createdAt: CREATED_AT,
  subject: {
    id: "subject-candidate",
    name: "主体候选",
    rect: {
      x: 144,
      y: 224,
      width: 612,
      height: 980,
    },
    confidence: 0.74,
    zIndex: 20,
    crop: {
      src: "data:image/png;base64,crop",
      width: 612,
      height: 980,
      mimeType: "image/png" as const,
    },
    maskSrc: "data:image/png;base64,mask",
  },
};

class FakeCleanPlateWorker implements LayeredDesignCleanPlateWorkerHandle {
  readonly sentMessages: LayeredDesignCleanPlateWorkerRequest[] = [];
  readonly terminate = vi.fn();
  private readonly listeners =
    new Set<LayeredDesignCleanPlateWorkerMessageListener>();

  postMessage(message: LayeredDesignCleanPlateWorkerRequest) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignCleanPlateWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: LayeredDesignCleanPlateWorkerResponse) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

describe("LayeredDesign clean plate worker client", () => {
  it("应创建 clean plate Worker provider 并在完成后释放 Worker", async () => {
    const worker = new FakeCleanPlateWorker();
    const provider = createLayeredDesignWorkerCleanPlateProvider({
      label: "Browser clean plate fixture",
      requestIdFactory: () => "clean-plate-worker-request-1",
      workerFactory: () => worker,
      fallbackProvider: null,
    });

    const promise = provider.createCleanPlate(cleanPlateInput);

    expect(provider.label).toBe("Browser clean plate fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
        requestId: "clean-plate-worker-request-1",
        input: cleanPlateInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
      requestId: "clean-plate-worker-request-1",
      result: {
        src: "data:image/png;base64,worker-clean",
        params: { model: "worker-fixture" },
      },
    });

    await expect(promise).resolves.toMatchObject({
      src: "data:image/png;base64,worker-clean",
      params: { model: "worker-fixture" },
    });
    expect(worker.listenerCount).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在 clean plate Worker 失败时使用 fallback provider 并释放 Worker", async () => {
    const worker = new FakeCleanPlateWorker();
    const fallbackProvider = {
      label: "Fallback clean plate provider",
      createCleanPlate: vi.fn(async () => ({
        src: "data:image/png;base64,fallback-clean",
        params: { model: "fallback" },
      })),
    };
    const provider = createLayeredDesignWorkerCleanPlateProvider({
      requestIdFactory: () => "clean-plate-worker-request-2",
      workerFactory: () => worker,
      fallbackProvider,
    });

    const promise = provider.createCleanPlate(cleanPlateInput);

    worker.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
      requestId: "clean-plate-worker-request-2",
      error: { message: "clean plate Worker 暂不可用" },
    });

    await expect(promise).resolves.toMatchObject({
      src: "data:image/png;base64,fallback-clean",
      params: { model: "fallback" },
    });
    expect(fallbackProvider.createCleanPlate).toHaveBeenCalledWith(
      cleanPlateInput,
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("应在无法创建 Worker 时默认回退 deterministic clean plate provider", async () => {
    const provider = createLayeredDesignWorkerCleanPlateProvider({
      workerFactory: () => {
        throw new Error("当前环境不支持 clean plate Worker");
      },
    });

    await expect(provider.createCleanPlate(cleanPlateInput)).resolves.toEqual({
      src: expect.stringContaining("data:image/png;base64,"),
      message: expect.stringContaining("deterministic provider"),
      params: expect.objectContaining({
        provider: "Deterministic clean plate placeholder",
        sourceRect: {
          x: 144,
          y: 224,
          width: 612,
          height: 980,
        },
      }),
    });
  });

  it("应在关闭 fallback 时透出 Worker 创建错误", async () => {
    const provider = createLayeredDesignWorkerCleanPlateProvider({
      fallbackProvider: null,
      workerFactory: () => {
        throw new Error("clean plate Worker 创建失败");
      },
    });

    await expect(provider.createCleanPlate(cleanPlateInput)).rejects.toThrow(
      "clean plate Worker 创建失败",
    );
  });
});
