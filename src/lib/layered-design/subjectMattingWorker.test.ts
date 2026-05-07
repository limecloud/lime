import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignSubjectMattingWorkerProvider,
  installLayeredDesignSubjectMattingWorkerRuntime,
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
  LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
  type LayeredDesignSubjectMattingWorkerMessageListener,
  type LayeredDesignSubjectMattingWorkerRequest,
  type LayeredDesignSubjectMattingWorkerResponse,
} from "./subjectMattingWorker";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const subjectMattingInput = {
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
  },
};

class FakeSubjectMattingWorker {
  readonly sentMessages: LayeredDesignSubjectMattingWorkerRequest[] = [];
  private readonly listeners =
    new Set<LayeredDesignSubjectMattingWorkerMessageListener>();

  postMessage(message: LayeredDesignSubjectMattingWorkerRequest) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.delete(listener);
  }

  emit(data: LayeredDesignSubjectMattingWorkerResponse) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

class FakeSubjectMattingWorkerScope {
  readonly sentMessages: LayeredDesignSubjectMattingWorkerResponse[] = [];
  private readonly listeners =
    new Set<LayeredDesignSubjectMattingWorkerMessageListener>();

  postMessage(message: LayeredDesignSubjectMattingWorkerResponse) {
    this.sentMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
  ) {
    expect(type).toBe("message");
    this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: LayeredDesignSubjectMattingWorkerMessageListener,
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

describe("LayeredDesign subject matting worker bridge", () => {
  it("应把 subject matting worker 结果包装成 provider", async () => {
    const worker = new FakeSubjectMattingWorker();
    const provider = createLayeredDesignSubjectMattingWorkerProvider(worker, {
      label: "Worker subject matting fixture",
      requestIdFactory: () => "matting-request-1",
    });

    const promise = provider.matteSubject(subjectMattingInput);

    expect(provider.label).toBe("Worker subject matting fixture");
    expect(worker.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
        requestId: "matting-request-1",
        input: subjectMattingInput,
      },
    ]);

    worker.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
      requestId: "matting-request-1",
      result: {
        imageSrc: "data:image/png;base64,matted",
        maskSrc: "data:image/png;base64,mask",
        confidence: 0.91,
        hasAlpha: true,
      },
    });

    await expect(promise).resolves.toMatchObject({
      imageSrc: "data:image/png;base64,matted",
      maskSrc: "data:image/png;base64,mask",
      confidence: 0.91,
      hasAlpha: true,
    });
    expect(worker.listenerCount).toBe(0);
  });

  it("应忽略非当前 request 的 subject matting worker 消息并透出当前错误", async () => {
    const worker = new FakeSubjectMattingWorker();
    const provider = createLayeredDesignSubjectMattingWorkerProvider(worker, {
      requestIdFactory: () => "matting-request-2",
    });

    const promise = provider.matteSubject(subjectMattingInput);

    worker.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
      requestId: "other-request",
      error: {
        message: "不相关错误",
      },
    });
    expect(worker.listenerCount).toBe(1);

    worker.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
      requestId: "matting-request-2",
      error: {
        message: "subject matting 暂不可用",
        code: "SubjectMattingWorkerUnavailable",
      },
    });

    await expect(promise).rejects.toThrow("subject matting 暂不可用");
    expect(worker.listenerCount).toBe(0);
  });

  it("worker runtime 应执行 subject matting provider 并回传 result", async () => {
    const scope = new FakeSubjectMattingWorkerScope();
    const matteSubject = vi.fn(async () => ({
      imageSrc: "data:image/png;base64,runtime-matted",
      maskSrc: "data:image/png;base64,runtime-mask",
      confidence: 0.88,
      hasAlpha: true,
    }));
    const dispose = installLayeredDesignSubjectMattingWorkerRuntime(scope, {
      label: "Runtime subject matting fixture",
      matteSubject,
    });

    scope.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
      requestId: "runtime-matting-request-1",
      input: subjectMattingInput,
    });
    await flushPromises();

    expect(matteSubject).toHaveBeenCalledWith(subjectMattingInput);
    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
        requestId: "runtime-matting-request-1",
        result: {
          imageSrc: "data:image/png;base64,runtime-matted",
          maskSrc: "data:image/png;base64,runtime-mask",
          confidence: 0.88,
          hasAlpha: true,
        },
      },
    ]);

    dispose();
    expect(scope.listenerCount).toBe(0);
  });

  it("worker runtime 应忽略无效消息并回传 provider 错误", async () => {
    const scope = new FakeSubjectMattingWorkerScope();
    const matteSubject = vi.fn(async () => {
      throw new Error("runtime subject matting 暂不可用");
    });
    installLayeredDesignSubjectMattingWorkerRuntime(scope, {
      label: "Runtime subject matting fixture",
      matteSubject,
    });

    scope.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_RESULT,
      requestId: "not-a-request",
      result: null,
    });
    await flushPromises();
    expect(matteSubject).not.toHaveBeenCalled();
    expect(scope.sentMessages).toEqual([]);

    scope.emit({
      type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_REQUEST,
      requestId: "runtime-matting-request-2",
      input: subjectMattingInput,
    });
    await flushPromises();

    expect(scope.sentMessages).toEqual([
      {
        type: LAYERED_DESIGN_SUBJECT_MATTING_WORKER_ERROR,
        requestId: "runtime-matting-request-2",
        error: {
          message: "runtime subject matting 暂不可用",
          code: "Error",
        },
      },
    ]);
  });
});
