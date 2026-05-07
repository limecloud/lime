import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignCleanPlateWorkerProvider,
  installLayeredDesignCleanPlateWorkerRuntime,
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

class FakeCleanPlateWorker {
  readonly sentMessages: LayeredDesignCleanPlateWorkerRequest[] = [];
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

class FakeCleanPlateWorkerScope {
  readonly sentMessages: LayeredDesignCleanPlateWorkerResponse[] = [];
  private readonly listeners =
    new Set<LayeredDesignCleanPlateWorkerMessageListener>();

  postMessage(message: LayeredDesignCleanPlateWorkerResponse) {
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

describe("LayeredDesign clean plate worker bridge", () => {
  it("应把 clean plate worker 结果包装成 provider", async () => {
    const worker = new FakeCleanPlateWorker();
    const provider = createLayeredDesignCleanPlateWorkerProvider(worker, {
      label: "Worker clean plate fixture",
      requestIdFactory: () => "clean-plate-request-1",
    });

    const promise = provider.createCleanPlate(cleanPlateInput);

    expect(provider.label).toBe("Worker clean plate fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
        requestId: "clean-plate-request-1",
        input: cleanPlateInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
      requestId: "clean-plate-request-1",
      result: {
        src: "data:image/png;base64,clean",
        message: "clean plate worker 已生成背景修补。",
        params: { model: "fixture-inpaint" },
      },
    });

    await expect(promise).resolves.toMatchObject({
      src: "data:image/png;base64,clean",
      message: "clean plate worker 已生成背景修补。",
      params: { model: "fixture-inpaint" },
    });
    expect(worker.listenerCount).toBe(0);
  });

  it("应忽略非当前 request 的 clean plate worker 消息并透出当前错误", async () => {
    const worker = new FakeCleanPlateWorker();
    const provider = createLayeredDesignCleanPlateWorkerProvider(worker, {
      requestIdFactory: () => "clean-plate-request-2",
    });

    const promise = provider.createCleanPlate(cleanPlateInput);

    worker.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
      requestId: "other-request",
      error: { message: "不相关错误" },
    });
    expect(worker.listenerCount).toBe(1);

    worker.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
      requestId: "clean-plate-request-2",
      error: {
        message: "clean plate 暂不可用",
        code: "CleanPlateWorkerUnavailable",
      },
    });

    await expect(promise).rejects.toThrow("clean plate 暂不可用");
    expect(worker.listenerCount).toBe(0);
  });

  it("worker runtime 应执行 clean plate provider 并回传 result", async () => {
    const scope = new FakeCleanPlateWorkerScope();
    const createCleanPlate = vi.fn(async () => ({
      src: "data:image/png;base64,runtime-clean",
      message: "runtime clean plate 已生成。",
      params: { model: "runtime-fixture" },
    }));
    const dispose = installLayeredDesignCleanPlateWorkerRuntime(scope, {
      label: "Runtime clean plate fixture",
      createCleanPlate,
    });

    scope.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
      requestId: "runtime-clean-plate-request-1",
      input: cleanPlateInput,
    });
    await flushPromises();

    expect(createCleanPlate).toHaveBeenCalledWith(cleanPlateInput);
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
        requestId: "runtime-clean-plate-request-1",
        result: {
          src: "data:image/png;base64,runtime-clean",
          message: "runtime clean plate 已生成。",
          params: { model: "runtime-fixture" },
        },
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应忽略无效消息并回传 provider 错误", async () => {
    const scope = new FakeCleanPlateWorkerScope();
    const createCleanPlate = vi.fn(async () => {
      throw new Error("runtime clean plate 暂不可用");
    });
    installLayeredDesignCleanPlateWorkerRuntime(scope, {
      label: "Runtime clean plate fixture",
      createCleanPlate,
    });

    scope.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_RESULT,
      requestId: "not-a-request",
      result: null,
    });
    await flushPromises();
    expect(createCleanPlate).not.toHaveBeenCalled();
    expect(scope.sentMessages).toEqual([]);

    scope.emit({
      type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_REQUEST,
      requestId: "runtime-clean-plate-request-2",
      input: cleanPlateInput,
    });
    await flushPromises();

    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_CLEAN_PLATE_WORKER_ERROR,
        requestId: "runtime-clean-plate-request-2",
        error: {
          message: "runtime clean plate 暂不可用",
          code: "Error",
        },
      },
    ]);
  });
});
